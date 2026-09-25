import { useEffect, useState } from 'react';
import type { MediaDTO } from '../../../shared-ipc/contract';

interface Props {
  accountId: string;
  accountName: string;
  onOpen: (m: MediaDTO) => void;
}

const FILTERS: { label: string; type?: string }[] = [
  { label: 'All' },
  { label: 'Images', type: 'IMAGE' },
  { label: 'Videos', type: 'VIDEO' },
  { label: 'Audio', type: 'AUDIO' },
  { label: 'Voice', type: 'VOICE_NOTE' },
  { label: 'Documents', type: 'DOCUMENT' },
  { label: 'Stickers', type: 'STICKER' },
];

/** Per-account media library with type filters (spec §39). */
export function MediaGallery({ accountId, accountName, onOpen }: Props) {
  const [filter, setFilter] = useState<{ label: string; type?: string }>(FILTERS[0]!);
  const [items, setItems] = useState<MediaDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.wa.media.list(accountId, filter.type).then((m) => {
      if (!cancelled) {
        setItems(m.filter((x) => x.hasFile));
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, filter]);

  return (
    <div className="thread">
      <div className="thread-head">
        <div>
          <div className="title">Media · {accountName}</div>
          <div className="sub">{items.length} items</div>
        </div>
      </div>
      <div className="media-filters">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            className={`tab ${filter.label === f.label ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="empty">
          <div className="spinner" />
        </div>
      ) : items.length === 0 ? (
        <div className="empty">No media of this type yet.</div>
      ) : (
        <div className="media-grid">
          {items.map((m) => (
            <MediaCell key={m.id} m={m} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function MediaCell({ m, onOpen }: { m: MediaDTO; onOpen: (m: MediaDTO) => void }) {
  const url = window.wa.media.url(m.accountId, m.id);
  if (m.mediaType === 'IMAGE' || m.mediaType === 'STICKER') {
    return <img className="media-cell" src={url} alt="" loading="lazy" onClick={() => onOpen(m)} />;
  }
  if (m.mediaType === 'VIDEO') {
    return (
      <div className="media-cell vid" onClick={() => onOpen(m)}>
        <span>▶</span>
      </div>
    );
  }
  const icon = m.mediaType === 'DOCUMENT' ? '📄' : m.mediaType === 'VOICE_NOTE' ? '🎤' : '🎵';
  return (
    <a className="media-cell doc" href={url} target="_blank" rel="noreferrer">
      <span className="ico">{icon}</span>
      <span className="fn">{m.originalFilename ?? m.mediaType.toLowerCase()}</span>
    </a>
  );
}
