import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useStore as mockUseStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { ChatScreen } from '../src/screens/ChatScreen';
import type { ChatViewState, Message } from '../src/state/chatView';

type ListProps = {
  initialScrollAtEnd?: boolean;
  maintainScrollAtEnd?: unknown;
  maintainVisibleContentPosition?: unknown;
  onScrollBeginDrag: () => void;
  onEndVisible: (visible: boolean) => void;
};
type RenderedList = { props?: ListProps };
const mockList: RenderedList = {};

jest.mock('@legendapp/list/keyboard', () => ({
  KeyboardAwareLegendList: (props: ListProps) => {
    mockList.props = props;
    return null;
  },
  useKeyboardChatComposerInset: () => ({
    contentInsetEndAdjustment: 0,
    onComposerLayout: () => undefined,
  }),
  useKeyboardScrollToEnd: () => ({
    freeze: false,
    scrollMessageToEnd: () => undefined,
  }),
}));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardStickyView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-native-bootsplash', () => ({ HideOnDraw: () => null }));
jest.mock('../src/components/Header', () => ({ Header: () => null }));
jest.mock('../src/components/Composer', () => ({ Composer: () => null }));
jest.mock('../src/components/EmptyState', () => ({ EmptyState: () => null }));
jest.mock('../src/components/MessageBubble', () => ({
  MessageBubble: () => null,
}));
jest.mock('../src/components/ScrollToBottomButton', () => ({
  ScrollToBottomButton: () => null,
}));

let mockStore: StoreApi<ChatViewState>;
jest.mock('../src/state/chatStore', () => ({
  useChatStore: <T,>(select: (current: ChatViewState) => T): T =>
    mockUseStore(mockStore, select),
}));

const followTail = { on: { dataChange: true, itemLayout: true } };

function chatState(isStreaming: boolean): ChatViewState {
  return {
    chatId: 'chat',
    messages: [
      { id: 'question', role: 'user', text: 'Question', status: 'done' },
      {
        id: 'reply',
        role: 'assistant',
        text: 'Partial',
        status: isStreaming ? 'streaming' : 'done',
      },
    ],
    isStreaming,
    recents: [],
    send: () => 'saved',
    stop: () => undefined,
    newChat: () => undefined,
    openChat: () => undefined,
    loadOlder: () => undefined,
  };
}

function openChat(isStreaming: boolean) {
  mockStore = createStore(() => chatState(isStreaming));
  act(() => {
    create(<ChatScreen onOpenRecents={() => undefined} />);
  });
  return {
    change: (messages: Message[]) => {
      act(() => mockStore.setState({ messages }));
      return mockList.props?.maintainVisibleContentPosition;
    },
    finish: () => {
      act(() => mockStore.setState(chatState(false)));
    },
  };
}

test('a reply still streaming when its chat opens, as after a relaunch, is followed to the end, and a drag pauses it', () => {
  const chat = openChat(true);
  expect(mockList.props?.initialScrollAtEnd).toBe(true);
  expect(mockList.props?.maintainScrollAtEnd).toEqual(followTail);

  act(() => mockList.props?.onScrollBeginDrag());
  expect(mockList.props?.maintainScrollAtEnd).toBeUndefined();

  act(() => mockList.props?.onEndVisible(true));
  expect(mockList.props?.maintainScrollAtEnd).toEqual(followTail);

  // The finished reply's action row is followed into view too.
  chat.finish();
  expect(mockList.props?.maintainScrollAtEnd).toEqual(followTail);
});

test('a chat whose reply has finished opens without following', () => {
  openChat(false);
  expect(mockList.props?.maintainScrollAtEnd).toBeUndefined();
});

test('the list holds the rows on screen only for the change that adds an older page', () => {
  const chat = openChat(true);
  const messages = () => mockStore.getState().messages;
  const older = (n: number): Message[] => [
    { id: `older-${n}`, role: 'user', text: 'Earlier', status: 'done' },
    { id: `older-${n}-reply`, role: 'assistant', text: 'Yes', status: 'done' },
  ];
  expect(mockList.props?.maintainVisibleContentPosition).toEqual({
    data: false,
  });

  expect(chat.change([...older(1), ...messages()])).toEqual({ data: true });
  const reply = messages()[messages().length - 1];
  expect(
    chat.change([
      ...messages().slice(0, -1),
      { ...reply, text: 'Partial and more' },
    ]),
  ).toEqual({ data: false });

  expect(chat.change([...older(2), ...messages()])).toEqual({ data: true });
  expect(
    chat.change([
      ...messages(),
      { id: 'next', role: 'user', text: 'Next', status: 'done' },
      { id: 'next-reply', role: 'assistant', text: '', status: 'streaming' },
    ]),
  ).toEqual({ data: false });
});
