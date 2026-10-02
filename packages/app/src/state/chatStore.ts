import { useStore } from 'zustand';
import { chatView } from './appSession';
import type { ChatViewState } from './chatView';

export type {
  Attachment,
  Message,
  MessageRole,
  MessageStatus,
} from './chatView';

// Screens mount only after startAppSession() resolves.
export function useChatStore<T>(selector: (state: ChatViewState) => T): T {
  return useStore(chatView().store, selector);
}
