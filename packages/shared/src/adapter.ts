import type {
  AccountConnectionState,
  NormalizedChat,
  NormalizedContact,
  NormalizedMessage,
  NormalizedMessageUpdate,
  NormalizedReaction,
  NormalizedMediaRef,
} from './types.js';
import type { ConnectionStatus } from './enums.js';

/** Unsubscribe handle returned by every adapter event subscription. */
export type Unsubscribe = () => void;

export interface DownloadedMedia {
  data: Buffer;
  mimeType: string | null;
}

/**
 * The single seam between WA Archive and any WhatsApp Web client (spec §11).
 *
 * The frontend and database MUST NOT depend on Baileys directly. Two
 * implementations exist: BaileysWhatsAppAdapter (real) and MockWhatsAppAdapter
 * (development / tests). One adapter instance == one WhatsApp account.
 */
export interface IWhatsAppAdapter {
  readonly accountId: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): ConnectionStatus;
  getConnectionState(): AccountConnectionState;

  /** Snapshot of currently accessible chats/contacts (used during initial sync). */
  getChats(): Promise<NormalizedChat[]>;
  getContacts(): Promise<NormalizedContact[]>;

  /** Fetch the actual bytes for a media reference produced earlier (spec §23). */
  downloadMedia(ref: NormalizedMediaRef): Promise<DownloadedMedia>;

  onConnectionUpdate(cb: (state: AccountConnectionState) => void): Unsubscribe;
  onMessage(cb: (msg: NormalizedMessage) => void): Unsubscribe;
  onMessageUpdate(cb: (update: NormalizedMessageUpdate) => void): Unsubscribe;
  onReaction(cb: (reaction: NormalizedReaction) => void): Unsubscribe;
  onChatUpdate(cb: (chat: NormalizedChat) => void): Unsubscribe;
  onContactUpdate(cb: (contact: NormalizedContact) => void): Unsubscribe;
}
