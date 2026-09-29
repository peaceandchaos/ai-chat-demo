import { useCallback, useState } from 'react';
import { launchImageLibrary } from 'react-native-image-picker';
import { type Attachment } from '../state/chatStore';

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
    const picked: Attachment[] = result.assets
      .filter(asset => asset.base64 && asset.uri)
      .map(asset => ({
        uri: asset.uri as string,
        dataUrl: `data:${asset.type ?? 'image/jpeg'};base64,${asset.base64}`,
      }));
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
