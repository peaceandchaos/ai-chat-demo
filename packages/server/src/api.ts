import { z } from 'zod';
import {
  decodeJson,
  idSchema,
  searchRequestSchema,
  socketCommandSchema,
  type SearchRequest,
  type ServerMessage,
  type SocketCommand,
} from '../../../shared/contracts';
import { deviceOwner } from './auth';
import { jobStream } from './delivery';
import { RequestError } from './errors';
import { InputParts } from './input-parts';
import type { Dispatcher, JobRepository } from './jobs';

export type ApiServices = {
  allowlist: string;
  jobs: () => Promise<JobRepository>;
  dispatch: Dispatcher;
  rank: (input: SearchRequest, signal: AbortSignal) => Promise<string[]>;
};

const acknowledgeSchema = z.strictObject({
  sequence: z.number().int().nonnegative().safe(),
});
const maxRequestBytes = 4_000_000;

export async function readBody(request: Request): Promise<string> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    throw new RequestError(415, 'Send JSON.');
  if (!request.body) throw new RequestError(400, 'Missing request body.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      size += chunk.value.byteLength;
      if (size > maxRequestBytes)
        throw new RequestError(
          413,
          'Split large conversation input into context parts.',
        );
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function errorResponse(error: Error | Response): Response {
  if (error instanceof Response) return error;
  if (error instanceof RequestError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return Response.json(
      { error: 'Invalid request data or contract version.' },
      { status: 400 },
    );
  return Response.json(
    { error: 'The server could not complete this request.' },
    { status: 503 },
  );
}

export async function executeCommand(
  owner: string,
  command: SocketCommand,
  services: ApiServices,
): Promise<ServerMessage> {
  const jobs = await services.jobs();
  switch (command.kind) {
    case 'stage':
      await new InputParts(jobs).stage(owner, command);
      return {
        kind: 'staged',
        attemptId: command.attemptId,
        index: command.index,
      };
    case 'commit': {
      const job = await new InputParts(jobs).commit(
        owner,
        command,
        services.dispatch,
      );
      return { kind: 'accepted', snapshot: job.snapshot };
    }
    case 'submit': {
      const job = await jobs.submit(
        owner,
        command.submission,
        services.dispatch,
      );
      return { kind: 'accepted', snapshot: job.snapshot };
    }
    case 'attach': {
      const job = await jobs.reconcile(owner, command.attemptId, 330_000);
      return { kind: 'accepted', snapshot: job.snapshot };
    }
  }
}

async function handleJobRoute(
  request: Request,
  owner: string,
  id: string,
  action: string | undefined,
  services: ApiServices,
): Promise<Response> {
  const attemptId = idSchema.parse(id);
  const jobs = await services.jobs();
  if (request.method === 'GET' && !action)
    return Response.json(
      (await jobs.reconcile(owner, attemptId, 330_000)).snapshot,
      { headers: { 'Cache-Control': 'no-store' } },
    );
  if (request.method === 'GET' && action === 'events') {
    await jobs.get(owner, attemptId);
    return jobStream(jobs, owner, attemptId, request.signal);
  }
  if (request.method === 'POST' && action === 'stop')
    return Response.json(await jobs.cancel(owner, attemptId));
  if (request.method === 'POST' && action === 'ack') {
    const body = decodeJson(acknowledgeSchema, await readBody(request));
    await jobs.acknowledge(owner, attemptId, body.sequence);
    return new Response(null, { status: 204 });
  }
  throw new RequestError(404, 'Route not found.');
}

export async function handleRequest(
  request: Request,
  services: ApiServices,
): Promise<Response> {
  try {
    const owner = deviceOwner(request.headers, services.allowlist);
    const path = new URL(request.url).pathname.split('/').filter(Boolean);
    if (path[0] !== 'v1') throw new RequestError(404, 'Route not found.');
    if (path[1] === 'chat' && path.length === 2 && request.method === 'POST') {
      const command = decodeJson(socketCommandSchema, await readBody(request));
      const result = await executeCommand(owner, command, services);
      if (result.kind !== 'accepted') return Response.json(result);
      return jobStream(
        await services.jobs(),
        owner,
        result.snapshot.attemptId,
        request.signal,
      );
    }
    if (path[1] === 'jobs' && path[2] && path.length <= 4)
      return await handleJobRoute(request, owner, path[2], path[3], services);
    if (
      path[1] === 'chats' &&
      path[2] &&
      path.length === 3 &&
      request.method === 'DELETE'
    ) {
      await (await services.jobs()).deleteChat(owner, idSchema.parse(path[2]));
      return new Response(null, { status: 204 });
    }
    if (
      path[1] === 'search' &&
      path.length === 2 &&
      request.method === 'POST'
    ) {
      const body = decodeJson(searchRequestSchema, await readBody(request));
      return Response.json({ ids: await services.rank(body, request.signal) });
    }
    throw new RequestError(404, 'Route not found.');
  } catch (error) {
    return errorResponse(
      error instanceof Error || error instanceof Response
        ? error
        : new Error('Request failed.'),
    );
  }
}
