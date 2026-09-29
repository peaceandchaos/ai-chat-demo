import React, { Suspense, useCallback, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { type LegendListRef } from '@legendapp/list/react-native';
import {
  KeyboardAwareLegendList,
  useKeyboardChatComposerInset,
  useKeyboardScrollToEnd,
} from '@legendapp/list/keyboard';
import {
  useChatStore,
  type Attachment,
  type Message,
} from '../state/chatStore';
import BootSplash from 'react-native-bootsplash';
import { ChatMessages } from '../components/ChatMessages';
import { MessageBubble } from '../components/MessageBubble';
import { Header } from '../components/Header';
import { Composer } from '../components/Composer';
import { EmptyState } from '../components/EmptyState';
import { ScrollToBottomButton } from '../components/ScrollToBottomButton';
import { theme } from '../theme';

// Cap for the anchored user bubble's reserved size (~2 lines + padding), per
// legend-list's AI-chat example.
const ANCHOR_MAX_SIZE = 2 * 21 + 32;

// load this lazily since we only need it when a reasoning trace is available
const ReasoningSheet = React.lazy(() =>
  import('../components/ReasoningSheet').then(m => ({
    default: m.ReasoningSheet,
  })),
);

type ChatScreenProps = {
  onOpenRecents: () => void;
};

export function ChatScreen({ onOpenRecents }: ChatScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const send = useChatStore(state => state.send);
  const stop = useChatStore(state => state.stop);
  const newChat = useChatStore(state => state.newChat);
  const messagesLength = useChatStore(state => state.messages.length);
  const isStreaming = useChatStore(state => state.isStreaming);
  const [composerHeight, setComposerHeight] = useState(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const listRef = useRef<LegendListRef>(null);
  const composerRef = useRef<View>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  // Once the reply overflows the reserved space, follow the tail
  const [following, setFollowing] = useState(false);
  const hasOverflowedRef = useRef(false);

  const openReasoning = useCallback((text: string) => {
    setReasoning(text);
  }, []);

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => (
      <MessageBubble message={item} onOpenReasoning={openReasoning} />
    ),
    [openReasoning],
  );

  const [anchorIndex, setAnchorIndex] = useState<number | undefined>(undefined);

  // Image messages are taller than the text cap; leave them uncapped so the top
  // of the image lands at the anchor offset instead of being clipped above it.
  const anchorHasImage = useChatStore(state =>
    anchorIndex != null
      ? (state.messages[anchorIndex]?.attachments?.length ?? 0) > 0
      : false,
  );

  const { contentInsetEndAdjustment, onComposerLayout: reportComposerInset } =
    useKeyboardChatComposerInset(listRef, composerRef);
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });

  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setComposerHeight(event.nativeEvent.layout.height);
      reportComposerInset(event);
    },
    [reportComposerInset],
  );

  const onSubmit = useCallback(
    (text: string, attachments: Attachment[]) => {
      const isFirstMessage = messagesLength === 0;
      hasOverflowedRef.current = false;
      setFollowing(false);
      setAnchorIndex(messagesLength);
      send(text, attachments);
      scrollMessageToEnd({ animated: !isFirstMessage, closeKeyboard: true });
    },
    [messagesLength, send, scrollMessageToEnd],
  );

  const keyboardOffset = { opened: insets.bottom };

  // The chevron shows whenever the bottom of the conversation isn't visible.
  const onEndVisible = useCallback((visible: boolean) => {
    setShowScrollDown(!visible);
    // Back at the bottom after a manual scroll-up: re-arm tail-follow
    if (visible && hasOverflowedRef.current) {
      setFollowing(true);
    }
  }, []);

  // A manual drag while the reply streams pauses tail-follow so the user can
  // scroll up (e.g. to read a table)
  const onScrollBeginDrag = useCallback(() => {
    if (hasOverflowedRef.current) {
      setFollowing(false);
    }
  }, []);

  const scrollToBottom = () => {
    scrollMessageToEnd({ animated: true, closeKeyboard: false });
  };

  return (
    <View style={styles.container}>
      <BootSplash.HideOnDraw fade />
      <ChatMessages>
        {messages => (
          <KeyboardAwareLegendList
            ref={listRef}
            style={styles.fill}
            data={messages}
            keyExtractor={(item: Message) => item.id}
            renderItem={renderMessage}
            // Let the bottom contentInset / anchored end-space area still catch scroll touches (RN 0.81+ hit-test bug, facebook/react-native#54123).
            applyWorkaroundForContentInsetHitTestBug
            maintainVisibleContentPosition={
              Platform.OS !== 'android'
                ? undefined
                : anchorIndex != null && !following
            }
            keyboardLiftBehavior="whenAtEnd"
            // Match the composer's keyboard offset or a gap opens between the last message and the keyboard.
            keyboardOffset={insets.bottom}
            contentInsetEndAdjustment={contentInsetEndAdjustment}
            freeze={freeze}
            anchoredEndSpace={
              anchorIndex != null
                ? {
                    anchorIndex,
                    anchorMaxSize: anchorHasImage ? undefined : ANCHOR_MAX_SIZE,
                    anchorOffset: insets.top + 56,
                    onSizeChanged: size => {
                      if (size <= 0 && !hasOverflowedRef.current) {
                        hasOverflowedRef.current = true;
                        setFollowing(true);
                      }
                    },
                  }
                : undefined
            }
            maintainScrollAtEnd={
              following
                ? { on: { dataChange: true, itemLayout: true } }
                : undefined
            }
            // Default threshold is too tight for fast streaming and permanently stops the follow.
            maintainScrollAtEndThreshold={1}
            estimatedItemSize={64}
            estimatedListSize={{ width: windowWidth, height: windowHeight }}
            onEndVisible={onEndVisible}
            onScrollBeginDrag={onScrollBeginDrag}
            contentContainerStyle={[
              styles.listContent,
              { paddingTop: insets.top + 56 },
            ]}
            keyboardDismissMode="interactive"
          />
        )}
      </ChatMessages>

      {messagesLength === 0 ? (
        <EmptyState composerHeight={composerHeight} />
      ) : null}

      <Header onNewChat={newChat} onOpenRecents={onOpenRecents} />

      <KeyboardStickyView
        offset={keyboardOffset}
        style={[styles.scrollDown, { bottom: composerHeight + 10 }]}
        pointerEvents="box-none"
      >
        {showScrollDown ? (
          <ScrollToBottomButton onPress={scrollToBottom} />
        ) : null}
      </KeyboardStickyView>

      <KeyboardStickyView offset={keyboardOffset} style={styles.composer}>
        <Composer
          composerRef={composerRef}
          onLayout={onComposerLayout}
          onSubmit={onSubmit}
          onStop={stop}
          streaming={isStreaming}
        />
      </KeyboardStickyView>

      {reasoning != null ? (
        <Suspense fallback={null}>
          <ReasoningSheet
            reasoning={reasoning}
            onDismiss={() => setReasoning(null)}
          />
        </Suspense>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  fill: {
    flex: 1,
  },
  composer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrollDown: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  listContent: {
    paddingBottom: 4,
  },
});
