import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import type { Chat, ConnectionState, WAMessage, WASocket, proto } from '@whiskeysockets/baileys';
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
import { makeSilentLogger } from './logger.js';
import { chatTypeForJid, normalizeContact, normalizeMessage } from './normalize.js';

type Listener<T> = (v: T) => void;

export interface BaileysAdapterOptions {
  /** Per-account auth folder (spec §8): auth/account_<id>/. */
  authDir: string;
  /** Pull historical messages the linked device can access (spec §71). */
  syncFullHistory?: boolean;
  debugLog?: boolean;
}

/**
 * Real WhatsApp adapter over WhiskeySockets/Baileys v7 (spec §4, §5, §11).
 *
 * Uses the normal linked-device mechanism: we surface a QR code the user scans
 * from WhatsApp → Linked Devices. No password is ever requested. One instance
 * per account; auth state is isolated per account folder (spec §8).
 */
export class BaileysWhatsAppAdapter implements IWhatsAppAdapter {
  private sock: WASocket | null = null;
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private state: AccountConnectionState;
  private intentionalClose = false;
  private reconnectAttempts = 0;
  private saveCreds: (() => Promise<void>) | null = null;

  // Lightweight caches populated from history + events (v7 has no built-in store).
  private chatCache = new Map<string, NormalizedChat>();
  private contactCache = new Map<string, NormalizedContact>();

  private connectionCbs = new Set<Listener<AccountConnectionState>>();
  private messageCbs = new Set<Listener<NormalizedMessage>>();
  private updateCbs = new Set<Listener<NormalizedMessageUpdate>>();
  private reactionCbs = new Set<Listener<NormalizedReaction>>();
  private chatCbs = new Set<Listener<NormalizedChat>>();
  private contactCbs = new Set<Listener<NormalizedContact>>();

  constructor(
    public readonly accountId: string,
    private readonly opts: BaileysAdapterOptions,
  ) {
    this.state = { accountId, status: ConnectionStatus.DISCONNECTED };
  }

  async connect(): Promise<void> {
    this.intentionalClose = false;
    const { state, saveCreds } = await useMultiFileAuthState(this.opts.authDir);
    this.saveCreds = saveCreds;

    let version: [number, number, number] | undefined;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined; // fall back to bundled version offline
    }

    this.setStatus(ConnectionStatus.CONNECTING);
    const sock = makeWASocket({
      auth: state,
      version,
      logger: makeSilentLogger(this.opts.debugLog),
      browser: ['WA Archive', 'Chrome', '1.0.0'],
      printQRInTerminal: false,
      markOnlineOnConnect: false, // don't steal notifications from the phone
      syncFullHistory: this.opts.syncFullHistory ?? true,
      getMessage: async () => undefined,
    });
    this.sock = sock;

    sock.ev.on('creds.update', () => void this.saveCreds?.());
    sock.ev.on('connection.update', (u) => void this.handleConnectionUpdate(u));
    sock.ev.on('messaging-history.set', (h) => this.onHistory(h));
    sock.ev.on('messages.upsert', (u) => this.onUpsert(u.messages));
    sock.ev.on('messages.update', (updates) => this.onMessagesUpdate(updates));
    sock.ev.on('messages.delete', (item) => this.onMessagesDelete(item));
    sock.ev.on('messages.reaction', (rs) => this.onReactions(rs));
    sock.ev.on('chats.upsert', (chats) => chats.forEach((c) => this.emitChat(c)));
    sock.ev.on('chats.update', (chats) => chats.forEach((c) => this.emitChat(c as Chat)));
    sock.ev.on('chats.delete', (ids) => ids.forEach((id) => this.emitChatDeleted(id)));
    sock.ev.on('contacts.upsert', (cs) => cs.forEach((c) => this.emitContact(c)));
    sock.ev.on('contacts.update', (cs) => cs.forEach((c) => this.emitContact(c as never)));
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    try {
      this.sock?.end(undefined);
    } catch {
      /* ignore */
    }
    this.sock = null;
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }
  getConnectionState(): AccountConnectionState {
    return this.state;
  }

  async getChats(): Promise<NormalizedChat[]> {
    return [...this.chatCache.values()];
  }
  async getContacts(): Promise<NormalizedContact[]> {
    return [...this.contactCache.values()];
  }

  async downloadMedia(ref: NormalizedMediaRef): Promise<DownloadedMedia> {
    const wa = ref.downloadToken as WAMessage | undefined;
    if (!wa) throw new Error('media download token missing');
    const buffer = await downloadMediaMessage(
      wa,
      'buffer',
      {},
      {
        logger: makeSilentLogger(false),
        reuploadRequest: this.sock!.updateMediaMessage,
      },
    );
    return { data: buffer as Buffer, mimeType: ref.mimeType };
  }

  // ── event subscriptions ────────────────────────────────────────────────
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

  // ── internal handlers ──────────────────────────────────────────────────
  private async handleConnectionUpdate(u: Partial<ConnectionState>): Promise<void> {
    if (u.qr) {
      const dataUrl = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 });
      this.setStatus(ConnectionStatus.CONNECTING, { qr: dataUrl });
    }
    if (u.connection === 'open') {
      this.reconnectAttempts = 0;
      const me = this.sock?.user;
      this.setStatus(ConnectionStatus.CONNECTED, {
        qr: undefined,
        whatsappJid: me?.id ? jidNormalizedUser(me.id) : null,
        profileName: me?.name ?? null,
        phoneNumber: me?.id ? `+${jidNormalizedUser(me.id).split('@')[0]}` : null,
      });
    }
    if (u.connection === 'close') {
      const statusCode = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        this.setStatus(ConnectionStatus.LOGGED_OUT, { lastError: 'Logged out from phone' });
        return;
      }
      if (this.intentionalClose) {
        this.setStatus(ConnectionStatus.DISCONNECTED);
        return;
      }
      // Exponential-ish backoff reconnect (spec §10 RECONNECTING).
      this.reconnectAttempts++;
      const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
      this.setStatus(ConnectionStatus.RECONNECTING, {
        lastError: (u.lastDisconnect?.error as Error | undefined)?.message ?? null,
      });
      setTimeout(() => {
        if (!this.intentionalClose) void this.connect().catch(() => this.setStatus(ConnectionStatus.ERROR));
      }, delay);
    }
  }

  private onHistory(h: { chats: Chat[]; contacts: unknown[]; messages: WAMessage[] }): void {
    h.chats.forEach((c) => this.emitChat(c));
    (h.contacts as Parameters<typeof normalizeContact>[0][]).forEach((c) => this.emitContact(c));
    // Historical messages flow through the same path as live ones (idempotent).
    this.onUpsert(h.messages);
  }

  private onUpsert(messages: WAMessage[]): void {
    for (const wa of messages) {
      // Reactions sometimes arrive as messages; the reaction event covers the rest.
      const res = normalizeMessage(wa);
      if (!res) continue;
      if (res.pushName && wa.key.remoteJid && !wa.key.fromMe) {
        this.rememberContact(wa.key.participant ?? wa.key.remoteJid, res.pushName);
      }
      this.rememberChatFromMessage(res.message);
      this.messageCbs.forEach((cb) => cb(res.message));
    }
  }

  private onMessagesUpdate(updates: { key: proto.IMessageKey; update: Partial<WAMessage> }[]): void {
    for (const { key, update } of updates) {
      if (!key.remoteJid || !key.id) continue;
      const chatId = jidNormalizedUser(key.remoteJid);
      // A revoke arrives as a protocolMessage of type REVOKE, or message===null.
      const proto0 = update.message?.protocolMessage;
      const isRevoke = proto0?.type === 0 /* REVOKE */ || update.message === null;
      if (isRevoke) {
        this.updateCbs.forEach((cb) => cb({ whatsappMessageId: key.id!, chatId, deleted: true }));
        continue;
      }
      // Edited message text, when present.
      const edited = update.message?.editedMessage?.message?.protocolMessage?.editedMessage;
      if (edited) {
        const text = edited.conversation ?? edited.extendedTextMessage?.text ?? undefined;
        if (text) this.updateCbs.forEach((cb) => cb({ whatsappMessageId: key.id!, chatId, editedText: text }));
      }
    }
  }

  private onMessagesDelete(item: { keys: proto.IMessageKey[] } | { jid: string; all: true }): void {
    if ('all' in item) {
      const chatId = jidNormalizedUser(item.jid);
      this.updateCbs.forEach((cb) => cb({ whatsappMessageId: '', chatId, deleted: true }));
      return;
    }
    for (const key of item.keys) {
      if (!key.remoteJid || !key.id) continue;
      this.updateCbs.forEach((cb) =>
        cb({ whatsappMessageId: key.id!, chatId: jidNormalizedUser(key.remoteJid!), deleted: true }),
      );
    }
  }

  private onReactions(rs: { key: proto.IMessageKey; reaction: proto.IReaction }[]): void {
    for (const { key, reaction } of rs) {
      if (!key.remoteJid || !reaction.key?.id) continue;
      this.reactionCbs.forEach((cb) =>
        cb({
          whatsappMessageId: reaction.key!.id!,
          chatId: jidNormalizedUser(key.remoteJid!),
          reactorId: key.participant ? jidNormalizedUser(key.participant) : jidNormalizedUser(key.remoteJid!),
          emoji: reaction.text ?? null,
          timestamp: reaction.senderTimestampMs ? Number(reaction.senderTimestampMs) : Date.now(),
        }),
      );
    }
  }

  private emitChat(c: Chat): void {
    if (!c.id) return;
    const jid = jidNormalizedUser(c.id);
    const existing = this.chatCache.get(jid);
    const chat: NormalizedChat = {
      whatsappChatId: jid,
      chatType: chatTypeForJid(jid),
      name: c.name ?? existing?.name ?? null,
      phoneNumber: jid.endsWith('@s.whatsapp.net') ? `+${jid.split('@')[0]}` : null,
      profilePhotoUrl: existing?.profilePhotoUrl ?? null,
      muted: c.muteEndTime ? Number(c.muteEndTime) > Date.now() : (existing?.muted ?? false),
      pinned: Boolean(c.pinned) || (existing?.pinned ?? false),
      archived: Boolean(c.archived) || (existing?.archived ?? false),
      lastMessageAt: c.conversationTimestamp ? Number(c.conversationTimestamp) * 1000 : existing?.lastMessageAt ?? null,
      lastMessagePreview: existing?.lastMessagePreview ?? null,
    };
    this.chatCache.set(jid, chat);
    this.chatCbs.forEach((cb) => cb(chat));
  }

  private emitChatDeleted(id: string): void {
    const jid = jidNormalizedUser(id);
    this.updateCbs.forEach((cb) => cb({ whatsappMessageId: '', chatId: jid, deleted: true }));
  }

  private emitContact(c: Parameters<typeof normalizeContact>[0]): void {
    if (!c.id) return;
    const nc = normalizeContact(c);
    this.contactCache.set(nc.whatsappId, nc);
    this.contactCbs.forEach((cb) => cb(nc));
  }

  private rememberContact(jid: string, pushName: string): void {
    const id = jidNormalizedUser(jid);
    if (this.contactCache.has(id)) return;
    const nc: NormalizedContact = {
      whatsappId: id,
      phoneNumber: id.endsWith('@s.whatsapp.net') ? `+${id.split('@')[0]}` : null,
      name: null,
      pushName,
      profilePhotoUrl: null,
    };
    this.contactCache.set(id, nc);
    this.contactCbs.forEach((cb) => cb(nc));
  }

  private rememberChatFromMessage(m: NormalizedMessage): void {
    if (this.chatCache.has(m.chatId)) return;
    const chat: NormalizedChat = {
      whatsappChatId: m.chatId,
      chatType: chatTypeForJid(m.chatId),
      name: null,
      phoneNumber: m.chatId.endsWith('@s.whatsapp.net') ? `+${m.chatId.split('@')[0]}` : null,
      profilePhotoUrl: null,
      muted: false,
      pinned: false,
      archived: false,
      lastMessageAt: m.timestamp,
      lastMessagePreview: m.text ?? m.caption ?? null,
    };
    this.chatCache.set(m.chatId, chat);
    this.chatCbs.forEach((cb) => cb(chat));
  }

  private setStatus(status: ConnectionStatus, extra?: Partial<AccountConnectionState>): void {
    this.status = status;
    this.state = { ...this.state, accountId: this.accountId, status, ...extra };
    this.connectionCbs.forEach((cb) => cb(this.state));
  }
}
