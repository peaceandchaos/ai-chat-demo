import * as React from 'react';
import { useChatStore, type Message } from '../state/chatStore';

type ChatMessagesProps = {
  children: (messages: Message[]) => React.ReactElement;
};

export function ChatMessages({ children }: ChatMessagesProps) {
  const messages = useChatStore(state => state.messages);
  return children(messages);
}
