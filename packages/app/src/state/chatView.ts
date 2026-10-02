import { createStore, type StoreApi } from 'zustand/vanilla';
import { isActive, type ChatArchive, type SavedMessage } from './archive';
import type { AttemptActivity, ChatSession } from './session';

export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'streaming' | 'done' | 'error';

// A picked image: `uri` is the local file (for display), `dataUrl` is sent.
export type Attachment = { uri: string; dataUrl: string };

export type Message = {
  id: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  statusLabel?: string;
  attachments?: string[];
  reasoning?: string;
};

export type ChatViewState = {
  chatId: string;
  messages: Message[];
  isStreaming: boolean;
  // False when nothing was saved; the composer then keeps its input.
  send: (text: string, attachments?: Attachment[]) => boolean;
  stop: () => void;
  newChat: () => void;
};

export type ChatView = {
  store: StoreApi<ChatViewState>;
  dispose: () => void;
};

function replyStatus(
  saved: SavedMessage,
  activity: AttemptActivity,
): MessageStatus {
  if (activity.kind === 'halted') return 'error';
  switch (saved.status) {
    case 'completed':
    case 'stopped':
    case 'deleted':
      return 'done';
    case 'failed':
    case 'interrupted':
      return 'error';
    case 'pending':
    case 'accepted':
    case 'selecting':
    case 'compacting':
    case 'generating':
      return 'streaming';
  }
}

// attachments are local file paths for images sent in this process. Saved
// images exist only as data URLs, which the bubble cannot render yet.
export function toMessage(
  saved: SavedMessage,
  activity: AttemptActivity,
  attachments?: string[],
): Message {
  if (saved.role === 'user')
    return {
      id: saved.id,
      role: 'user',
      text: saved.text,
      status: 'done',
      attachments,
    };
  return {
    id: saved.id,
    role: 'assistant',
    text: saved.text,
    status: replyStatus(saved, activity),
    reasoning: saved.reasoning || undefined,
  };
}

function sameMessage(a: Message, b: Message): boolean {
  return (
    a.text === b.text &&
    a.status === b.status &&
    a.reasoning === b.reasoning &&
    a.attachments === b.attachments
  );
}

// Messages that can still change. A user turn never changes, and a reply
// stops changing once the server has its receipt.
function settled(saved: SavedMessage): boolean {
  return saved.role === 'user' || saved.acknowledged;
}

export function createChatView(
  archive: ChatArchive,
  session: ChatSession,
  report: (error: string) => void,
): ChatView {
  const sources = new Map<string, SavedMessage>();
  const views = new Map<string, Message>();
  const sentImages = new Map<string, string[]>();
  let ids: string[] = [];

  const view = (saved: SavedMessage): Message => {
    const previous = views.get(saved.id);
    const next = toMessage(
      saved,
      session.activity(saved.id),
      sentImages.get(saved.id),
    );
    const kept = previous && sameMessage(previous, next) ? previous : next;
    sources.set(saved.id, saved);
    views.set(saved.id, kept);
    return kept;
  };

  const leafActive = (): boolean => {
    const leaf = sources.get(ids.at(-1) ?? '');
    return leaf ? isActive(leaf) : false;
  };

  // Walks the path again. Only actions that move the chat's leaf call this.
  const rebuild = (chatId: string): void => {
    const path = session.path(archive.chat(chatId).leafId);
    ids = path.map(message => message.id);
    const onPath = new Set(ids);
    for (const id of sources.keys())
      if (!onPath.has(id)) {
        sources.delete(id);
        views.delete(id);
      }
    store.setState({
      chatId,
      messages: path.map(view),
      isStreaming: leafActive(),
    });
  };

  // Runs once per session notify, at most once per frame while replies stream.
  const refresh = (): void => {
    let changed = false;
    const messages = store.getState().messages.map(message => {
      const source = sources.get(message.id);
      if (!source || settled(source)) return message;
      const next = view(session.message(message.id));
      if (next !== message) changed = true;
      return next;
    });
    const isStreaming = leafActive();
    if (changed || isStreaming !== store.getState().isStreaming)
      store.setState({ messages, isStreaming });
  };

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Caught values are untyped; this reduces one to its message.
  const reportError = (error: unknown): void =>
    report(
      error instanceof Error ? error.message : 'Saved chats are unavailable.',
    );
  const guarded = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      reportError(error);
    }
  };

  const store = createStore<ChatViewState>()(() => ({
    chatId: '',
    messages: [],
    isStreaming: false,
    send: (text, attachments = []) => {
      const { chatId } = store.getState();
      let reply: SavedMessage;
      try {
        reply = session.send(
          chatId,
          text,
          attachments.map(attachment => attachment.dataUrl),
        );
      } catch (error) {
        reportError(error);
        return false;
      }
      if (reply.parentId && attachments.length > 0)
        sentImages.set(
          reply.parentId,
          attachments.map(attachment => attachment.uri),
        );
      guarded(() => rebuild(chatId));
      return true;
    },
    stop: () => {
      const leaf = sources.get(ids.at(-1) ?? '');
      if (leaf && isActive(leaf)) guarded(() => session.stop(leaf.id));
    },
    newChat: () =>
      guarded(() => {
        const current = archive.chat(store.getState().chatId);
        // An unsent chat stays the new chat instead of adding another record.
        if (current.leafId !== null) rebuild(archive.createChat().id);
      }),
  }));

  rebuild(archive.metadata().currentChatId ?? archive.createChat().id);
  const dispose = session.subscribe(refresh);
  return { store, dispose };
}
