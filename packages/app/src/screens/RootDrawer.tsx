import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import PagerView, {
  type PageScrollStateChangedNativeEvent,
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';
import { Freeze } from 'react-freeze';
import { KeyboardController } from 'react-native-keyboard-controller';
import { RecentsScreen } from './RecentsScreen';
import { ChatScreen } from './ChatScreen';
import { useChatStore } from '../state/chatStore';
import { theme } from '../theme';

const RECENTS_PAGE = 0;
const CHAT_PAGE = 1;

export function RootDrawer() {
  const pagerRef = useRef<PagerView>(null);

  const [activePage, setActivePage] = useState(CHAT_PAGE);
  const [isIdle, setIsIdle] = useState(true);

  const goToChat = () => pagerRef.current?.setPage(CHAT_PAGE);
  const goToRecents = () => pagerRef.current?.setPage(RECENTS_PAGE);

  const onPageSelected = useCallback((event: PagerViewOnPageSelectedEvent) => {
    const { position } = event.nativeEvent;
    setActivePage(position);
    if (position === RECENTS_PAGE) {
      KeyboardController.dismiss();
    }
  }, []);

  const onPageScrollStateChanged = useCallback(
    (event: PageScrollStateChangedNativeEvent) => {
      setIsIdle(event.nativeEvent.pageScrollState === 'idle');
    },
    [],
  );

  const startNewChat = useChatStore(state => state.newChat);

  const newChat = () => {
    startNewChat();
    goToChat();
  };

  return (
    <View style={styles.root}>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={CHAT_PAGE}
        onPageSelected={onPageSelected}
        onPageScrollStateChanged={onPageScrollStateChanged}
      >
        <View key="recents" style={styles.page}>
          <RecentsScreen onNewChat={newChat} />
        </View>
        <View key="chat" style={styles.page}>
          <Freeze freeze={isIdle && activePage !== CHAT_PAGE}>
            <ChatScreen onOpenRecents={goToRecents} />
          </Freeze>
        </View>
      </PagerView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.background,
  },
  pager: {
    flex: 1,
    backgroundColor: theme.background,
  },
  page: {
    flex: 1,
  },
});
