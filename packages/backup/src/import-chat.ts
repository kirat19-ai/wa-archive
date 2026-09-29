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
