import type { ChatDTO, MessageDTO } from '../../../shared-ipc/contract';
import { formatTime } from './ChatList.js';

interface Props {
  chat: ChatDTO | null;
  messages: MessageDTO[];
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
export function MessageThread({ chat, messages }: Props) {
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
                {m.messageType !== 'TEXT' && (
                  <span className="attach">
                    {MEDIA_ICON[m.messageType] ?? '📎'} {m.messageType.toLowerCase().replace('_', ' ')}
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
