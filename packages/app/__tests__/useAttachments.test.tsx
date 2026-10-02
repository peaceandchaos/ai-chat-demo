import { Alert } from 'react-native';
import { launchImageLibrary, type Asset } from 'react-native-image-picker';
import { act, create } from 'react-test-renderer';
import { imageSchema } from '../../../shared/contracts';
import { useAttachments } from '../src/hooks/useAttachments';

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

// A JPEG encoder whose output shrinks with pixel count and quality, like the
// real one. At full size and quality 90 it is over the contract's limit.
const mockEncoded: { format: string; quality: number; width: number }[] = [];
let mockBytesPerPixel = 0.85;
let mockLastJpeg = new Uint8Array();
function mockImage(width: number, height: number) {
  return {
    width,
    height,
    resizeAsync: async (w: number, h: number) => mockImage(w, h),
    toEncodedImageDataAsync: async (format: string, quality: number) => {
      mockEncoded.push({ format, quality, width });
      const size = Math.round(
        width * height * mockBytesPerPixel * (quality / 100),
      );
      const bytes = new Uint8Array(size).map((_, i) => i % 251);
      mockLastJpeg = bytes;
      return {
        buffer: bytes.buffer,
        width,
        height,
        imageFormat: format,
      };
    },
  };
}
jest.mock('react-native-nitro-image', () => ({
  Images: { loadFromFileAsync: async () => mockImage(2048, 1536) },
}));

const prefix = 'data:image/jpeg;base64,';

function decodeBase64(text: string): Uint8Array {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text.replace(/=+$/u, '')) {
    value = ((value << 6) | alphabet.indexOf(char)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  return Uint8Array.from(bytes);
}

async function pick(assets: Asset[]) {
  jest.mocked(launchImageLibrary).mockResolvedValue({ assets });
  let hook!: ReturnType<typeof useAttachments>;
  function Probe() {
    hook = useAttachments();
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  await act(async () => {
    await hook.pickImages();
  });
  return hook.attachments.map(attachment => attachment.dataUrl);
}

beforeEach(() => {
  mockEncoded.length = 0;
  mockBytesPerPixel = 0.85;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

test('a picked JPEG that fits is sent as it is, under the type the contract names', async () => {
  const [dataUrl] = await pick([
    { uri: 'file:///tmp/a.jpg', type: 'image/jpg', base64: 'AAAA' },
  ]);
  expect(dataUrl).toBe(`${prefix}AAAA`);
  expect(mockEncoded).toEqual([]);
});

test('a photo one character over the limit is re-encoded as a JPEG that fits', async () => {
  const base64 = 'A'.repeat(3_000_001 - prefix.length);
  expect(`${prefix}${base64}`).toHaveLength(3_000_001);
  const [dataUrl] = await pick([
    { uri: 'file:///tmp/big.jpg', type: 'image/jpeg', base64 },
  ]);
  expect(imageSchema.safeParse(dataUrl).success).toBe(true);
  expect(dataUrl.startsWith(prefix)).toBe(true);
  expect(mockEncoded.every(step => step.format === 'jpg')).toBe(true);
  const sent = decodeBase64(dataUrl.slice(prefix.length));
  expect(sent).toHaveLength(mockLastJpeg.length);
  expect(sent.every((byte, i) => byte === mockLastJpeg[i])).toBe(true);
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('a HEIC photo is converted to JPEG', async () => {
  const [dataUrl] = await pick([
    { uri: 'file:///tmp/b.heic', type: 'image/heic', base64: 'AAAA' },
  ]);
  expect(imageSchema.safeParse(dataUrl).success).toBe(true);
  expect(dataUrl.startsWith(prefix)).toBe(true);
});

test('a photo that cannot fit is left out with a plain message, and the others attach', async () => {
  mockBytesPerPixel = 13;
  const attached = await pick([
    { uri: 'file:///tmp/fine.jpg', type: 'image/jpeg', base64: 'AAAA' },
    { uri: 'file:///tmp/huge.heic', type: 'image/heic', base64: 'AAAA' },
  ]);
  expect(attached).toEqual([`${prefix}AAAA`]);
  expect(Alert.alert).toHaveBeenCalledWith(
    'Something went wrong',
    'A photo is too large to send.',
  );
});
