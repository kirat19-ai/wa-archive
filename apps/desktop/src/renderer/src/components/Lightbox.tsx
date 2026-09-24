import { useEffect } from 'react';
import type { MediaDTO } from '../../../shared-ipc/contract';

/** Fullscreen media viewer (spec §38). */
export function Lightbox({ media, onClose }: { media: MediaDTO; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const url = window.wa.media.url(media.accountId, media.id);
  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lb-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      {media.mediaType === 'VIDEO' ? (
        <video src={url} controls autoPlay onClick={(e) => e.stopPropagation()} />
      ) : (
        <img src={url} alt={media.originalFilename ?? 'media'} onClick={(e) => e.stopPropagation()} />
      )}
      <div className="lb-bar">
        {media.originalFilename ?? media.mediaType.toLowerCase()} · archived copy
      </div>
    </div>
  );
}
