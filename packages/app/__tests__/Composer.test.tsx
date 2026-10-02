import React from 'react';
import { TextInput, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Composer } from '../src/components/Composer';

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: require('react-native').View },
  Easing: { inOut: () => undefined, ease: undefined },
  useAnimatedStyle: () => ({}),
  withTiming: () => 0,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-native-nitro-image', () => ({ NitroImage: () => null }));
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));
jest.mock('../src/components/AttachmentMenu', () => ({
  AttachmentMenu: () => null,
}));
jest.mock('../src/components/Glass', () => ({
  Glass: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../src/components/Icon', () => ({ Icon: () => null }));

function renderComposer(saved: boolean) {
  const onSubmit = jest.fn(() => saved);
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Composer
        onSubmit={onSubmit}
        onStop={() => undefined}
        streaming={false}
        composerRef={React.createRef<View>()}
        onLayout={() => undefined}
      />,
    );
  });
  const input = () => renderer.root.findByType(TextInput);
  act(() => {
    input().props.onChangeText('Draft');
  });
  const send = renderer.root.find(
    node => node.props.hitSlop === 6 && node.props.disabled === false,
  );
  act(() => {
    send.props.onPress();
  });
  return { onSubmit, text: input().props.value };
}

test('the composer keeps its text when the message was not saved', () => {
  const { onSubmit, text } = renderComposer(false);
  expect(onSubmit).toHaveBeenCalledWith('Draft', []);
  expect(text).toBe('Draft');
});

test('the composer clears its text once the message is saved', () => {
  expect(renderComposer(true).text).toBe('');
});
