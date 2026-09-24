import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  ChatType,
  MessageDirection,
  MessageType,
  newId,
  type NormalizedChat,
  type NormalizedContact,
  type NormalizedMessage,
} from '@wa-archive/shared';
import type { Db } from './client.js';
import { chats, contacts, messages, whatsappAccounts } from './schema.js';
import { MediaRepository } from './media-repository.js';

/**
 * Account-isolated data access (spec §95).
 *
 * Every WhatsApp-scoped method REQUIRES an accountId and filters on it. Callers
 * must pass an accountId the caller is authorized for — authorization happens a
 * layer up (LAN API / IPC), but these methods physically cannot return another
 * account's rows because account_id is always in the WHERE clause.
 */
export class AccountRepository {
  constructor(private readonly db: Db) {}

  create(input: { displayName: string; phoneNumber?: string | null }) {
    const id = newId();
    this.db
      .insert(whatsappAccounts)
      .values({ id, displayName: input.displayName, phoneNumber: input.phoneNumber ?? null })
      .run();
    return this.get(id)!;
  }

  get(accountId: string) {
    return this.db
      .select()
      .from(whatsappAccounts)
      .where(eq(whatsappAccounts.id, accountId))
      .get();
  }

  list() {
    return this.db.select().from(whatsappAccounts).orderBy(whatsappAccounts.createdAt).all();
  }

  updateStatus(accountId: string, status: string) {
    this.db
      .update(whatsappAccounts)
      .set({ connectionStatus: status, updatedAt: Date.now() })
      .where(eq(whatsappAccounts.id, accountId))
      .run();
  }

  markConnected(accountId: string, meta: { jid?: string | null; profileName?: string | null }) {
    const patch: Record<string, unknown> = {
      connectionStatus: 'CONNECTED',
      lastConnectedAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (meta.jid !== undefined) patch.whatsappJid = meta.jid;
    if (meta.profileName !== undefined) patch.profileName = meta.profileName;
    // archive_started_at is set once, on the first successful connection (spec §3).
    const existing = this.get(accountId);
    if (existing && existing.archiveStartedAt == null) patch.archiveStartedAt = Date.now();
    this.db.update(whatsappAccounts).set(patch).where(eq(whatsappAccounts.id, accountId)).run();
  }

  setArchivePasswordHash(accountId: string, hash: string) {
    this.db
      .update(whatsappAccounts)
      .set({ archivePasswordHash: hash, updatedAt: Date.now() })
      .where(eq(whatsappAccounts.id, accountId))
      .run();
  }
}

export class ChatRepository {
  constructor(private readonly db: Db) {}

  /** Upsert by (accountId, whatsappChatId); idempotent (spec §70). */
  upsert(accountId: string, c: NormalizedChat): string {
    const existing = this.db
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.accountId, accountId), eq(chats.whatsappChatId, c.whatsappChatId)))
      .get();

    if (existing) {
      this.db
        .update(chats)
        .set({
          name: c.name,
          chatType: c.chatType,
          phoneNumber: c.phoneNumber,
          muted: c.muted,
          pinned: c.pinned,
          archived: c.archived,
          lastMessageAt: c.lastMessageAt,
          lastMessagePreview: c.lastMessagePreview,
          updatedAt: Date.now(),
        })
        .where(eq(chats.id, existing.id))
        .run();
      return existing.id;
    }

    const id = newId();
    this.db
      .insert(chats)
      .values({
        id,
        accountId,
        whatsappChatId: c.whatsappChatId,
        chatType: c.chatType,
        name: c.name,
        phoneNumber: c.phoneNumber,
        muted: c.muted,
        pinned: c.pinned,
        archived: c.archived,
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview,
      })
      .run();
    return id;
  }

  /** List chats for an account, most-recent first (spec §35). `deleted` filters live vs archive. */
  list(accountId: string, opts: { includeDeleted?: boolean } = {}) {
    const where = opts.includeDeleted
      ? eq(chats.accountId, accountId)
      : and(eq(chats.accountId, accountId), eq(chats.whatsappDeleted, false));
    return this.db
      .select()
      .from(chats)
      .where(where)
      .orderBy(desc(chats.lastMessageAt))
      .all();
  }

  listDeleted(accountId: string) {
    return this.db
      .select()
      .from(chats)
      .where(and(eq(chats.accountId, accountId), eq(chats.whatsappDeleted, true)))
      .orderBy(desc(chats.lastMessageAt))
      .all();
  }

  get(accountId: string, chatId: string) {
    return this.db
      .select()
      .from(chats)
      .where(and(eq(chats.accountId, accountId), eq(chats.id, chatId)))
      .get();
  }

  /** Preserve the archive copy; only flag WhatsApp deletion (spec §25). */
  markWhatsappDeleted(accountId: string, whatsappChatId: string) {
    this.db
      .update(chats)
      .set({ whatsappDeleted: true, updatedAt: Date.now() })
      .where(and(eq(chats.accountId, accountId), eq(chats.whatsappChatId, whatsappChatId)))
      .run();
  }
}

export class MessageRepository {
  constructor(private readonly db: Db) {}

  /** Insert-or-ignore by (accountId, whatsappMessageId): at-least-once safe (spec §70). */
  insert(accountId: string, chatRowId: string, m: NormalizedMessage): string | null {
    const existing = this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(eq(messages.accountId, accountId), eq(messages.whatsappMessageId, m.whatsappMessageId)),
      )
      .get();
    if (existing) return existing.id;

    const id = newId();
    this.db
      .insert(messages)
      .values({
        id,
        accountId,
        chatId: chatRowId,
        whatsappMessageId: m.whatsappMessageId,
        senderId: m.senderId,
        participantId: m.participantId,
        timestamp: m.timestamp,
        direction: m.direction,
        messageType: m.messageType,
        text: m.text,
        caption: m.caption,
        quotedMessageId: m.quotedMessageId,
        forwarded: m.forwarded,
        rawMetadataJson: m.rawMetadata ? JSON.stringify(m.rawMetadata) : null,
      })
      .run();

    // Keep the chat preview fresh.
    this.db
      .update(chats)
      .set({
        lastMessageAt: m.timestamp,
        lastMessagePreview: m.text ?? m.caption ?? `[${m.messageType.toLowerCase()}]`,
        updatedAt: Date.now(),
      })
      .where(eq(chats.id, chatRowId))
      .run();

    return id;
  }

  list(accountId: string, chatRowId: string, opts: { limit?: number; before?: number } = {}) {
    const limit = opts.limit ?? 50;
    const conds = [eq(messages.accountId, accountId), eq(messages.chatId, chatRowId)];
    if (opts.before) conds.push(sql`${messages.timestamp} < ${opts.before}`);
    const rows = this.db
      .select()
      .from(messages)
      .where(and(...conds))
      .orderBy(desc(messages.timestamp))
      .limit(limit)
      .all();
    return rows.reverse(); // ascending for display
  }

  markWhatsappDeleted(accountId: string, whatsappMessageId: string) {
    this.db
      .update(messages)
      .set({ whatsappDeleted: true, deletedFromWhatsappAt: Date.now(), updatedAt: Date.now() })
      .where(
        and(eq(messages.accountId, accountId), eq(messages.whatsappMessageId, whatsappMessageId)),
      )
      .run();
  }

  countByAccount(accountId: string): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.accountId, accountId))
      .get();
    return row?.n ?? 0;
  }
}

export class ContactRepository {
  constructor(private readonly db: Db) {}

  upsert(accountId: string, c: NormalizedContact) {
    const existing = this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.accountId, accountId), eq(contacts.whatsappId, c.whatsappId)))
      .get();
    if (existing) {
      this.db
        .update(contacts)
        .set({
          name: c.name,
          pushName: c.pushName,
          phoneNumber: c.phoneNumber,
          updatedAt: Date.now(),
        })
        .where(eq(contacts.id, existing.id))
        .run();
      return existing.id;
    }
    const id = newId();
    this.db
      .insert(contacts)
      .values({
        id,
        accountId,
        whatsappId: c.whatsappId,
        name: c.name,
        pushName: c.pushName,
        phoneNumber: c.phoneNumber,
      })
      .run();
    return id;
  }

  list(accountId: string) {
    return this.db.select().from(contacts).where(eq(contacts.accountId, accountId)).all();
  }
}

export interface SearchHit {
  accountId: string;
  chatId: string;
  chatName: string | null;
  messageId: string;
  text: string | null;
  timestamp: number;
}

export class SearchRepository {
  constructor(private readonly db: Db) {}

  /** FTS5 search scoped to a single account (spec §32–33). */
  searchAccount(accountId: string, query: string, limit = 50): SearchHit[] {
    if (!query.trim()) return [];
    const match = toFtsQuery(query);
    const rows = this.db.$sqlite
      .prepare(
        `SELECT m.id AS messageId, m.chat_id AS chatId, m.account_id AS accountId,
                m.text AS text, m.timestamp AS timestamp, c.name AS chatName
         FROM messages_fts f
         JOIN messages m ON m.rowid = f.rowid
         JOIN chats c ON c.id = m.chat_id
         WHERE messages_fts MATCH ? AND m.account_id = ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(match, accountId, limit) as SearchHit[];
    return rows;
  }

  /** Cross-account search — every hit carries its source accountId (spec §31–32). */
  searchAccounts(accountIds: string[], query: string, limit = 50): SearchHit[] {
    if (!query.trim() || accountIds.length === 0) return [];
    const match = toFtsQuery(query);
    const placeholders = accountIds.map(() => '?').join(',');
    const rows = this.db.$sqlite
      .prepare(
        `SELECT m.id AS messageId, m.chat_id AS chatId, m.account_id AS accountId,
                m.text AS text, m.timestamp AS timestamp, c.name AS chatName
         FROM messages_fts f
         JOIN messages m ON m.rowid = f.rowid
         JOIN chats c ON c.id = m.chat_id
         WHERE messages_fts MATCH ? AND m.account_id IN (${placeholders})
         ORDER BY rank
         LIMIT ?`,
      )
      .all(match, ...accountIds, limit) as SearchHit[];
    return rows;
  }
}

/** Escape a user query into a safe FTS5 prefix match. */
function toFtsQuery(raw: string): string {
  const terms = raw
    .replace(/["]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"*`);
  return terms.join(' ');
}

export interface Repositories {
  accounts: AccountRepository;
  chats: ChatRepository;
  messages: MessageRepository;
  contacts: ContactRepository;
  search: SearchRepository;
  media: MediaRepository;
}

export function createRepositories(db: Db): Repositories {
  return {
    accounts: new AccountRepository(db),
    chats: new ChatRepository(db),
    messages: new MessageRepository(db),
    contacts: new ContactRepository(db),
    search: new SearchRepository(db),
    media: new MediaRepository(db),
  };
}

// Re-export a couple of enum shims so callers can build normalized objects.
export { ChatType, MessageType, MessageDirection };
export { inArray };
