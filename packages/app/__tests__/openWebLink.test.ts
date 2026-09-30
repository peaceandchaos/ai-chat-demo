import { Linking } from 'react-native';
import { openWebLink } from '../src/openWebLink';

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test('only valid HTTP and HTTPS links reach the OS', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await expect(openWebLink('http://example.com/a')).resolves.toBe(true);
  await expect(openWebLink('HTTPS://EXAMPLE.COM/b')).resolves.toBe(true);
  expect(open.mock.calls).toEqual([
    ['http://example.com/a'],
    ['https://example.com/b'],
  ]);
});

test('non-web schemes and malformed URLs never reach the OS', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  for (const raw of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///private/example',
    'tel:1234',
    'sms:1234',
    'myapp://action',
    '//example.com',
    'https://',
    'https://bad host/path',
    'not a URL',
  ]) {
    await expect(openWebLink(raw)).resolves.toBe(false);
  }
  expect(open).not.toHaveBeenCalled();
});

test('an OS failure settles without an unhandled rejection or URL logging', async () => {
  jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('OS refused'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(openWebLink('https://example.com')).resolves.toBe(false);
  expect(warn).not.toHaveBeenCalled();
});
