import { createHash } from 'node:crypto';
import { MediaType } from '@wa-archive/shared';

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** On-disk subfolder per media category (spec §21). */
export function folderForMediaType(type: string): string {
  switch (type) {
    case MediaType.IMAGE:
      return 'images';
    case MediaType.VIDEO:
      return 'videos';
    case MediaType.AUDIO:
      return 'audio';
    case MediaType.VOICE_NOTE:
      return 'voice';
    case MediaType.DOCUMENT:
      return 'documents';
    case MediaType.STICKER:
      return 'stickers';
    default:
      return 'other';
  }
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
};

/** Safe extension from mime/filename; never trust the original filename as a key (spec §21). */
export function extForMedia(mimeType: string | null, originalFilename: string | null): string {
  if (mimeType && MIME_EXT[mimeType]) return MIME_EXT[mimeType]!;
  if (mimeType?.includes('/')) {
    const sub = mimeType.split('/')[1]!.split(';')[0]!.replace(/[^a-z0-9]/gi, '');
    if (sub) return sub.slice(0, 8);
  }
  if (originalFilename && originalFilename.includes('.')) {
    const ext = originalFilename.split('.').pop()!.replace(/[^a-z0-9]/gi, '');
    if (ext) return ext.slice(0, 8);
  }
  return 'bin';
}
