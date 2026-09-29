import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  attemptSnapshotSchema,
  contractVersion,
  decodeJson,
  isTerminal,
  jobEventSchema,
  submissionSchema,
  validateAncestry,
  type AttemptSnapshot,
  type AttemptStatus,
  type ContextCheckpoint,
  type EventPayload,
  type JobEvent,
  type ModelKey,
  type Submission,
} from '../../../shared/contracts';
import type { Database, SqlConnection } from './database';
import { AttemptCancelled, RequestError } from './errors';

const storedJobSchema = z.strictObject({
  snapshot: attemptSnapshotSchema,
  runId: z.string().nullable(),
  claimId: z.string().nullable(),
  heartbeat: z.number(),
  providerStarted: z.boolean(),
});
export type StoredJob = z.infer<typeof storedJobSchema>;
export type JobUpdate = {
  events?: EventPayload[];
  text?: string;
  reasoning?: string;
  status?: AttemptStatus;
  actualModel?: ModelKey;
  checkpoint?: ContextCheckpoint;
  error?: string;
};
export type Dispatcher = (owner: string, attemptId: string) => Promise<string>;

function newJob(input: Submission, now: number): StoredJob {
  return {
    runId: null,
    claimId: null,
    heartbeat: now,
    providerStarted: false,
    snapshot: {
      version: contractVersion,
      attemptId: input.attemptId,
      chatId: input.chatId,
      pathId: input.pathId,
      userTurnId: input.userTurnId,
      sequence: 0,
      status: 'accepted',
      actualModel: null,
      text: '',
      reasoning: '',
      error: null,
      checkpoint: null,
      cancelRequested: false,
      delivered: false,
    },
  };
}

async function readJob(
  db: SqlConnection,
  owner: string,
  attemptId: string,
  lock = false,
): Promise<StoredJob> {
  const result = await db.query(
    `SELECT state::text AS data FROM chat_jobs
     WHERE owner = $1 AND attempt_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [owner, attemptId],
  );
  const row = result.rows[0];
  if (!row) throw new RequestError(404, 'Reply not found.');
  return decodeJson(storedJobSchema, row.data);
}

async function writeJob(
  db: SqlConnection,
  owner: string,
  job: StoredJob,
): Promise<void> {
  await db.query(
    'UPDATE chat_jobs SET state = $3::jsonb WHERE owner = $1 AND attempt_id = $2',
    [owner, job.snapshot.attemptId, JSON.stringify(job)],
  );
}

async function appendEvents(
  db: SqlConnection,
  owner: string,
  job: StoredJob,
  payloads: EventPayload[],
): Promise<JobEvent[]> {
  const events: JobEvent[] = [];
  for (const payload of payloads) {
    job.snapshot.sequence += 1;
    const event = jobEventSchema.parse({
      ...payload,
      version: contractVersion,
      attemptId: job.snapshot.attemptId,
      sequence: job.snapshot.sequence,
    });
    if (event.kind === 'snapshot') {
      event.snapshot.sequence = event.sequence;
    }
    events.push(event);
  }
  if (events.length > 0) {
    await db.query(
      `INSERT INTO chat_job_events (owner, attempt_id, sequence, event)
       SELECT $1, $2::uuid, (item->>'sequence')::bigint, item
       FROM jsonb_array_elements($3::jsonb) AS item`,
      [owner, job.snapshot.attemptId, JSON.stringify(events)],
    );
  }
  await writeJob(db, owner, job);
  return events;
}

export class JobRepository {
  constructor(
    readonly database: Database,
    private readonly now: () => number = Date.now,
  ) {}

  async submit(
    owner: string,
    input: Submission,
    dispatch: Dispatcher,
  ): Promise<StoredJob> {
    try {
      validateAncestry(input);
    } catch {
      throw new RequestError(400, 'Conversation ancestry is inconsistent.');
    }
    const serialized = JSON.stringify(input);
    const fingerprint = createHash('sha256').update(serialized).digest('hex');
    return this.database.transaction(async db => {
      // A transaction-scoped lock also covers a chat deletion racing a new send.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        owner + input.chatId,
      ]);
      const deleted = await db.query(
        'SELECT chat_id::text AS data FROM deleted_chats WHERE owner = $1 AND chat_id = $2',
        [owner, input.chatId],
      );
      if (deleted.rows.length > 0)
        throw new RequestError(410, 'This chat was deleted.');
      const previous = await db.query(
        'SELECT request_hash AS data FROM chat_jobs WHERE owner = $1 AND attempt_id = $2',
        [owner, input.attemptId],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].data !== fingerprint) {
          throw new RequestError(
            409,
            'This reply id already belongs to a different request.',
          );
        }
        return readJob(db, owner, input.attemptId, true);
      }
      const active = await db.query(
        `SELECT attempt_id::text AS data FROM chat_jobs
         WHERE owner = $1 AND chat_id = $2 AND path_id = $3
           AND state->'snapshot'->>'status' IN
             ('accepted', 'selecting', 'compacting', 'generating')`,
        [owner, input.chatId, input.pathId],
      );
      if (active.rows.length > 0) {
        throw new RequestError(
          409,
          'This conversation path already has a reply in progress.',
        );
      }
      const job = newJob(input, this.now());
      await db.query(
        `INSERT INTO chat_jobs
           (owner, attempt_id, chat_id, path_id, request_hash, input, state)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [
          owner,
          input.attemptId,
          input.chatId,
          input.pathId,
          fingerprint,
          serialized,
          JSON.stringify(job),
        ],
      );
      // Acceptance is returned only after durable dispatch AND this transaction commit.
      // A dispatch whose acknowledgement is lost can run twice; claim() guards paid work.
      job.runId = await dispatch(owner, input.attemptId);
      await writeJob(db, owner, job);
      return job;
    });
  }

  get(owner: string, attemptId: string): Promise<StoredJob> {
    return readJob(this.database, owner, attemptId);
  }

  async input(owner: string, attemptId: string): Promise<Submission> {
    const result = await this.database.query(
      'SELECT input::text AS data FROM chat_jobs WHERE owner = $1 AND attempt_id = $2 AND input IS NOT NULL',
      [owner, attemptId],
    );
    const row = result.rows[0];
    if (!row)
      throw new RequestError(404, 'Reply input is no longer available.');
    return decodeJson(submissionSchema, row.data);
  }

  async claim(
    owner: string,
    attemptId: string,
    runId: string,
    claimId: string,
  ): Promise<boolean> {
    return this.database.transaction(async db => {
      const job = await readJob(db, owner, attemptId, true);
      if (
        job.claimId ||
        isTerminal(job.snapshot.status) ||
        job.snapshot.cancelRequested
      )
        return false;
      job.claimId = claimId;
      job.runId = runId;
      job.heartbeat = this.now();
      await writeJob(db, owner, job);
      return true;
    });
  }

  async heartbeat(
    owner: string,
    attemptId: string,
    claimId: string,
  ): Promise<boolean> {
    return this.database.transaction(async db => {
      const job = await readJob(db, owner, attemptId, true);
      if (
        job.claimId !== claimId ||
        job.snapshot.cancelRequested ||
        isTerminal(job.snapshot.status)
      )
        return false;
      job.heartbeat = this.now();
      await writeJob(db, owner, job);
      return true;
    });
  }

  async markProviderStarted(
    owner: string,
    attemptId: string,
    claimId: string,
  ): Promise<void> {
    await this.database.transaction(async db => {
      const job = await readJob(db, owner, attemptId, true);
      this.assertActive(job, claimId);
      job.providerStarted = true;
      job.heartbeat = this.now();
      await writeJob(db, owner, job);
    });
  }

  private assertActive(job: StoredJob, claimId: string): void {
    if (
      job.claimId !== claimId ||
      job.snapshot.cancelRequested ||
      isTerminal(job.snapshot.status)
    ) {
      throw new AttemptCancelled();
    }
  }

  async update(
    owner: string,
    attemptId: string,
    claimId: string,
    update: JobUpdate,
  ): Promise<JobEvent[]> {
    return this.database.transaction(async db => {
      const job = await readJob(db, owner, attemptId, true);
      this.assertActive(job, claimId);
      if (update.text) job.snapshot.text += update.text;
      if (update.reasoning) job.snapshot.reasoning += update.reasoning;
      if (update.status) job.snapshot.status = update.status;
      if (update.actualModel) job.snapshot.actualModel = update.actualModel;
      if (update.checkpoint) job.snapshot.checkpoint = update.checkpoint;
      if (update.error) job.snapshot.error = update.error;
      job.heartbeat = this.now();
      const payloads = [...(update.events ?? [])];
      if (update.status || update.actualModel) {
        payloads.push({
          kind: 'status',
          status: job.snapshot.status,
          actualModel: job.snapshot.actualModel,
        });
      }
      if (isTerminal(job.snapshot.status))
        payloads.push({ kind: 'snapshot', snapshot: { ...job.snapshot } });
      return appendEvents(db, owner, job, payloads);
    });
  }

  async events(
    owner: string,
    attemptId: string,
    after: number,
  ): Promise<JobEvent[]> {
    await this.get(owner, attemptId);
    const result = await this.database.query(
      `SELECT event::text AS data FROM chat_job_events
       WHERE owner = $1 AND attempt_id = $2 AND sequence > $3 ORDER BY sequence LIMIT 500`,
      [owner, attemptId, after],
    );
    return result.rows.map(row => decodeJson(jobEventSchema, row.data));
  }

  async cancel(owner: string, attemptId: string): Promise<AttemptSnapshot> {
    return this.database.transaction(async db => {
      const job = await readJob(db, owner, attemptId, true);
      if (isTerminal(job.snapshot.status)) return job.snapshot;
      job.snapshot.cancelRequested = true;
      job.snapshot.status = 'stopped';
      await appendEvents(db, owner, job, [
        { kind: 'snapshot', snapshot: { ...job.snapshot } },
      ]);
      return job.snapshot;
    });
  }

  async acknowledge(
    owner: string,
    attemptId: string,
    sequence: number,
  ): Promise<void> {
    await this.database.transaction(async db => {
      const job = await readJob(db, owner, attemptId, true);
      if (
        !isTerminal(job.snapshot.status) ||
        sequence !== job.snapshot.sequence
      ) {
        throw new RequestError(
          409,
          'Save the final reply before acknowledging it.',
        );
      }
      job.snapshot.delivered = true;
      job.snapshot.text = '';
      job.snapshot.reasoning = '';
      job.snapshot.checkpoint = null;
      job.snapshot.error = null;
      await writeJob(db, owner, job);
      await db.query(
        'UPDATE chat_jobs SET input = NULL WHERE owner = $1 AND attempt_id = $2',
        [owner, attemptId],
      );
      await db.query(
        'DELETE FROM chat_job_events WHERE owner = $1 AND attempt_id = $2',
        [owner, attemptId],
      );
    });
  }

  async deleteChat(owner: string, chatId: string): Promise<void> {
    await this.database.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        owner + chatId,
      ]);
      await db.query(
        'INSERT INTO deleted_chats (owner, chat_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [owner, chatId],
      );
      await db.query(
        'DELETE FROM chat_input_parts WHERE owner = $1 AND chat_id = $2',
        [owner, chatId],
      );
      const rows = await db.query(
        'SELECT state::text AS data FROM chat_jobs WHERE owner = $1 AND chat_id = $2 FOR UPDATE',
        [owner, chatId],
      );
      for (const row of rows.rows) {
        const job = decodeJson(storedJobSchema, row.data);
        job.snapshot.status = 'deleted';
        job.snapshot.cancelRequested = true;
        job.snapshot.text = '';
        job.snapshot.reasoning = '';
        job.snapshot.checkpoint = null;
        job.snapshot.error = null;
        await writeJob(db, owner, job);
        await db.query(
          'UPDATE chat_jobs SET input = NULL WHERE owner = $1 AND attempt_id = $2',
          [owner, job.snapshot.attemptId],
        );
        await db.query(
          'DELETE FROM chat_job_events WHERE owner = $1 AND attempt_id = $2',
          [owner, job.snapshot.attemptId],
        );
      }
    });
  }

  async reconcile(
    owner: string,
    attemptId: string,
    staleAfterMs: number,
  ): Promise<StoredJob> {
    return this.database.transaction(async db => {
      const job = await readJob(db, owner, attemptId, true);
      if (
        !isTerminal(job.snapshot.status) &&
        this.now() - job.heartbeat > staleAfterMs
      ) {
        job.snapshot.status = 'interrupted';
        job.snapshot.error = job.providerStarted
          ? 'The worker stopped before it could confirm completion. Retry creates a new answer.'
          : 'The job could not finish. Retry creates a new answer.';
        await appendEvents(db, owner, job, [
          { kind: 'snapshot', snapshot: { ...job.snapshot } },
        ]);
      }
      return job;
    });
  }
}
