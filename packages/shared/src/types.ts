import type {
  ChatType,
  ConnectionStatus,
  MediaType,
  MessageDirection,
  MessageType,
} from './enums.js';

/**
 * Normalized domain types emitted by any IWhatsAppAdapter.
 *
 * The adapter's job is to translate raw client (Baileys) objects into these
 * shapes so nothing downstream depends on the underlying library (spec §11).
 * These are transport shapes — the database package defines its own row types.
 */

/** A stable, adapter-independent identity for a WhatsApp endpoint (JID). */
export type WhatsAppId = string;

export interface NormalizedContact {
  /** Adapter-stable WhatsApp identifier (JID). Never assume a phone number exists (spec §77). */
  whatsappId: WhatsAppId;
  phoneNumber: string | null;
  name: string | null;
  pushName: string | null;
  profilePhotoUrl: string | null;
}

export interface NormalizedChat {
  whatsappChatId: WhatsAppId;
  chatType: ChatType;
  name: string | null;
  phoneNumber: string | null;
  profilePhotoUrl: string | null;
  muted: boolean;
  pinned: boolean;
  archived: boolean;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
}

/** Media descriptor attached to a normalized message (pre-download). */
export interface NormalizedMediaRef {
  mediaType: MediaType;
  mimeType: string | null;
  originalFilename: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  /**
   * Opaque, adapter-specific handle used later to actually download the bytes.
   * The archive engine passes this back to adapter.downloadMedia().
   */
  downloadToken: unknown;
}

export interface NormalizedMessage {
  whatsappMessageId: string;
  chatId: WhatsAppId;
  /** Sender JID. In groups this is the participant; in 1:1 it is the chat peer or self. */
  senderId: WhatsAppId | null;
  participantId: WhatsAppId | null;
  timestamp: number;
  direction: MessageDirection;
  messageType: MessageType;
  text: string | null;
  caption: string | null;
  quotedMessageId: string | null;
  forwarded: boolean;
  media: NormalizedMediaRef | null;
  /** Raw provider metadata, retained where safe for future re-parsing (spec §18, §20). */
  rawMetadata: unknown;
}

export interface NormalizedMessageUpdate {
  whatsappMessageId: string;
  chatId: WhatsAppId;
  /** WhatsApp reported this message as deleted/revoked (spec §26). */
  deleted?: boolean;
  /** New text after an edit, when the client exposes it (spec §73). */
  editedText?: string;
  starred?: boolean;
}

export interface NormalizedReaction {
  whatsappMessageId: string;
  chatId: WhatsAppId;
  reactorId: WhatsAppId;
  emoji: string | null;
  timestamp: number;
}

export interface AccountConnectionState {
  accountId: string;
  status: ConnectionStatus;
  /** Present only while status === CONNECTING and a link is pending. */
  qr?: string;
  phoneNumber?: string | null;
  whatsappJid?: string | null;
  profileName?: string | null;
  lastError?: string | null;
}

/** Summary numbers surfaced on the multi-account dashboard (spec §29). */
export interface AccountStats {
  chats: number;
  messages: number;
  media: number;
  storageBytes: number;
  archiveStartedAt: number | null;
  lastSyncAt: number | null;
}
