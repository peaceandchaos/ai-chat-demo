import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ChatArchive, SavedMessage } from './archive';
import type { AttemptActivity, ChatSession } from './session';

export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'streaming' | 'done' | 'error';

export type Attachment = { uri: string; dataUrl: string };

export type Message = {
  id: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  attachments?: string[];
  reasoning?: string;
};

export type ChatViewState = {
  chatId: string;
  messages: Message[];
  isStreaming: boolean;
  send: (text: string, attachments?: Attachment[]) => SendResult;
  stop: () => void;
  newChat: () => void;
};

export type SendResult = 'saved' | 'unsaved';

export type ChatStore = StoreApi<ChatViewState>;

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

export function toMessage(
  saved: SavedMessage,
  activity: AttemptActivity,
  localImagePaths?: string[],
): Message {
  if (saved.role === 'user')
    return {
      id: saved.id,
      role: 'user',
      text: saved.text,
      status: 'done',
      attachments: localImagePaths,
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

const unavailable = 'Saved chats are unavailable.';

function settled(saved: SavedMessage): boolean {
  return saved.role === 'user' || saved.acknowledged;
}

export function createChatView(
  archive: ChatArchive,
  session: ChatSession,
  report: (error: string) => void,
): ChatStore {
  const rows = new Map<string, { saved: SavedMessage; view: Message }>();
  const sentImages = new Map<string, string[]>();

  function attempt<T>(action: () => T, invalid = unavailable): T | null {
    try {
      return action();
    } catch (error) {
      report(
        error instanceof Error && !(error instanceof z.ZodError)
          ? error.message
          : invalid,
      );
      return null;
    }
  }

  const view = (saved: SavedMessage): Message => {
    const previous = rows.get(saved.id)?.view;
    const next = toMessage(
      saved,
      session.activity(saved.id),
      sentImages.get(saved.id),
    );
    const kept = previous && sameMessage(previous, next) ? previous : next;
    rows.set(saved.id, { saved, view: kept });
    return kept;
  };

  const streaming = (messages: Message[]): boolean =>
    messages.at(-1)?.status === 'streaming';
  const show = (chatId: string, messages: Message[]): void =>
    store.setState({ chatId, messages, isStreaming: streaming(messages) });

  const rebuild = (chatId: string): void => {
    const path = session.path(archive.chat(chatId).leafId);
    rows.clear();
    show(chatId, path.map(view));
  };

  const refresh = (): void => {
    const { chatId, messages, isStreaming } = store.getState();
    let changed = false;
    const next = messages.map(message => {
      const row = rows.get(message.id);
      if (!row || settled(row.saved)) return message;
      const updated = view(session.message(message.id));
      if (updated !== message) changed = true;
      return updated;
    });
    if (changed || isStreaming !== streaming(next)) show(chatId, next);
  };

  const store = createStore<ChatViewState>()(() => ({
    chatId: '',
    messages: [],
    isStreaming: false,
    send: (text, attachments = []) => {
      const { chatId } = store.getState();
      // Only a new turn's images can fail the saved-message schema.
      const reply = attempt(
        () =>
          session.send(
            chatId,
            text,
            attachments.map(attachment => attachment.dataUrl),
          ),
        'These images can’t be sent.',
      );
      if (!reply) return 'unsaved';
      const userId = reply.parentId;
      if (userId && attachments.length > 0)
        sentImages.set(
          userId,
          attachments.map(attachment => attachment.uri),
        );
      const user = userId ? attempt(() => session.message(userId)) : null;
      const turn = user ? [user, reply] : [reply];
      show(chatId, [...store.getState().messages, ...turn.map(view)]);
      return 'saved';
    },
    stop: () => {
      const leaf = store.getState().messages.at(-1);
      if (leaf?.status === 'streaming') attempt(() => session.stop(leaf.id));
    },
    newChat: () =>
      attempt(() => {
        const current = archive.chat(store.getState().chatId);
        if (current.leafId !== null) rebuild(archive.createChat().id);
      }),
  }));

  rebuild(archive.metadata().currentChatId ?? archive.createChat().id);
  session.subscribe(refresh);
  return store;
}
