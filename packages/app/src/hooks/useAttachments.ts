import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { launchImageLibrary, type Asset } from 'react-native-image-picker';
import { Images, type Image } from 'react-native-nitro-image';
import { type Attachment } from '../state/chatStore';
import { fitImage } from '../state/images';

async function attach(asset: Asset): Promise<Attachment | null> {
  const { uri, base64 } = asset;
  if (!uri || !base64) return null;
  let image: Promise<Image> | null = null;
  const dataUrl = await fitImage(
    asset.type ?? 'image/jpeg',
    base64,
    async (scale, quality) => {
      image ??= Images.loadFromFileAsync(
        decodeURIComponent(new URL(uri).pathname),
      );
      const full = await image;
      const sized =
        scale < 1
          ? await full.resizeAsync(
              Math.round(full.width * scale),
              Math.round(full.height * scale),
            )
          : full;
      return (await sized.toEncodedImageDataAsync('jpg', quality)).buffer;
    },
  );
  return dataUrl ? { uri, dataUrl } : null;
}

export function useAttachments(): {
  attachments: Attachment[];
  pickImages: () => Promise<void>;
  removeAttachment: (index: number) => void;
  clearAttachments: () => void;
} {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const pickImages = useCallback(async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      includeBase64: true,
      maxWidth: 2048,
      maxHeight: 2048,
      quality: 0.9,
      selectionLimit: 4,
    });
    if (result.didCancel || !result.assets) {
      return;
    }
    const fitted = await Promise.all(result.assets.map(attach));
    const picked = fitted.filter(attachment => attachment !== null);
    if (picked.length < fitted.length)
      Alert.alert('Something went wrong', 'A photo is too large to send.');
    setAttachments(prev => [...prev, ...picked]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  return { attachments, pickImages, removeAttachment, clearAttachments };
}
