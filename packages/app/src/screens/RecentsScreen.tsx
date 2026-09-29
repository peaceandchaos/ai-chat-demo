import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  LegendList,
  type LegendListRenderItemProps,
} from '@legendapp/list/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '../components/Glass';
import { Icon } from '../components/Icon';
import { showNotImplemented } from '../notImplemented';
import { theme } from '../theme';

type Recent = { id: string; title: string; time: string };

// Mocked recents for the UI; real multi-conversation history is a later
// change to useChat + storage.
const RECENTS: Recent[] = [
  { id: '1', title: 'Explaining the Fourier transform', time: '3d ago' },
  { id: '2', title: 'Debugging a Reanimated layout jump', time: '3d ago' },
  { id: '3', title: 'Weekend trip ideas near Lisbon', time: '3d ago' },
  { id: '4', title: 'Rewriting a cover letter', time: '4d ago' },
  { id: '5', title: 'Sourdough starter troubleshooting', time: '4d ago' },
  { id: '6', title: 'Who founded Margelo?', time: 'Nov 22, 2025' },
  { id: '7', title: 'What does Margelo do?', time: 'Nov 20, 2025' },
  { id: '8', title: 'Margelo open-source libraries', time: 'Oct 26, 2025' },
  { id: '9', title: 'How the Nitro modules work', time: 'Oct 24, 2025' },
];

type RecentsScreenProps = {
  onNewChat: () => void;
};

export function RecentsScreen({ onNewChat }: RecentsScreenProps) {
  const insets = useSafeAreaInsets();

  // Loading a past conversation isn't built for this demo, so tapping a row
  // surfaces the not-implemented notice rather than opening a fake chat.
  const renderRecent = useCallback(
    ({ item }: LegendListRenderItemProps<Recent>) => (
      <Pressable style={styles.row} onPress={showNotImplemented}>
        <View style={styles.rowText}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.time}>{item.time}</Text>
        </View>
      </Pressable>
    ),
    [],
  );

  return (
    <View style={styles.container}>
      <View style={[styles.topRow, { paddingTop: insets.top + 8 }]}>
        <View style={styles.search}>
          <Icon name="magnifyingglass" size={18} color={theme.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            placeholderTextColor={theme.textSecondary}
          />
        </View>
      </View>

      <LegendList
        data={RECENTS}
        keyExtractor={item => item.id}
        estimatedItemSize={66}
        recycleItems
        ListHeaderComponent={<Text style={styles.section}>History</Text>}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={renderRecent}
      />

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable style={styles.newChatWrap} onPress={onNewChat} hitSlop={8}>
          <Glass interactive style={styles.newChat}>
            <Icon name="plus" size={16} />
            <Text style={styles.newChatText}>New Chat</Text>
          </Glass>
        </Pressable>
        <Pressable onPress={showNotImplemented} hitSlop={8}>
          <Glass interactive style={styles.circle}>
            <Icon name="gearshape" size={20} />
          </Glass>
        </Pressable>
      </View>
    </View>
  );
}

const CIRCLE = 44;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    paddingHorizontal: 16,
    backgroundColor: theme.glassFallbackBackground,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    color: theme.text,
    padding: 0,
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  section: {
    color: theme.textSecondary,
    fontSize: 16,
    fontWeight: '500',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  listContent: {
    paddingBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '600',
  },
  time: {
    color: theme.textSecondary,
    fontSize: 15,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  newChatWrap: {
    flex: 1,
  },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    overflow: 'hidden',
  },
  newChatText: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '600',
  },
});
