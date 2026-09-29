// OpenAI Responses API over WebSocket.
// Shapes verified from:
//   https://developers.openai.com/api/docs/guides/websocket-mode
//   https://developers.openai.com/api/docs/guides/streaming-responses
import { OPENAI_MODEL } from '../config';

const SEARCH_TOOL = {
  type: 'function',
  name: 'search_margelo_kb',
  description:
    "Search Margelo's knowledge base for facts about the company Margelo: its services, clients, work, open-source libraries, its founder (Marc Rousavy), and its team and culture. Call this whenever the user asks anything about Margelo, its people, or its libraries, and answer only from the returned context, never from memory. When asked what Margelo is, give a concise overview and mention its founder.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'A natural-language search query for the knowledge base.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

// Shared response.create envelope. previous_response_id links to the prior
// response held in the connection-local cache; it's omitted for the first turn.
// Reasoning summaries are opt-in (the raw chain-of-thought is never exposed):
// https://developers.openai.com/api/docs/guides/reasoning
function buildRequest(
  input: Array<Record<string, unknown>>,
  previousResponseId: string | undefined,
): string {
  return JSON.stringify({
    type: 'response.create',
    model: OPENAI_MODEL,
    store: false,
    reasoning: { summary: 'auto' },
    input,
    tools: [SEARCH_TOOL],
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  });
}

export function buildResponseCreate(
  text: string,
  previousResponseId: string | undefined,
  images: string[] = [],
): string {
  const content: Array<Record<string, unknown>> = [];
  if (text) {
    content.push({ type: 'input_text', text });
  }
  for (const imageUrl of images) {
    content.push({ type: 'input_image', image_url: imageUrl });
  }

  return buildRequest(
    [{ type: 'message', role: 'user', content }],
    previousResponseId,
  );
}

// Continues a response that made a function call: sends the tool result back so
// the model can finish. previous_response_id is required here to link to the
// function-call response the model is waiting on.
export function buildFunctionCallOutput(
  callId: string,
  output: string,
  previousResponseId: string,
): string {
  return buildRequest(
    [{ type: 'function_call_output', call_id: callId, output }],
    previousResponseId,
  );
}

//

type ServerEvent = { type: string; [key: string]: unknown };

// A short human label shown while the assistant has no text yet, derived from
// the response lifecycle events.
export type ParsedServerEvent =
  | { kind: 'status'; label: string }
  | { kind: 'delta'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'completed'; responseId: string }
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'error'; code?: string; message: string }
  | { kind: 'ignored'; type: string };

export function parseServerEvent(raw: string): ParsedServerEvent {
  let event: ServerEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return { kind: 'ignored', type: '<unparseable>' };
  }

  switch (event.type) {
    // Lifecycle → "Thinking" until the first token.
    case 'response.created':
    case 'response.in_progress':
      return { kind: 'status', label: 'Thinking' };

    // An output item started: reasoning vs. the actual reply.
    case 'response.output_item.added': {
      const itemType = (event as { item?: { type?: string } }).item?.type;
      if (itemType === 'reasoning') {
        return { kind: 'status', label: 'Thinking' };
      }
      if (itemType === 'function_call') {
        return { kind: 'status', label: 'Searching Margelo docs' };
      }
      if (itemType === 'message') {
        return { kind: 'status', label: 'Responding' };
      }
      return { kind: 'ignored', type: event.type };
    }

    // Streamed reasoning-summary text (the shareable "thinking" trace, distinct
    // from the hidden chain-of-thought). Accumulate the deltas like the answer.
    // event name + `delta` field:
    //   https://community.openai.com/t/responses-api-streaming-the-simple-guide-to-events/1363122
    //   https://github.com/openai/openai-python/issues/2311
    case 'response.reasoning_summary_text.delta':
      return {
        kind: 'reasoning',
        text: (event as { delta?: string }).delta ?? '',
      };

    case 'response.output_text.delta':
      return { kind: 'delta', text: (event as { delta?: string }).delta ?? '' };

    case 'response.completed':
      return {
        kind: 'completed',
        responseId:
          (event as { response?: { id?: string } }).response?.id ?? '',
      };

    case 'response.output_item.done': {
      const item = (
        event as {
          item?: {
            type?: string;
            call_id?: string;
            name?: string;
            arguments?: string;
          };
        }
      ).item;
      if (item?.type === 'function_call') {
        return {
          kind: 'tool_call',
          callId: item.call_id ?? '',
          name: item.name ?? '',
          args: item.arguments ?? '',
        };
      }
      return { kind: 'ignored', type: event.type };
    }

    case 'response.failed':
    case 'error': {
      const e = event as {
        error?: { message?: string; code?: string };
        response?: { error?: { message?: string; code?: string } };
        message?: string;
      };
      return {
        kind: 'error',
        code: e.error?.code ?? e.response?.error?.code,
        message:
          e.error?.message ??
          e.response?.error?.message ??
          e.message ??
          'Unknown error',
      };
    }

    default:
      return { kind: 'ignored', type: event.type };
  }
}
