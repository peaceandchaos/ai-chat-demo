import { createMMKV } from 'react-native-mmkv';
import { secureId } from '../device';
import { ChatArchive, type ArchiveStorage } from './archive';

export function openArchive(): ChatArchive {
  const mmkv = createMMKV({
    id: 'personal-chat.archive.v1',
    recoveryStrategy: 'recover-on-error',
  });
  const storage: ArchiveStorage = {
    getString: key => mmkv.getString(key),
    getAllKeys: () => mmkv.getAllKeys(),
    set: (key, value) => mmkv.set(key, value),
    remove: key => {
      mmkv.remove(key);
    },
  };
  const archive = new ChatArchive(storage, secureId);
  archive.recover();
  return archive;
}
