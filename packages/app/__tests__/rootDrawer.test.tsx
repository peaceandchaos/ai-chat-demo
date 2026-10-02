import React from 'react';
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { RootDrawer } from '../src/screens/RootDrawer';

jest.mock('react-native-pager-view', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children: React.ReactNode }) => (
      <View testID="pager" {...props}>
        {children}
      </View>
    ),
  };
});
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardController: { dismiss: jest.fn() },
}));
jest.mock('../src/state/chatStore', () => ({
  useChatStore: <T,>(select: (state: { newChat: () => void }) => T): T =>
    select({ newChat: () => undefined }),
}));
jest.mock('../src/screens/RecentsScreen', () => {
  const { View } = require('react-native');
  return { RecentsScreen: () => <View testID="recents" /> };
});
jest.mock('../src/screens/ChatScreen', () => {
  const { View } = require('react-native');
  return { ChatScreen: () => <View testID="chat" /> };
});

function shownTestIDs(
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | null,
): string[] {
  if (node === null) {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(shownTestIDs);
  }
  const own = typeof node.props.testID === 'string' ? [node.props.testID] : [];
  const children = (node.children ?? []).flatMap(child =>
    typeof child === 'string' ? [] : shownTestIDs(child),
  );
  return [...own, ...children];
}

test('showing Recents keeps the chat page rendered', async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<RootDrawer />);
  });
  const pager = renderer.root.findByProps({ testID: 'pager' });

  await act(async () => {
    pager.props.onPageSelected({ nativeEvent: { position: 0 } });
    pager.props.onPageScrollStateChanged?.({
      nativeEvent: { pageScrollState: 'idle' },
    });
  });

  expect(shownTestIDs(renderer.toJSON())).toEqual(['pager', 'recents', 'chat']);
});
