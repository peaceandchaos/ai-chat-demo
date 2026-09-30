// Contract checks for the native driver's request state machine against a fake
// Nitro builder. Native behavior is verified by tools/native-transport/run.mjs.
import type { ClientReader } from '../src/network/client';
import { nativeDrivers } from '../src/network/nativeDrivers';

type Info = { httpStatusCode: number };
type Listeners = {
  redirect?: (info: Info, location: string) => void;
  started?: (info: Info) => void;
  read?: (info: Info, buffer: ArrayBuffer, length: number) => void;
  succeeded?: (info: Info) => void;
  failed?: (info: Info | undefined, error: { message: string }) => void;
  canceled?: (info: Info | undefined) => void;
};
type Exchange = { listeners: Listeners; cancels: number; headers: string[][] };

const mockExchanges: Exchange[] = [];

jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: () => ({
      newUrlRequestBuilder: () => {
        const exchange: Exchange = { listeners: {}, cancels: 0, headers: [] };
        mockExchanges.push(exchange);
        const on = (key: keyof Listeners) => (listener: never) => {
          exchange.listeners[key] = listener;
        };
        return {
          setHttpMethod: () => undefined,
          addHeader: (name: string, value: string) =>
            exchange.headers.push([name, value]),
          setUploadBody: () => undefined,
          disableCache: () => undefined,
          onRedirectReceived: on('redirect'),
          onResponseStarted: on('started'),
          onReadCompleted: on('read'),
          onSucceeded: on('succeeded'),
          onFailed: on('failed'),
          onCanceled: on('canceled'),
          build: () => ({
            start: () => undefined,
            cancel: () => {
              exchange.cancels += 1;
            },
          }),
        };
      },
    }),
  },
}));
jest.mock('react-native-nitro-text-decoder', () => ({
  TextDecoder: globalThis.TextDecoder,
}));
jest.mock('react-native-nitro-websockets', () => ({}));

const ok = { httpStatusCode: 200 };

function start(signal = new AbortController().signal) {
  const response = nativeDrivers.fetch('http://localhost:1/v1/jobs/x', {
    method: 'GET',
    redirect: 'error',
    signal,
    headers: { 'X-Device-Id': 'fixture' },
  });
  const exchange = mockExchanges.at(-1);
  if (!exchange) throw new Error('No native request was built.');
  return { response, exchange };
}

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

async function reader(
  response: ReturnType<typeof start>['response'],
): Promise<ClientReader> {
  const body = (await response).body;
  if (!body) throw new Error('Missing body.');
  return body.getReader();
}

beforeEach(() => {
  mockExchanges.length = 0;
});

test('abort before headers cancels the native request once and ignores late callbacks', async () => {
  const controller = new AbortController();
  const { response, exchange } = start(controller.signal);
  controller.abort();
  await expect(response).rejects.toMatchObject({ name: 'AbortError' });
  exchange.listeners.canceled?.(undefined);
  exchange.listeners.started?.(ok);
  exchange.listeners.read?.(ok, bytes('late'), 4);
  expect(exchange.cancels).toBe(1);
});

test('abort during the body rejects the pending read, cancels native, and drops late chunks', async () => {
  const controller = new AbortController();
  const { response, exchange } = start(controller.signal);
  exchange.listeners.started?.(ok);
  const body = await reader(response);
  const pending = body.read();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  exchange.listeners.read?.(ok, bytes('late'), 4);
  exchange.listeners.succeeded?.(ok);
  await expect(body.read()).rejects.toMatchObject({ name: 'AbortError' });
  expect(exchange.cancels).toBe(1);
});

test('reader cancel ends a pending read as done and cancels native once', async () => {
  const { response, exchange } = start();
  exchange.listeners.started?.(ok);
  const body = await reader(response);
  const pending = body.read();
  await body.cancel();
  await body.cancel();
  await expect(pending).resolves.toEqual({ done: true });
  expect(exchange.cancels).toBe(1);
});

test('a redirect is refused and the native request is cancelled', async () => {
  const { response, exchange } = start();
  exchange.listeners.redirect?.({ httpStatusCode: 307 }, 'http://elsewhere/');
  await expect(response).rejects.toThrow('redirected');
  expect(exchange.cancels).toBe(1);
});

test('queued chunks drain before a native failure surfaces', async () => {
  const { response, exchange } = start();
  exchange.listeners.started?.(ok);
  exchange.listeners.read?.(ok, bytes('data: 1\n\n'), 9);
  exchange.listeners.failed?.(ok, {
    message: 'The network connection was lost.',
  });
  const body = await reader(response);
  const first = await body.read();
  expect(new TextDecoder().decode(first.value)).toBe('data: 1\n\n');
  await expect(body.read()).rejects.toThrow('The network connection was lost.');
});

test('text() reconstructs UTF-8 split across native chunks', async () => {
  const { response, exchange } = start();
  exchange.listeners.started?.({ httpStatusCode: 429 });
  const encoded = new TextEncoder().encode('{"error":"Grüße 🦋"}');
  for (let offset = 0; offset < encoded.length; offset += 3) {
    const chunk = encoded.slice(offset, offset + 3);
    exchange.listeners.read?.(ok, chunk.buffer, chunk.length);
  }
  exchange.listeners.succeeded?.(ok);
  const result = await response;
  expect(result.status).toBe(429);
  expect(result.ok).toBe(false);
  await expect(result.text()).resolves.toBe('{"error":"Grüße 🦋"}');
});

test('requests that could follow redirects are rejected before reaching native', async () => {
  await expect(
    nativeDrivers.fetch('http://localhost:1/', { redirect: 'follow' }),
  ).rejects.toThrow('redirect:"error"');
  expect(mockExchanges).toHaveLength(0);
});
