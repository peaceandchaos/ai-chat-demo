import { defineWebSocketHandler } from 'nitro';
import {
  decodeJson,
  socketCommandSchema,
  type ServerMessage,
} from '../../../../../../shared/contracts';
import { executeCommand } from '../../../api';
import { deviceOwner } from '../../../auth';
import { deliverJob } from '../../../delivery';
import { RequestError } from '../../../errors';
import { services } from '../../../services';

const readers = new Map<string, Map<string, AbortController>>();

export default defineWebSocketHandler({
  upgrade(request) {
    deviceOwner(request.headers, process.env.ALLOWED_DEVICE_IDS ?? '');
  },
  async message(peer, message) {
    const send = (value: ServerMessage) => {
      peer.send(JSON.stringify(value));
      return Promise.resolve();
    };
    let attemptId: string | null = null;
    try {
      const runtime = services();
      const owner = deviceOwner(peer.request.headers, runtime.allowlist);
      const raw = message.text();
      if (Buffer.byteLength(raw, 'utf8') > 4_000_000)
        throw new RequestError(413, 'Split large input into context parts.');
      const command = decodeJson(socketCommandSchema, raw);
      attemptId =
        command.kind === 'submit'
          ? command.submission.attemptId
          : command.attemptId;
      const result = await executeCommand(owner, command, runtime);
      if (peer.websocket.readyState !== 1) return;
      if (result.kind !== 'accepted') {
        await send(result);
        return;
      }
      const feeds = readers.get(peer.id) ?? new Map<string, AbortController>();
      readers.set(peer.id, feeds);
      feeds.get(attemptId)?.abort();
      const controller = new AbortController();
      feeds.set(attemptId, controller);
      const replyId = attemptId;
      void deliverJob(
        await runtime.jobs(),
        owner,
        replyId,
        controller.signal,
        send,
      )
        .then(() => {
          if (!controller.signal.aborted)
            return send({ kind: 'detached', attemptId: replyId });
        })
        .catch(() =>
          send({
            kind: 'error',
            attemptId: replyId,
            message:
              'Delivery was interrupted. Reconnect to recover this reply.',
          }),
        )
        .finally(() => {
          if (feeds.get(replyId) === controller) feeds.delete(replyId);
        });
    } catch (error) {
      if (error instanceof Response && error.status === 401) {
        peer.close(1008, 'Unauthorized');
        return;
      }
      await send({
        kind: 'error',
        attemptId,
        message:
          error instanceof RequestError
            ? error.message
            : 'The server could not accept this request.',
      });
    }
  },
  close(peer) {
    for (const reader of readers.get(peer.id)?.values() ?? []) reader.abort();
    readers.delete(peer.id);
  },
});
