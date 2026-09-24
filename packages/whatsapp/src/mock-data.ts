import {
  ChatType,
  MediaType,
  MessageDirection,
  MessageType,
  type NormalizedChat,
  type NormalizedContact,
  type NormalizedMessage,
} from '@wa-archive/shared';

/** Tiny seeded PRNG (mulberry32) so mock data is reproducible per account. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Rahul', 'Amit', 'Priya', 'Neha', 'Vikram', 'Anjali', 'Suresh', 'Kavya', 'Arjun', 'Meera'];
const LAST = ['Sharma', 'Verma', 'Patel', 'Gupta', 'Singh', 'Reddy', 'Nair', 'Iyer', 'Bose', 'Khan'];
const GROUPS = ['Family', 'Factory Floor', 'Suppliers', 'Sales Team', 'Cricket Club', 'Accounts'];
const SNIPPETS = [
  'Send me the invoice.',
  'Sending invoice now.',
  'Quotation approved.',
  'Call me when free.',
  'Payment received, thanks.',
  'Delivery scheduled for tomorrow.',
  'Please confirm the order.',
  'Meeting at 4pm today.',
  'Attached the report.',
  'Can you share the details?',
  'Thanks a lot!',
  'On my way.',
];

export interface MockAccountData {
  contacts: NormalizedContact[];
  chats: NormalizedChat[];
  /** whatsappChatId -> messages */
  messagesByChat: Map<string, NormalizedMessage[]>;
}

export interface MockGenOptions {
  seed: number;
  chats?: number;
  messagesPerChat?: number;
}

/**
 * Generate a rich mock dataset (spec §96): groups, replies, reactions targets,
 * edited and deleted messages, and media placeholders. Deterministic per seed.
 */
export function generateMockData(opts: MockGenOptions): MockAccountData {
  const rand = rng(opts.seed);
  const chatCount = opts.chats ?? 50;
  const perChat = opts.messagesPerChat ?? 200;
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

  const contacts: NormalizedContact[] = [];
  const chats: NormalizedChat[] = [];
  const messagesByChat = new Map<string, NormalizedMessage[]>();

  const dayMs = 86_400_000;
  const base = Date.now() - 90 * dayMs;

  for (let i = 0; i < chatCount; i++) {
    const isGroup = rand() < 0.25;
    const name = isGroup
      ? `${pick(GROUPS)} ${i}`
      : `${pick(FIRST)} ${pick(LAST)}`;
    const whatsappChatId = isGroup ? `${100000 + i}@g.us` : `9198${String(70000000 + i)}@s.whatsapp.net`;

    if (!isGroup) {
      contacts.push({
        whatsappId: whatsappChatId,
        phoneNumber: rand() < 0.85 ? `+9198${String(70000000 + i)}` : null,
        name,
        pushName: name.split(' ')[0]!,
        profilePhotoUrl: null,
      });
    }

    const msgs: NormalizedMessage[] = [];
    let t = base + Math.floor(rand() * 30) * dayMs;
    let lastId: string | null = null;

    for (let j = 0; j < perChat; j++) {
      t += Math.floor(rand() * 6 * 3600_000) + 60_000;
      const outgoing = rand() < 0.45;
      const roll = rand();
      let type: MessageType = MessageType.TEXT;
      if (roll > 0.9) type = MessageType.IMAGE;
      else if (roll > 0.86) type = MessageType.DOCUMENT;
      else if (roll > 0.83) type = MessageType.VIDEO;
      else if (roll > 0.8) type = MessageType.VOICE_NOTE;

      const wid = `MOCK_${opts.seed}_${i}_${j}`;
      const isReply = lastId && rand() < 0.15;
      const text =
        type === MessageType.TEXT || type === MessageType.DOCUMENT ? pick(SNIPPETS) : null;

      const msg: NormalizedMessage = {
        whatsappMessageId: wid,
        chatId: whatsappChatId,
        senderId: outgoing ? null : whatsappChatId,
        participantId: isGroup && !outgoing ? `9198${String(80000000 + (j % 5))}@s.whatsapp.net` : null,
        timestamp: t,
        direction: outgoing ? MessageDirection.OUTGOING : MessageDirection.INCOMING,
        messageType: type,
        text,
        caption: type === MessageType.IMAGE && rand() < 0.4 ? pick(SNIPPETS) : null,
        quotedMessageId: isReply ? lastId : null,
        forwarded: rand() < 0.05,
        media: mediaRefFor(type),
        rawMetadata: { mock: true },
      };
      msgs.push(msg);
      lastId = wid;
    }

    const last = msgs[msgs.length - 1]!;
    chats.push({
      whatsappChatId,
      chatType: isGroup ? ChatType.GROUP : ChatType.INDIVIDUAL,
      name,
      phoneNumber: isGroup ? null : `+9198${String(70000000 + i)}`,
      profilePhotoUrl: null,
      muted: rand() < 0.1,
      pinned: rand() < 0.08,
      archived: rand() < 0.1,
      lastMessageAt: last.timestamp,
      lastMessagePreview: last.text ?? last.caption ?? `[${last.messageType.toLowerCase()}]`,
    });
    messagesByChat.set(whatsappChatId, msgs);
  }

  return { contacts, chats, messagesByChat };
}

function mediaRefFor(type: MessageType) {
  const map: Partial<Record<MessageType, MediaType>> = {
    [MessageType.IMAGE]: MediaType.IMAGE,
    [MessageType.VIDEO]: MediaType.VIDEO,
    [MessageType.DOCUMENT]: MediaType.DOCUMENT,
    [MessageType.VOICE_NOTE]: MediaType.VOICE_NOTE,
  };
  const mediaType = map[type];
  if (!mediaType) return null;
  return {
    mediaType,
    mimeType:
      mediaType === MediaType.IMAGE
        ? 'image/jpeg'
        : mediaType === MediaType.VIDEO
          ? 'video/mp4'
          : mediaType === MediaType.DOCUMENT
            ? 'application/pdf'
            : 'audio/ogg',
    originalFilename: mediaType === MediaType.DOCUMENT ? 'invoice.pdf' : null,
    fileSize: Math.floor(Math.random() * 2_000_000) + 20_000,
    width: mediaType === MediaType.IMAGE ? 1080 : null,
    height: mediaType === MediaType.IMAGE ? 1350 : null,
    duration: mediaType === MediaType.VOICE_NOTE ? 12 : null,
    downloadToken: { mock: true },
  };
}
