import {
  ConnectionStatus,
  type AccountConnectionState,
  type DownloadedMedia,
  type IWhatsAppAdapter,
  type NormalizedChat,
  type NormalizedContact,
  type NormalizedMediaRef,
  type NormalizedMessage,
  type NormalizedMessageUpdate,
  type NormalizedReaction,
  type Unsubscribe,
} from '@wa-archive/shared';
import { generateMockData, type MockAccountData } from './mock-data.js';

type Listener<T> = (v: T) => void;

function seedFrom(accountId: string): number {
  let h = 0;
  for (let i = 0; i < accountId.length; i++) h = (Math.imul(31, h) + accountId.charCodeAt(i)) | 0;
  return h >>> 0;
}

export interface MockAdapterOptions {
  /** Emit a synthetic incoming message every N ms to exercise live updates (spec §58). */
  liveMessageIntervalMs?: number;
  /** Override generated dataset size. */
  chats?: number;
  messagesPerChat?: number;
}

/**
 * A fully working in-memory WhatsApp adapter for development and tests (spec §11).
 * It emits normalized events exactly like the real Baileys adapter, so every
 * layer above it can be built and tested before a phone is ever linked.
 */
export class MockWhatsAppAdapter implements IWhatsAppAdapter {
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private data: MockAccountData;
  private timer: NodeJS.Timeout | null = null;
  private liveCounter = 0;

  private connectionCbs = new Set<Listener<AccountConnectionState>>();
  private messageCbs = new Set<Listener<NormalizedMessage>>();
  private updateCbs = new Set<Listener<NormalizedMessageUpdate>>();
  private reactionCbs = new Set<Listener<NormalizedReaction>>();
  private chatCbs = new Set<Listener<NormalizedChat>>();
  private contactCbs = new Set<Listener<NormalizedContact>>();

  constructor(
    public readonly accountId: string,
    private readonly opts: MockAdapterOptions = {},
  ) {
    this.data = generateMockData({
      seed: seedFrom(accountId),
      chats: opts.chats,
      messagesPerChat: opts.messagesPerChat,
    });
  }

  async connect(): Promise<void> {
    this.setStatus(ConnectionStatus.CONNECTING);
    // Simulate link handshake without a QR (mock is pre-authorized).
    await delay(150);
    this.setStatus(ConnectionStatus.CONNECTED, {
      whatsappJid: `mock-${this.accountId}@s.whatsapp.net`,
      profileName: 'Mock Account',
    });
    if (this.opts.liveMessageIntervalMs) {
      this.timer = setInterval(() => this.emitLiveMessage(), this.opts.liveMessageIntervalMs);
    }
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getConnectionState(): AccountConnectionState {
    return {
      accountId: this.accountId,
      status: this.status,
      whatsappJid: `mock-${this.accountId}@s.whatsapp.net`,
      profileName: 'Mock Account',
    };
  }

  async getChats(): Promise<NormalizedChat[]> {
    return this.data.chats;
  }

  async getContacts(): Promise<NormalizedContact[]> {
    return this.data.contacts;
  }

  /** All messages across chats — used by the seed pipeline during initial sync. */
  async getAllMessages(): Promise<NormalizedMessage[]> {
    return [...this.data.messagesByChat.values()].flat();
  }

  async downloadMedia(ref: NormalizedMediaRef): Promise<DownloadedMedia> {
    // Return a small deterministic placeholder buffer.
    const bytes = Buffer.from(`MOCK-MEDIA:${ref.mediaType}:${ref.originalFilename ?? ''}`);
    return { data: bytes, mimeType: ref.mimeType };
  }

  onConnectionUpdate(cb: Listener<AccountConnectionState>): Unsubscribe {
    this.connectionCbs.add(cb);
    return () => this.connectionCbs.delete(cb);
  }
  onMessage(cb: Listener<NormalizedMessage>): Unsubscribe {
    this.messageCbs.add(cb);
    return () => this.messageCbs.delete(cb);
  }
  onMessageUpdate(cb: Listener<NormalizedMessageUpdate>): Unsubscribe {
    this.updateCbs.add(cb);
    return () => this.updateCbs.delete(cb);
  }
  onReaction(cb: Listener<NormalizedReaction>): Unsubscribe {
    this.reactionCbs.add(cb);
    return () => this.reactionCbs.delete(cb);
  }
  onChatUpdate(cb: Listener<NormalizedChat>): Unsubscribe {
    this.chatCbs.add(cb);
    return () => this.chatCbs.delete(cb);
  }
  onContactUpdate(cb: Listener<NormalizedContact>): Unsubscribe {
    this.contactCbs.add(cb);
    return () => this.contactCbs.delete(cb);
  }

  // ── test/dev helpers ─────────────────────────────────────────────────────

  /** Push an arbitrary message through the pipeline (used by tests). */
  injectMessage(msg: NormalizedMessage): void {
    this.messageCbs.forEach((cb) => cb(msg));
  }

  /** Simulate WhatsApp deleting a chat (spec §25 preservation test). */
  simulateChatDeleted(whatsappChatId: string): void {
    this.updateCbs.forEach((cb) =>
      cb({ whatsappMessageId: '', chatId: whatsappChatId, deleted: true }),
    );
  }

  private emitLiveMessage(): void {
    const first = this.data.chats[0];
    if (!first) return;
    this.liveCounter++;
    const msg: NormalizedMessage = {
      whatsappMessageId: `LIVE_${this.accountId}_${this.liveCounter}`,
      chatId: first.whatsappChatId,
      senderId: first.whatsappChatId,
      participantId: null,
      timestamp: Date.now(),
      direction: 'INCOMING',
      messageType: 'TEXT',
      text: `Live message #${this.liveCounter}`,
      caption: null,
      quotedMessageId: null,
      forwarded: false,
      media: null,
      rawMetadata: { live: true },
    };
    this.injectMessage(msg);
  }

  private setStatus(status: ConnectionStatus, extra?: Partial<AccountConnectionState>): void {
    this.status = status;
    const state: AccountConnectionState = {
      accountId: this.accountId,
      status,
      ...extra,
    };
    this.connectionCbs.forEach((cb) => cb(state));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
