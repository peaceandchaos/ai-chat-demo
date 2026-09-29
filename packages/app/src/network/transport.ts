import type {
  AttemptSnapshot,
  SearchRequest,
  ServerMessage,
  Submission,
} from '../../../../shared/contracts';

export class TransportError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Receive = (message: ServerMessage) => void;

export interface ChatTransport {
  get(id: string, signal: AbortSignal): Promise<AttemptSnapshot>;
  submit(
    input: Submission,
    receive: Receive,
    signal: AbortSignal,
  ): Promise<void>;
  watch(
    snapshot: AttemptSnapshot,
    receive: Receive,
    signal: AbortSignal,
  ): Promise<void>;
  stop(id: string, signal: AbortSignal): Promise<AttemptSnapshot | null>;
  acknowledge(id: string, sequence: number, signal: AbortSignal): Promise<void>;
  deleteChat(id: string, signal: AbortSignal): Promise<void>;
  rank(input: SearchRequest, signal: AbortSignal): Promise<string[]>;
  disconnect(): void;
}
