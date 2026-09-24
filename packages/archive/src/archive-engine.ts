import {
  AppEvent,
  ChatType,
  type IWhatsAppAdapter,
  type NormalizedChat,
  type NormalizedMessage,
  type Unsubscribe,
} from '@wa-archive/shared';
import type { Repositories } from '@wa-archive/database';
import type { EventBus } from './event-bus.js';

/**
 * Turns a connected account's adapter events into a permanent, account-isolated
 * archive (spec §1, §2, §70). Once a message is written here it is authoritative
 * history; later WhatsApp deletions only *flag* rows, never remove them (§25–26).
 *
 * One ArchiveEngine instance per WhatsApp account.
 */
export class ArchiveEngine {
  private subs: Unsubscribe[] = [];
  /** Cache of whatsappChatId -> local chat row id to avoid repeated lookups. */
  private chatIdCache = new Map<string, string>();

  constructor(
    private readonly accountId: string,
    private readonly adapter: IWhatsAppAdapter,
    private readonly repos: Repositories,
    private readonly bus: EventBus,
  ) {}

  /** Subscribe to live adapter events. Idempotent writes make this safe to restart. */
  start(): void {
    this.subs.push(
      this.adapter.onConnectionUpdate((state) => {
        this.repos.accounts.updateStatus(this.accountId, state.status);
        if (state.status === 'CONNECTED') {
          this.repos.accounts.markConnected(this.accountId, {
            jid: state.whatsappJid,
            profileName: state.profileName,
          });
          this.bus.emit(AppEvent.WhatsAppConnected, { accountId: this.accountId });
        }
        // Forward full state (incl. QR) so the UI can drive the linked-device flow.
        this.bus.emit(AppEvent.AccountConnection, state);
      }),
      this.adapter.onMessage((msg) => this.archiveMessage(msg)),
      this.adapter.onMessageUpdate((u) => {
        if (u.deleted && !u.whatsappMessageId) {
          // Chat-level deletion (spec §25): preserve, just flag.
          this.repos.chats.markWhatsappDeleted(this.accountId, u.chatId);
          this.bus.emit(AppEvent.WhatsAppChatUpdated, { accountId: this.accountId, chatId: u.chatId });
          return;
        }
        if (u.deleted) {
          this.repos.messages.markWhatsappDeleted(this.accountId, u.whatsappMessageId);
          this.bus.emit(AppEvent.WhatsAppMessageDeleted, {
            accountId: this.accountId,
            whatsappMessageId: u.whatsappMessageId,
          });
        }
      }),
      this.adapter.onChatUpdate((chat) => {
        const id = this.repos.chats.upsert(this.accountId, chat);
        this.chatIdCache.set(chat.whatsappChatId, id);
      }),
      this.adapter.onContactUpdate((contact) => {
        this.repos.contacts.upsert(this.accountId, contact);
      }),
    );
  }

  stop(): void {
    this.subs.forEach((off) => off());
    this.subs = [];
  }

  /**
   * Initial history import (spec §71): pull whatever chats/contacts/messages the
   * client can currently access. Never fabricates history beyond what's available.
   */
  async importSnapshot(onProgress?: (p: { phase: string; done: number; total: number }) => void): Promise<void> {
    this.bus.emit(AppEvent.SyncStarted, { accountId: this.accountId });

    const chats = await this.adapter.getChats();
    chats.forEach((c, i) => {
      const id = this.repos.chats.upsert(this.accountId, c);
      this.chatIdCache.set(c.whatsappChatId, id);
      onProgress?.({ phase: 'chats', done: i + 1, total: chats.length });
    });

    const contacts = await this.adapter.getContacts();
    contacts.forEach((c, i) => {
      this.repos.contacts.upsert(this.accountId, c);
      onProgress?.({ phase: 'contacts', done: i + 1, total: contacts.length });
    });

    // Some adapters (mock) can hand over full history in bulk; the real Baileys
    // adapter delivers history via events instead. Import in bulk when offered.
    const bulk = this.adapter as Partial<{ getAllMessages(): Promise<NormalizedMessage[]> }>;
    if (typeof bulk.getAllMessages === 'function') {
      const all = await bulk.getAllMessages();
      // Bulk insert in a single transaction for speed on large histories.
      let done = 0;
      for (const m of all) {
        this.archiveMessage(m, { silent: true });
        done++;
        if (done % 500 === 0) onProgress?.({ phase: 'messages', done, total: all.length });
      }
      onProgress?.({ phase: 'messages', done: all.length, total: all.length });
    }

    this.repos.accounts.markConnected(this.accountId, {});
    this.bus.emit(AppEvent.SyncCompleted, { accountId: this.accountId });
  }

  /** Archive one normalized message idempotently, ensuring its chat exists. */
  archiveMessage(msg: NormalizedMessage, opts: { silent?: boolean } = {}): void {
    const chatRowId = this.resolveChatId(msg.chatId);
    const id = this.repos.messages.insert(this.accountId, chatRowId, msg);
    if (id && !opts.silent) {
      this.bus.emit(AppEvent.ArchiveMessageCreated, {
        accountId: this.accountId,
        chatId: chatRowId,
        messageId: id,
      });
      // Media pipeline hook (Phase 3): enqueue download when msg.media present.
      if (msg.media) {
        this.bus.emit(AppEvent.ArchiveMediaQueued, { accountId: this.accountId, messageId: id });
      }
    }
  }

  /** Look up (or lazily create a stub for) the local chat row of a WhatsApp chat. */
  private resolveChatId(whatsappChatId: string): string {
    const cached = this.chatIdCache.get(whatsappChatId);
    if (cached) return cached;
    const stub: NormalizedChat = {
      whatsappChatId,
      chatType: whatsappChatId.endsWith('@g.us') ? ChatType.GROUP : ChatType.INDIVIDUAL,
      name: null,
      phoneNumber: null,
      profilePhotoUrl: null,
      muted: false,
      pinned: false,
      archived: false,
      lastMessageAt: null,
      lastMessagePreview: null,
    };
    const id = this.repos.chats.upsert(this.accountId, stub);
    this.chatIdCache.set(whatsappChatId, id);
    return id;
  }
}
