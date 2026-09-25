import type { ChatDTO, ExportFmt, MediaDTO, MessageDTO } from '../../../shared-ipc/contract';
import { formatTime } from './ChatList.js';
import { downloadText } from '../download.js';

interface Props {
  chat: ChatDTO | null;
  messages: MessageDTO[];
  onOpenMedia?: (m: MediaDTO) => void;
}

function humanBytes(n: number | null): string {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

/** Render an archived media attachment inline (spec §36, §38). */
function MediaAttachment({ m, onOpen }: { m: MediaDTO; onOpen?: (m: MediaDTO) => void }) {
  const url = m.hasFile ? window.wa.media.url(m.accountId, m.id) : null;
  if (!m.hasFile) {
    const failed = m.downloadStatus === 'FAILED';
    return (
      <div className="attach" style={{ opacity: 0.75 }}>
        {failed ? '⚠️ Media could not be archived.' : '⏳ Archiving media…'}
      </div>
    );
  }
  if (m.mediaType === 'IMAGE' || m.mediaType === 'STICKER') {
    return (
      <img
        className="media-thumb"
        src={url!}
        alt={m.originalFilename ?? 'image'}
        loading="lazy"
        onClick={() => onOpen?.(m)}
      />
    );
  }
  if (m.mediaType === 'VIDEO') {
    return <video className="media-thumb" src={url!} controls preload="metadata" />;
  }
  if (m.mediaType === 'AUDIO' || m.mediaType === 'VOICE_NOTE') {
    return <audio src={url!} controls preload="none" style={{ width: 240, height: 34 }} />;
  }
  return (
    <a className="attach" href={url!} target="_blank" rel="noreferrer" download={m.originalFilename ?? undefined}>
      📄 {m.originalFilename ?? 'document'} <span style={{ opacity: 0.6 }}>{humanBytes(m.fileSize)}</span>
    </a>
  );
}

const MEDIA_ICON: Record<string, string> = {
  IMAGE: '🖼',
  VIDEO: '🎬',
  DOCUMENT: '📄',
  VOICE_NOTE: '🎤',
  AUDIO: '🎵',
  STICKER: '🩹',
};

/** Message timeline with bubbles, attachments, and archive labels (spec §36–37). */
export function MessageThread({ chat, messages, onOpenMedia }: Props) {
  if (!chat) {
    return (
      <div className="thread">
        <div className="empty">
          <div>
            <h3>WA Archive</h3>
            <p>Select a chat to browse its permanent local archive.</p>
          </div>
        </div>
      </div>
    );
  }

  let lastDay = '';
  return (
    <div className="thread">
      <div className="thread-head">
        <div className="avatar-circle" style={{ width: 40, height: 40 }}>
          {chat.chatType === 'GROUP' ? '👥' : (chat.name ?? '?')[0]}
        </div>
        <div>
          <div className="title">{chat.name ?? chat.phoneNumber ?? 'Unknown'}</div>
          <div className="sub">
            {chat.whatsappDeleted ? 'Deleted from WhatsApp • Preserved locally' : chat.phoneNumber ?? chat.chatType.toLowerCase()}
          </div>
        </div>
        <select
          className="export-select"
          title="Export chat (spec §64)"
          value=""
          onChange={async (e) => {
            const fmt = e.target.value as ExportFmt;
            if (!fmt) return;
            e.target.value = '';
            const out = await window.wa.files.exportChat(chat.accountId, chat.id, fmt);
            downloadText(out.filename, out.mimeType, out.content);
          }}
        >
          <option value="">Export ▾</option>
          <option value="txt">Text (.txt)</option>
          <option value="json">JSON (.json)</option>
          <option value="html">HTML (.html)</option>
          <option value="csv">CSV (.csv)</option>
        </select>
      </div>
      <div className="thread-body">
        {messages.map((m) => {
          const day = new Date(m.timestamp).toDateString();
          const sep = day !== lastDay ? ((lastDay = day), day) : null;
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {sep && <div className="day-sep">{new Date(m.timestamp).toLocaleDateString()}</div>}
              <div className={`bubble ${m.direction === 'OUTGOING' ? 'out' : 'in'}`}>
                {chat.chatType === 'GROUP' && m.direction === 'INCOMING' && m.participantId && (
                  <span className="tag">{shortJid(m.participantId)}</span>
                )}
                {m.forwarded && <span className="tag">↪ Forwarded</span>}
                {m.media.length > 0
                  ? m.media.map((md) => <MediaAttachment key={md.id} m={md} onOpen={onOpenMedia} />)
                  : m.messageType !== 'TEXT' &&
                    m.messageType !== 'SYSTEM' && (
                      <span className="attach">
                        {MEDIA_ICON[m.messageType] ?? '📎'}{' '}
                        {m.messageType.toLowerCase().replace('_', ' ')}
                      </span>
                    )}
                {(m.text || m.caption) && <span>{m.text ?? m.caption}</span>}
                {m.whatsappDeleted && (
                  <span className="archived-label">Deleted from WhatsApp • Archived copy</span>
                )}
                <span className="stamp">{formatTime(m.timestamp)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shortJid(jid: string): string {
  return jid.split('@')[0] ?? jid;
}
