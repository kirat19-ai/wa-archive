import { getContentType, isJidGroup, jidNormalizedUser } from '@whiskeysockets/baileys';
import type { Contact, WAMessage, proto } from '@whiskeysockets/baileys';
import {
  ChatType,
  MediaType,
  MessageDirection,
  MessageType,
  type NormalizedContact,
  type NormalizedMediaRef,
  type NormalizedMessage,
} from '@wa-archive/shared';

/**
 * Pure Baileys → normalized mappers (spec §11). Kept free of any socket/IO so
 * they can be unit-tested against fixture proto objects. Nothing here logs
 * message contents (spec §81).
 */

/** Map a Baileys message-content key to our normalized MessageType (spec §20). */
export function contentKeyToMessageType(key: keyof proto.IMessage | undefined): MessageType {
  switch (key) {
    case 'conversation':
    case 'extendedTextMessage':
      return MessageType.TEXT;
    case 'imageMessage':
      return MessageType.IMAGE;
    case 'videoMessage':
      return MessageType.VIDEO;
    case 'audioMessage':
      return MessageType.AUDIO;
    case 'documentMessage':
    case 'documentWithCaptionMessage':
      return MessageType.DOCUMENT;
    case 'stickerMessage':
      return MessageType.STICKER;
    case 'locationMessage':
    case 'liveLocationMessage':
      return MessageType.LOCATION;
    case 'contactMessage':
    case 'contactsArrayMessage':
      return MessageType.CONTACT;
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3':
      return MessageType.POLL;
    case 'reactionMessage':
      return MessageType.REACTION;
    case 'protocolMessage':
    case 'senderKeyDistributionMessage':
      return MessageType.SYSTEM;
    case undefined:
      return MessageType.UNKNOWN;
    default:
      return MessageType.UNKNOWN;
  }
}

function mediaTypeFor(type: MessageType, ptt: boolean | null | undefined): MediaType | null {
  switch (type) {
    case MessageType.IMAGE:
      return MediaType.IMAGE;
    case MessageType.VIDEO:
      return MediaType.VIDEO;
    case MessageType.AUDIO:
      return ptt ? MediaType.VOICE_NOTE : MediaType.AUDIO;
    case MessageType.DOCUMENT:
      return MediaType.DOCUMENT;
    case MessageType.STICKER:
      return MediaType.STICKER;
    default:
      return null;
  }
}

/** Extract the inner content node for the detected key, unwrapping viewOnce/ephemeral. */
function unwrap(message: proto.IMessage | null | undefined): proto.IMessage | null | undefined {
  if (!message) return message;
  return (
    message.ephemeralMessage?.message ??
    message.viewOnceMessage?.message ??
    message.viewOnceMessageV2?.message ??
    message.viewOnceMessageV2Extension?.message ??
    message.documentWithCaptionMessage?.message ??
    message
  );
}

interface MediaNode {
  mimetype?: string | null;
  fileName?: string | null;
  fileLength?: number | Long | null;
  width?: number | null;
  height?: number | null;
  seconds?: number | null;
  ptt?: boolean | null;
  caption?: string | null;
}
// Long is protobufjs' Long; we only read via Number().
type Long = { toNumber(): number };

function toNum(v: number | Long | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === 'number' ? v : v.toNumber();
}

export interface NormalizeResult {
  message: NormalizedMessage;
  pushName: string | null;
}

/**
 * Convert a Baileys WAMessage into a NormalizedMessage. `downloadToken` carries
 * the original WAMessage so the media pipeline can call downloadMediaMessage.
 */
export function normalizeMessage(wa: WAMessage): NormalizeResult | null {
  const key = wa.key;
  if (!key || !key.remoteJid || !key.id) return null;

  const inner = unwrap(wa.message);
  const contentKey = getContentType(inner ?? undefined);
  const type = contentKeyToMessageType(contentKey);

  const rawNode = contentKey ? (inner as Record<string, unknown>)[contentKey] : undefined;
  // Media/content nodes are objects; `conversation` is a bare string.
  const node: MediaNode | undefined =
    rawNode && typeof rawNode === 'object' ? (rawNode as MediaNode) : undefined;

  let text: string | null = null;
  let caption: string | null = null;
  if (contentKey === 'conversation') text = (inner?.conversation as string) ?? null;
  else if (contentKey === 'extendedTextMessage') text = inner?.extendedTextMessage?.text ?? null;
  if (node && 'caption' in node) caption = node.caption ?? null;

  const mediaType = mediaTypeFor(type, node?.ptt);
  const media: NormalizedMediaRef | null = mediaType
    ? {
        mediaType,
        mimeType: node?.mimetype ?? null,
        originalFilename: node?.fileName ?? null,
        fileSize: toNum(node?.fileLength),
        width: node?.width ?? null,
        height: node?.height ?? null,
        duration: node?.seconds ?? null,
        downloadToken: wa, // original message, needed by downloadMediaMessage
      }
    : null;

  // Quoted / reply + forwarded live in the content node's contextInfo.
  const ctx = (node as { contextInfo?: proto.IContextInfo } | undefined)?.contextInfo;
  const quotedMessageId = ctx?.stanzaId ?? null;
  const forwarded = Boolean(ctx?.isForwarded) || (ctx?.forwardingScore ?? 0) > 0;

  const remoteJid = jidNormalizedUser(key.remoteJid);
  const fromMe = Boolean(key.fromMe);
  const participant = key.participant ? jidNormalizedUser(key.participant) : null;

  const message: NormalizedMessage = {
    whatsappMessageId: key.id,
    chatId: remoteJid,
    senderId: fromMe ? null : (participant ?? remoteJid),
    participantId: participant,
    timestamp: toNum(wa.messageTimestamp) ? toNum(wa.messageTimestamp)! * 1000 : Date.now(),
    direction: fromMe ? MessageDirection.OUTGOING : MessageDirection.INCOMING,
    messageType: type,
    text,
    caption,
    quotedMessageId,
    forwarded,
    media,
    rawMetadata: safeMeta(wa),
  };

  return { message, pushName: wa.pushName ?? null };
}

/** Store lightweight metadata only — never raw media bytes (spec §81). */
function safeMeta(wa: WAMessage): Record<string, unknown> {
  return {
    status: wa.status ?? null,
    messageStubType: wa.messageStubType ?? null,
    verifiedBizName: wa.verifiedBizName ?? null,
  };
}

export function normalizeContact(c: Contact): NormalizedContact {
  const jid = jidNormalizedUser(c.id);
  return {
    whatsappId: jid,
    phoneNumber: jid.endsWith('@s.whatsapp.net') ? `+${jid.split('@')[0]}` : null,
    name: c.name ?? c.notify ?? null,
    pushName: c.notify ?? null,
    profilePhotoUrl: c.imgUrl && c.imgUrl !== 'changed' ? c.imgUrl : null,
  };
}

export function chatTypeForJid(jid: string): ChatType {
  if (isJidGroup(jid)) return ChatType.GROUP;
  if (jid.endsWith('@broadcast')) return ChatType.BROADCAST;
  return ChatType.INDIVIDUAL;
}
