import type { PGlite } from '@electric-sql/pglite';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  decodeJson,
  socketCommandSchema,
  type ContextCheckpoint,
  type ModelKey,
  type Picker,
  type ServerMessage,
  type Submission,
} from '../../../shared/contracts';
import { ChatArchive, type ArchiveStorage } from '../../app/src/state/archive';
import {
  ServerTransport,
  type ClientDrivers,
  type ClientReader,
  type ClientResponse,
  type ClientSocket,
} from '../../app/src/network/client';
import { ChatSession } from '../../app/src/state/session';
import { executeCommand, handleRequest, type ApiServices } from '../src/api';
import { deviceOwner } from '../src/auth';
import { deliverJob } from '../src/delivery';
import { ProviderFailure, RequestError } from '../src/errors';
import { JobRepository } from '../src/jobs';
import type {
  PreparedContext,
  ProviderChunk,
  Providers,
} from '../src/provider';
import { runAttempt } from '../src/worker';
import { testDatabase } from './database';

export class MemoryStorage implements ArchiveStorage {
  readonly values: Map<string, string>;
  readonly writes: string[] = [];
  failing = false;
  constructor(values = new Map<string, string>()) {
    this.values = new Map(values);
  }
  getString(key: string) {
    return this.values.get(key);
  }
  getAllKeys() {
    return [...this.values.keys()];
  }
  set(key: string, value: string) {
    if (this.failing) throw new Error('Simulated storage failure');
    this.writes.push(key);
    this.values.set(key, value);
  }
  remove(key: string) {
    if (this.failing) throw new Error('Simulated storage failure');
    this.values.delete(key);
  }
  // What a terminated process leaves on disk.
  snapshot(): MemoryStorage {
    return new MemoryStorage(this.values);
  }
}

type Step =
  | { kind: 'text'; text: string }
  | { kind: 'end'; checkpoint: ContextCheckpoint | null }
  | { kind: 'fail' };

// The provider side of one attempt. The test decides when each chunk arrives.
export class Script {
  private readonly steps: Step[] = [];
  private wake: (() => void) | null = null;
  text(...pieces: string[]): this {
    for (const text of pieces) this.push({ kind: 'text', text });
    return this;
  }
  end(checkpoint: ContextCheckpoint | null = null): this {
    this.push({ kind: 'end', checkpoint });
    return this;
  }
  fail(): this {
    this.push({ kind: 'fail' });
    return this;
  }
  private push(step: Step) {
    this.steps.push(step);
    this.wake?.();
  }
  async next(signal: AbortSignal): Promise<Step> {
    for (;;) {
      signal.throwIfAborted();
      const step = this.steps.shift();
      if (step) return step;
      await new Promise<void>(resolve => {
        this.wake = resolve;
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      this.wake = null;
    }
  }
}

function providerChunk(model: ModelKey, text: string): ProviderChunk {
  return model === 'kimi' || model === 'deepseek'
    ? {
        wire: 'gateway',
        text,
        raw: JSON.stringify({
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: text } }],
        }),
      }
    : {
        wire: 'responses',
        text,
        raw: JSON.stringify({
          type: 'response.output_text.delta',
          delta: text,
        }),
      };
}

export class FakeProviders implements Providers {
  selection: ModelKey | 'fail' = 'deepseek';
  selections = 0;
  readonly generations: { input: Submission; model: ModelKey }[] = [];
  private readonly scripts = new Map<string, Script>();

  script(attemptId: string): Script {
    const existing = this.scripts.get(attemptId);
    if (existing) return existing;
    const script = new Script();
    this.scripts.set(attemptId, script);
    return script;
  }

  async select(
    _input: Submission,
    _signal: AbortSignal,
    beforeCall: () => Promise<void>,
  ): Promise<ModelKey> {
    await beforeCall();
    this.selections += 1;
    if (this.selection === 'fail')
      throw new ProviderFailure('The model chooser could not answer.');
    return this.selection;
  }

  async prepare() {
    return { items: [], checkpoint: null };
  }

  async generate(
    input: Submission,
    model: ModelKey,
    _context: PreparedContext,
    signal: AbortSignal,
    onChunk: (chunk: ProviderChunk) => Promise<void>,
    beforeCall: () => Promise<void>,
  ) {
    await beforeCall();
    this.generations.push({ input, model });
    const script = this.script(input.attemptId);
    for (;;) {
      const step = await script.next(signal);
      if (step.kind === 'end') return { checkpoint: step.checkpoint };
      if (step.kind === 'fail')
        throw new ProviderFailure('The provider stopped responding.', true);
      await onChunk(providerChunk(model, step.text));
    }
  }
}

// Controls what the phone's network does, independently of the server.
export class Network {
  online = true;
  private dropNext: ((url: string, method: string) => boolean) | null = null;
  private readonly readers = new Set<CuttableReader>();
  readonly requests: string[] = [];
  beforeRequest: ((method: string, path: string) => void) | null = null;

  // The server handles the next matching request, but its response is lost.
  loseResponse(match: (url: string, method: string) => boolean): void {
    this.dropNext = match;
  }
  shouldLose(url: string, method: string): boolean {
    if (!this.dropNext?.(url, method)) return false;
    this.dropNext = null;
    return true;
  }
  track(reader: CuttableReader): void {
    this.readers.add(reader);
  }
  release(reader: CuttableReader): void {
    this.readers.delete(reader);
  }
  cutStreams(): void {
    for (const reader of this.readers) reader.cut();
  }
  get openStreams(): number {
    return this.readers.size;
  }
}

class CuttableReader implements ClientReader {
  private cutError: ((error: Error) => void) | null = null;
  private readonly cutSignal = new Promise<never>((_resolve, reject) => {
    this.cutError = reject;
  });
  constructor(
    private readonly inner: ReadableStreamDefaultReader<Uint8Array>,
    private readonly network: Network,
    private readonly duplicate: boolean,
  ) {
    this.cutSignal.catch(() => undefined);
    network.track(this);
  }
  cut() {
    this.cutError?.(new TypeError('Network connection lost'));
  }
  async read(): Promise<{ done: boolean; value?: Uint8Array }> {
    const chunk = await Promise.race([this.inner.read(), this.cutSignal]);
    if (chunk.done || !this.duplicate) return chunk;
    // At-least-once delivery: every record arrives twice.
    const value = new Uint8Array(chunk.value.length * 2);
    value.set(chunk.value);
    value.set(chunk.value, chunk.value.length);
    return { done: false, value };
  }
  cancel() {
    this.network.release(this);
    return this.inner.cancel();
  }
  releaseLock() {
    this.network.release(this);
    this.inner.releaseLock();
  }
}

export type Server = {
  postgres: PGlite;
  jobs: JobRepository;
  services: ApiServices;
  owner: string;
  device: string;
  providers: FakeProviders;
  dispatched: string[];
  duplicateDelivery: boolean;
  settle: () => Promise<void>;
};

export async function startServer(): Promise<Server> {
  const { database, postgres } = await testDatabase();
  const jobs = new JobRepository(database);
  const device = randomBytes(32).toString('base64url');
  const owner = deviceOwner(new Headers({ 'X-Device-Id': device }), device);
  const providers = new FakeProviders();
  const dispatched: string[] = [];
  const workers = new Set<Promise<void>>();
  const services: ApiServices = {
    allowlist: device,
    jobs: () => Promise.resolve(jobs),
    rank: () => Promise.resolve([]),
    // Durable dispatch starts the real worker asynchronously, as Workflow does.
    dispatch(dispatchOwner, attemptId) {
      dispatched.push(attemptId);
      const runId = `run-${dispatched.length}`;
      const worker = runAttempt({
        jobs,
        providers,
        owner: dispatchOwner,
        attemptId,
        runId,
        claimId: randomUUID(),
        heartbeatMs: 10,
        timeoutMs: 20_000,
        publish: () => Promise.resolve(),
      });
      workers.add(worker);
      void worker.finally(() => workers.delete(worker));
      return Promise.resolve(runId);
    },
  };
  return {
    postgres,
    jobs,
    services,
    owner,
    device,
    providers,
    dispatched,
    duplicateDelivery: false,
    async settle() {
      await Promise.allSettled([...workers]);
    },
  };
}

function fetchDriver(server: Server, network: Network): ClientDrivers['fetch'] {
  return async (url, init) => {
    const method = init.method ?? 'GET';
    const path = new URL(url).pathname;
    network.requests.push(`${method} ${path}`);
    network.beforeRequest?.(method, path);
    if (!network.online) throw new TypeError('Network request failed');
    const { stream: _stream, ...requestInit } = init;
    const response = await handleRequest(
      new Request(url, requestInit),
      server.services,
    );
    if (network.shouldLose(url, method)) {
      await response.body?.cancel();
      throw new TypeError('Network connection lost');
    }
    const body = response.body;
    const result: ClientResponse = {
      ok: response.ok,
      status: response.status,
      text: () => response.text(),
      body: body
        ? {
            getReader: () =>
              new CuttableReader(
                body.getReader(),
                network,
                server.duplicateDelivery,
              ),
          }
        : null,
    };
    return result;
  };
}

// The Nitro WebSocket route cannot run in-process: it reads process.env and
// the runtime database. This socket repeats that route's message handling
// (packages/server/src/http/routes/v1/responses.ts) over the same server
// functions: executeCommand for commands and deliverJob for delivery.
class InProcessSocket implements ClientSocket {
  readyState = 'CONNECTING';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((error: string) => void) | null = null;
  private readonly readers = new Map<string, AbortController>();
  private readonly owner: string | null;

  constructor(
    private readonly server: Server,
    network: Network,
    headers: Record<string, string>,
  ) {
    let owner: string | null = null;
    try {
      owner = deviceOwner(new Headers(headers), server.services.allowlist);
    } catch {
      owner = null;
    }
    this.owner = owner;
    setTimeout(() => {
      if (!network.online) {
        this.readyState = 'CLOSED';
        this.onerror?.('offline');
        return;
      }
      if (!this.owner) {
        this.close(1008);
        return;
      }
      this.readyState = 'OPEN';
      this.onopen?.();
    }, 0);
  }

  private emit(message: ServerMessage) {
    if (this.readyState !== 'OPEN') return Promise.resolve();
    const data = JSON.stringify(message);
    setTimeout(() => this.onmessage?.({ data }), 0);
    return Promise.resolve();
  }

  send(data: string): void {
    void this.handle(data);
  }

  private async handle(raw: string) {
    let attemptId: string | null = null;
    const owner = this.owner;
    if (!owner) return;
    try {
      if (Buffer.byteLength(raw, 'utf8') > 4_000_000)
        throw new RequestError(413, 'Split large input into context parts.');
      const command = decodeJson(socketCommandSchema, raw);
      attemptId =
        command.kind === 'submit'
          ? command.submission.attemptId
          : command.attemptId;
      const result = await executeCommand(owner, command, this.server.services);
      if (this.readyState !== 'OPEN') return;
      if (result.kind !== 'accepted') {
        await this.emit(result);
        return;
      }
      const replyId = attemptId;
      this.readers.get(replyId)?.abort();
      const controller = new AbortController();
      this.readers.set(replyId, controller);
      void deliverJob(
        this.server.jobs,
        owner,
        replyId,
        controller.signal,
        message => this.emit(message),
      )
        .then(() => {
          if (!controller.signal.aborted)
            return this.emit({ kind: 'detached', attemptId: replyId });
        })
        .catch(() =>
          this.emit({
            kind: 'error',
            attemptId: replyId,
            message:
              'Delivery was interrupted. Reconnect to recover this reply.',
          }),
        )
        .finally(() => {
          if (this.readers.get(replyId) === controller)
            this.readers.delete(replyId);
        });
    } catch (error) {
      await this.emit({
        kind: 'error',
        attemptId,
        status:
          error instanceof RequestError
            ? error.status
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? 400
              : 503,
        message:
          error instanceof RequestError
            ? error.message
            : 'The server could not accept this request.',
      });
    }
  }

  close(code = 1000): void {
    if (this.readyState === 'CLOSED') return;
    this.readyState = 'CLOSED';
    for (const reader of this.readers.values()) reader.abort();
    this.readers.clear();
    this.onclose?.({ code });
  }
}

export type Phone = {
  storage: MemoryStorage;
  archive: ChatArchive;
  transport: ServerTransport;
  session: ChatSession;
  network: Network;
};

let idCounter = 0;
export function uuid(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, '0')}`;
}

export function openPhone(
  server: Server,
  storage = new MemoryStorage(),
  network = new Network(),
  checkpointMs = 40,
): Phone {
  const archive = new ChatArchive(storage, uuid);
  archive.recover();
  const transport = new ServerTransport(
    'http://127.0.0.1:8787',
    server.device,
    {
      fetch: fetchDriver(server, network),
      socket: (_url, headers) => new InProcessSocket(server, network, headers),
      decoder: () => new TextDecoder(),
    },
    true,
  );
  const session = new ChatSession({
    archive,
    transport,
    scheduleFrame: callback => setTimeout(callback, 0),
    checkpointMs,
    retryBaseMs: 10,
    retryMaxMs: 60,
  });
  session.setLifecycle('active');
  return { storage, archive, transport, session, network };
}

export async function until(
  label: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`Timed out waiting until ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

export async function serverSnapshot(server: Server, attemptId: string) {
  return (await server.jobs.get(server.owner, attemptId)).snapshot;
}

export async function shutdown(server: Server, ...phones: Phone[]) {
  for (const phone of phones) phone.session.setLifecycle('background');
  for (const id of server.dispatched)
    await server.jobs.requestCancellation(server.owner, id);
  await server.settle();
  await server.postgres.close();
}

// Reads what a restarted process would find on disk.
export function reopen(storage: MemoryStorage): ChatArchive {
  const archive = new ChatArchive(storage.snapshot(), uuid);
  archive.recover();
  return archive;
}

export function createChat(phone: Phone, picker: Picker) {
  const chat = phone.archive.createChat();
  phone.archive.setPicker(chat.id, picker);
  return phone.archive.chat(chat.id);
}

export function settled(phone: Phone, attemptId: string) {
  return until(`reply ${attemptId} is settled`, () => {
    try {
      return !phone.archive.metadata().jobIds.includes(attemptId);
    } catch {
      return false;
    }
  });
}
