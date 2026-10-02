import { useCallback, useState } from 'react';
import { type Attachment } from '../state/chatStore';

export type Draft = { text: string; attachments: Attachment[] };
export type ChangeDraft = (change: (draft: Draft) => Draft) => void;

const empty: Draft = { text: '', attachments: [] };

// The composer's unsent text and photos for each chat, kept in memory for
// this launch, so switching chats shows that chat's own draft.
export function useDraft(chatId: string): [Draft, ChangeDraft] {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, Draft>>(
    () => new Map(),
  );
  const changeDraft = useCallback<ChangeDraft>(
    change =>
      setDrafts(previous =>
        new Map(previous).set(chatId, change(previous.get(chatId) ?? empty)),
      ),
    [chatId],
  );
  return [drafts.get(chatId) ?? empty, changeDraft];
}
