import { Alert } from 'react-native';
import { PROXY_BASE_URL } from '../config';
import { loadDeviceId } from '../device';
import { ServerTransport } from '../network/client';
import { nativeDrivers } from '../network/nativeDrivers';
import { createChatView, type ChatView } from './chatView';
import { openArchive } from './nativeArchive';
import { followAppState } from './nativeSession';
import { ChatSession } from './session';

let started: Promise<ChatView> | null = null;
let current: ChatView | null = null;

// One session per JavaScript runtime. The transport is built only after the
// device id exists, and nothing connects until a reply needs the server.
export function startAppSession(): Promise<ChatView> {
  started ??= (async () => {
    const archive = openArchive();
    const deviceId = await loadDeviceId();
    const transport = new ServerTransport(
      PROXY_BASE_URL,
      deviceId,
      nativeDrivers,
      __DEV__,
    );
    const session = new ChatSession({
      archive,
      transport,
      scheduleFrame: callback => requestAnimationFrame(callback),
    });
    current = createChatView(archive, session, message =>
      Alert.alert('Something went wrong', message),
    );
    followAppState(session);
    return current;
  })();
  return started;
}

export function chatView(): ChatView {
  if (!current) throw new Error('The app session has not started.');
  return current;
}
