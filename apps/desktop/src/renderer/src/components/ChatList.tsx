import type { ChatDTO } from '../../../shared-ipc/contract';
import { initials } from './Dashboard.js';

interface Props {
  chats: ChatDTO[];
  activeChatId: string | null;
  onSelect: (chat: ChatDTO) => void;
}

/** Chat list column (spec §35). */
export function ChatList({ chats, activeChatId, onSelect }: Props) {
  if (chats.length === 0) {
    return <div className="empty">No chats here yet.</div>;
  }
  return (
    <div className="chat-list">
      {chats.map((c) => (
        <div
          key={c.id}
          className={`chat-row ${c.id === activeChatId ? 'active' : ''}`}
          onClick={() => onSelect(c)}
        >
          <div className="avatar-circle" style={{ width: 46, height: 46 }}>
            {c.chatType === 'GROUP' ? '👥' : initials(c.name ?? '?')}
          </div>
          <div className="meta">
            <div className="top">
              <span className="name">
                {c.name ?? c.phoneNumber ?? 'Unknown'}
                {c.pinned && <span className="pill">📌</span>}
                {c.whatsappDeleted && <span className="pill deleted">deleted</span>}
              </span>
              <span className="time">{formatTime(c.lastMessageAt)}</span>
            </div>
            <div className="preview">{c.lastMessagePreview ?? '—'}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function formatTime(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString();
}
