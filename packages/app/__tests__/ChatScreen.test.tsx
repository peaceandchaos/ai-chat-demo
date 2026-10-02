import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ChatScreen } from '../src/screens/ChatScreen';
import type { ChatViewState } from '../src/state/chatView';

type ListProps = {
  initialScrollAtEnd?: boolean;
  maintainScrollAtEnd?: unknown;
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

let mockState: ChatViewState;
jest.mock('../src/state/chatStore', () => ({
  useChatStore: <T,>(select: (current: ChatViewState) => T): T =>
    select(mockState),
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
    send: () => 'saved',
    stop: () => undefined,
    newChat: () => undefined,
  };
}

function openChat(isStreaming: boolean) {
  mockState = chatState(isStreaming);
  const screen = () => <ChatScreen onOpenRecents={() => undefined} />;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(screen());
  });
  return {
    finish: () => {
      mockState = chatState(false);
      act(() => renderer.update(screen()));
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
