import { Linking } from 'react-native';

const allowedSchemes = ['http:', 'https:'];

export async function openWebLink(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!allowedSchemes.includes(url.protocol) || !url.hostname) return false;
  try {
    await Linking.openURL(url.href);
    return true;
  } catch {
    // The OS can refuse a valid web link; do not expose its URL in logs.
    return false;
  }
}
