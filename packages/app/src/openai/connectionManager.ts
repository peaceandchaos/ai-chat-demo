import { AppState } from 'react-native';
import { NitroWebSocket } from 'react-native-nitro-websockets';
import { OPENAI_API_KEY, OPENAI_WS_URL } from '../config';

type ServerEventHandler = (raw: string) => void;
type DisconnectHandler = () => void;

type Handlers = {
  onServerEvent: ServerEventHandler;
  onDisconnect: DisconnectHandler;
};

let socket: NitroWebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let handlers: Handlers | null = null;

// Clear any pending backoff timer and reset the attempt counter so the next
// connect starts a fresh backoff sequence.
function resetBackoff() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  attempts = 0;
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }
  const delay = Math.min(1000 * 2 ** attempts, 4000);
  attempts += 1;
  console.log('[ws] reconnecting in', delay, 'ms');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function reconnectNow() {
  if (socket?.readyState === 'CONNECTING') {
    return;
  }
  resetBackoff();
  connect();
}

// Open a fresh connection unconditionally, even if the current socket still
// reports OPEN. Needed for OpenAI's 60-minute cap, which arrives as an error
// event (not a close) while the socket may still be open.
function forceReconnect() {
  resetBackoff();
  const stale = socket;
  if (stale) {
    stale.onclose = () => {};
    stale.onerror = () => {};
    stale.onmessage = () => {};
    stale.close(1000, 'client reconnect');
  }
  connect();
}

function connect() {
  const nextSocket = new NitroWebSocket(OPENAI_WS_URL, undefined, {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
  });
  socket = nextSocket;

  nextSocket.onopen = () => {
    console.log('[ws] open');
    attempts = 0;
  };
  nextSocket.onclose = event => {
    console.warn('[ws] closed', event?.code, event?.reason);
    if (socket === nextSocket) {
      socket = null;
    }
    handlers?.onDisconnect();
    scheduleReconnect();
  };
  nextSocket.onerror = error => {
    console.warn('[ws] error', error);
    handlers?.onDisconnect();
    scheduleReconnect();
  };
  nextSocket.onmessage = (event: { data: string }) => {
    handlers?.onServerEvent(event.data);
  };
}

connect();

// The socket closes on idle / backgrounding / server timeout. Reconnect
// immediately when the app returns to the foreground with no live socket.
AppState.addEventListener('change', state => {
  if (state === 'active' && socket == null) {
    resetBackoff();
    connect();
  }
});

export const connectionManager = {
  setHandlers(next: Handlers) {
    handlers = next;
    return {
      remove: () => {
        // Only detach if these are still the current handlers
        if (handlers === next) {
          handlers = null;
        }
      },
    };
  },
  send(payload: string): boolean {
    if (!socket || socket.readyState !== 'OPEN') {
      //  if socket is down - start reconnecting now so the user's retry lands fast.
      reconnectNow();
      return false;
    }
    socket.send(payload);
    return true;
  },
  // Tear down the current socket and open a fresh one, even if it still reports
  // OPEN. Used to roll over OpenAI's 60-minute connection cap silently.
  forceReconnect,
};
