import { createHash } from 'node:crypto';
import {
  ChatType,
  MessageDirection,
  MessageType,
  type NormalizedChat,
  type NormalizedMessage,
} from '@wa-archive/shared';

/** One parsed line from a WhatsApp "Export Chat" .txt file. */
export interface ParsedExportLine {
  timestamp: number;
  sender: string;
  body: string;
  isSystem: boolean;
  isMedia: boolean;
}

export interface ParsedExport {
  lines: ParsedExportLine[];
  /** Distinct sender names seen, most frequent first — for the "which is me" pick. */
  senders: string[];
}

// iOS:     [15/01/2024, 14:30:22] Name: message   (brackets, optional AM/PM, LTR marks)
// Android: 15/01/2024, 14:30 - Name: message
const IOS_RE =
  /^‎?\[(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\]\s*([^:]+?):\s?([\s\S]*)$/;
const ANDROID_RE =
  /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*-\s*([^:]+?):\s?([\s\S]*)$/;
// A header line without "Name:" is a system notice (encryption notice, etc.).
const IOS_SYS_RE =
  /^‎?\[(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\]\s*([\s\S]*)$/;
const ANDROID_SYS_RE =
  /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*-\s*([\s\S]*)$/;

const MEDIA_HINTS = [
  '<Media omitted>',
  'image omitted',
  'video omitted',
  'audio omitted',
  'sticker omitted',
  'GIF omitted',
  'document omitted',
  'Contact card omitted',
  '<attached:',
];

function toTimestamp(
  d: string,
  mo: string,
  y: string,
  h: string,
  mi: string,
  s: string | undefined,
  ampm: string | undefined,
): number {
  let day = Number(d);
  let month = Number(mo);
  // WhatsApp uses the phone's locale. Default day-first (most of the world);
  // if the first field can't be a day but the second can, it's month-first.
  if (day > 12 && month <= 12) {
    /* already day-first */
  } else if (month > 12 && day <= 12) {
    [day, month] = [month, day]; // it was month-first
  }
  let year = Number(y);
  if (year < 100) year += 2000;
  let hour = Number(h);
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  return new Date(year, month - 1, day, hour, Number(mi), s ? Number(s) : 0).getTime();
}

/** Parse a WhatsApp export .txt into structured lines. Continuation lines
 * (wrapped text with no new timestamp) are appended to the previous message. */
export function parseWhatsAppExport(text: string): ParsedExport {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ParsedExportLine[] = [];
  const senderCount = new Map<string, number>();

  for (const raw of rawLines) {
    const line = raw.replace(/‎/g, '');
    if (line.trim() === '') continue;

    const m = IOS_RE.exec(raw) ?? ANDROID_RE.exec(raw);
    if (m) {
      const [, d, mo, y, h, mi, s, ampm, sender, body] = m;
      const ts = toTimestamp(d!, mo!, y!, h!, mi!, s, ampm);
      const cleanSender = sender!.trim();
      const bodyText = body ?? '';
      const isMedia = MEDIA_HINTS.some((hint) => bodyText.toLowerCase().includes(hint.toLowerCase()));
      out.push({ timestamp: ts, sender: cleanSender, body: bodyText.trim(), isSystem: false, isMedia });
      senderCount.set(cleanSender, (senderCount.get(cleanSender) ?? 0) + 1);
      continue;
    }

    const sys = IOS_SYS_RE.exec(raw) ?? ANDROID_SYS_RE.exec(raw);
    if (sys) {
      const [, d, mo, y, h, mi, s, ampm, body] = sys;
      const ts = toTimestamp(d!, mo!, y!, h!, mi!, s, ampm);
      out.push({ timestamp: ts, sender: '', body: (body ?? '').trim(), isSystem: true, isMedia: false });
      continue;
    }

    // Continuation of the previous message (a wrapped line).
    if (out.length > 0) {
      const prev = out[out.length - 1]!;
      prev.body = prev.body ? `${prev.body}\n${line.trim()}` : line.trim();
    }
  }

  const senders = [...senderCount.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return { lines: out, senders };
}

/** A stable synthetic id so re-importing the same export doesn't duplicate. */
function syntheticId(chatWhatsappId: string, line: ParsedExportLine): string {
  const h = createHash('sha256')
    .update(`${chatWhatsappId}|${line.timestamp}|${line.sender}|${line.body}`)
    .digest('hex')
    .slice(0, 32);
  return `import_${h}`;
}

export interface ImportPlan {
  chat: NormalizedChat;
  messages: NormalizedMessage[];
}

/**
 * Turn a parsed export into normalized chat+messages ready for the repositories.
 * `myName` is the sender name that represents the archive owner (its messages
 * become OUTGOING); everyone else is INCOMING. System lines are skipped.
 */
export function buildImportPlan(
  parsed: ParsedExport,
  target: { whatsappChatId: string; name: string | null; phoneNumber: string | null; chatType?: ChatType },
  myName: string | null,
): ImportPlan {
  const messages: NormalizedMessage[] = [];
  let lastTs: number | null = null;

  for (const line of parsed.lines) {
    if (line.isSystem) continue;
    const isMine = myName != null && line.sender === myName;
    messages.push({
      whatsappMessageId: syntheticId(target.whatsappChatId, line),
      chatId: target.whatsappChatId,
      senderId: null,
      participantId: null,
      timestamp: line.timestamp,
      direction: isMine ? MessageDirection.OUTGOING : MessageDirection.INCOMING,
      messageType: line.isMedia ? MessageType.IMAGE : MessageType.TEXT,
      text: line.isMedia ? null : line.body,
      caption: line.isMedia ? line.body || null : null,
      quotedMessageId: null,
      forwarded: false,
      media: null,
      rawMetadata: { imported: true, sender: line.sender },
    });
    lastTs = line.timestamp;
  }

  const chat: NormalizedChat = {
    whatsappChatId: target.whatsappChatId,
    chatType: target.chatType ?? ChatType.INDIVIDUAL,
    name: target.name,
    phoneNumber: target.phoneNumber,
    profilePhotoUrl: null,
    muted: false,
    pinned: false,
    archived: false,
    lastMessageAt: lastTs,
    lastMessagePreview: null,
  };

  return { chat, messages };
}

// ── Bulk import from whatsapp-chat-exporter JSON (all chats at once) ──────────
// Schema: { "<jid>": { name, type, messages: { "<id>": { from_me, timestamp,
//   media, data, meta, sender, caption, key_id, mime, sticker } } } }

export interface ExporterMessage {
  from_me?: boolean;
  timestamp?: number; // seconds
  media?: boolean;
  data?: string | null;
  meta?: boolean; // system/notice line
  sender?: string | null;
  caption?: string | null;
  key_id?: string | number | null;
  mime?: string | null;
  sticker?: boolean;
}
export interface ExporterChat {
  name?: string | null;
  type?: string;
  messages?: Record<string, ExporterMessage>;
}
export type ExporterJson = Record<string, ExporterChat>;

function mediaTypeForMime(mime: string | null | undefined, sticker?: boolean): MessageType {
  if (sticker) return MessageType.STICKER;
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return MessageType.IMAGE;
  if (m.startsWith('video/')) return MessageType.VIDEO;
  if (m.startsWith('audio/')) return MessageType.AUDIO;
  return MessageType.DOCUMENT;
}

/** Detect whether a file's text is the exporter JSON (vs a plain .txt export). */
export function looksLikeExporterJson(text: string): boolean {
  const t = text.trimStart();
  if (!t.startsWith('{')) return false;
  try {
    const obj = JSON.parse(t) as Record<string, unknown>;
    return Object.values(obj).some(
      (v) => v && typeof v === 'object' && 'messages' in (v as object),
    );
  } catch {
    return false;
  }
}

export interface BulkChatPlan {
  chat: NormalizedChat;
  messages: NormalizedMessage[];
}

/** Turn exporter JSON into per-chat normalized plans ready for the repositories. */
export function buildBulkImportPlan(json: ExporterJson): BulkChatPlan[] {
  const plans: BulkChatPlan[] = [];

  for (const [jid, chat] of Object.entries(json)) {
    if (!chat || typeof chat !== 'object' || !chat.messages) continue;
    if (jid.includes('status@broadcast')) continue; // skip Status updates
    const isGroup = jid.endsWith('@g.us');
    const phoneNumber = !isGroup && jid.includes('@') ? `+${jid.split('@')[0]}` : null;

    const messages: NormalizedMessage[] = [];
    let lastTs: number | null = null;

    for (const [id, msg] of Object.entries(chat.messages)) {
      if (!msg || msg.meta) continue; // skip system notices
      const tsSec = typeof msg.timestamp === 'number' ? msg.timestamp : 0;
      if (!tsSec) continue;
      const timestamp = Math.round(tsSec * 1000);
      const isMedia = Boolean(msg.media) || Boolean(msg.sticker);
      const type = isMedia ? mediaTypeForMime(msg.mime, msg.sticker) : MessageType.TEXT;
      const body = msg.data ?? null;
      // Prefer WhatsApp's real key id so imports dedup against live-synced copies.
      const wamid =
        msg.key_id != null && String(msg.key_id).length > 0
          ? `${String(msg.key_id)}`
          : `import_${createHash('sha256').update(`${jid}|${id}|${timestamp}`).digest('hex').slice(0, 32)}`;

      messages.push({
        whatsappMessageId: wamid,
        chatId: jid,
        senderId: null,
        participantId: null,
        timestamp,
        direction: msg.from_me ? MessageDirection.OUTGOING : MessageDirection.INCOMING,
        messageType: type,
        text: isMedia ? null : body,
        caption: msg.caption ?? (isMedia ? body : null),
        quotedMessageId: null,
        forwarded: false,
        media: null,
        rawMetadata: { imported: true, sender: msg.sender ?? null },
      });
      if (timestamp > (lastTs ?? 0)) lastTs = timestamp;
    }

    if (messages.length === 0) continue;

    plans.push({
      chat: {
        whatsappChatId: jid,
        chatType: isGroup ? ChatType.GROUP : ChatType.INDIVIDUAL,
        name: chat.name ?? null,
        phoneNumber,
        profilePhotoUrl: null,
        muted: false,
        pinned: false,
        archived: false,
        lastMessageAt: lastTs,
        lastMessagePreview: null,
      },
      messages,
    });
  }

  return plans;
}
