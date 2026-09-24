import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * WA Archive database schema (spec §13–§19, indexes §67).
 *
 * Conventions:
 * - Primary keys are app-generated UUID strings (spec §7): immutable local
 *   identity, never a phone number or a raw WhatsApp id.
 * - Timestamps are epoch milliseconds stored as INTEGER (matches the
 *   normalized transport types in @wa-archive/shared).
 * - Booleans are 0/1 INTEGER via { mode: 'boolean' }.
 * - Multi-account isolation (spec §95): every WhatsApp-scoped row carries
 *   account_id, and the (account_id, whatsapp_*_id) pair is unique — WhatsApp
 *   ids are NOT assumed globally unique across accounts (spec §18).
 */

const now = sql`(unixepoch() * 1000)`;

// ── Local application users (spec §14) ─────────────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(), // UserRole
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ── WhatsApp accounts (spec §15) ───────────────────────────────────────────
export const whatsappAccounts = sqliteTable('whatsapp_accounts', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  phoneNumber: text('phone_number'),
  whatsappJid: text('whatsapp_jid'),
  profileName: text('profile_name'),
  profilePhotoPath: text('profile_photo_path'),
  connectionStatus: text('connection_status').notNull().default('DISCONNECTED'),
  /** Argon2id hash of this account's independent archive password (spec §45–46). */
  archivePasswordHash: text('archive_password_hash'),
  lastConnectedAt: integer('last_connected_at'),
  lastSyncAt: integer('last_sync_at'),
  archiveStartedAt: integer('archive_started_at'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ── Contacts (spec §17) ────────────────────────────────────────────────────
export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
    whatsappId: text('whatsapp_id').notNull(),
    phoneNumber: text('phone_number'),
    name: text('name'),
    pushName: text('push_name'),
    profilePhotoPath: text('profile_photo_path'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => ({
    uniqAccountWa: uniqueIndex('uq_contacts_account_wa').on(t.accountId, t.whatsappId),
    byWhatsappId: index('ix_contacts_whatsapp_id').on(t.whatsappId),
  }),
);

// ── Chats (spec §16) ───────────────────────────────────────────────────────
export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
    whatsappChatId: text('whatsapp_chat_id').notNull(),
    chatType: text('chat_type').notNull().default('INDIVIDUAL'),
    name: text('name'),
    phoneNumber: text('phone_number'),
    profilePhotoPath: text('profile_photo_path'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    /** WhatsApp reported this chat deleted, but we preserve it locally (spec §25). */
    whatsappDeleted: integer('whatsapp_deleted', { mode: 'boolean' }).notNull().default(false),
    muted: integer('muted', { mode: 'boolean' }).notNull().default(false),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    lastMessageAt: integer('last_message_at'),
    lastMessagePreview: text('last_message_preview'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => ({
    uniqAccountChat: uniqueIndex('uq_chats_account_wa').on(t.accountId, t.whatsappChatId),
    byUpdatedAt: index('ix_chats_updated_at').on(t.accountId, t.lastMessageAt),
    byDeleted: index('ix_chats_deleted').on(t.accountId, t.whatsappDeleted),
  }),
);

// ── Messages (spec §18) ────────────────────────────────────────────────────
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    whatsappMessageId: text('whatsapp_message_id').notNull(),
    senderId: text('sender_id'),
    participantId: text('participant_id'),
    timestamp: integer('timestamp').notNull(),
    direction: text('direction').notNull(), // MessageDirection
    messageType: text('message_type').notNull(), // MessageType
    text: text('text'),
    caption: text('caption'),
    quotedMessageId: text('quoted_message_id'),
    replyToMessageId: text('reply_to_message_id'),
    forwarded: integer('forwarded', { mode: 'boolean' }).notNull().default(false),
    starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
    edited: integer('edited', { mode: 'boolean' }).notNull().default(false),
    whatsappDeleted: integer('whatsapp_deleted', { mode: 'boolean' }).notNull().default(false),
    /** User explicitly deleted the archive copy (spec §27); distinct from WhatsApp deletion. */
    archiveDeleted: integer('archive_deleted', { mode: 'boolean' }).notNull().default(false),
    deletedFromWhatsappAt: integer('deleted_from_whatsapp_at'),
    editedAt: integer('edited_at'),
    rawMetadataJson: text('raw_metadata_json'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => ({
    uniqAccountMsg: uniqueIndex('uq_messages_account_wa').on(t.accountId, t.whatsappMessageId),
    byChatTime: index('ix_messages_chat_time').on(t.accountId, t.chatId, t.timestamp),
    bySender: index('ix_messages_sender').on(t.accountId, t.senderId),
    byType: index('ix_messages_type').on(t.accountId, t.messageType),
    byDeleted: index('ix_messages_deleted').on(t.accountId, t.whatsappDeleted),
  }),
);

// ── Media (spec §19) ───────────────────────────────────────────────────────
export const media = sqliteTable(
  'media',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    mediaType: text('media_type').notNull(), // MediaType
    mimeType: text('mime_type'),
    originalFilename: text('original_filename'),
    storagePath: text('storage_path'),
    thumbnailPath: text('thumbnail_path'),
    fileSize: integer('file_size'),
    sha256: text('sha256'),
    width: integer('width'),
    height: integer('height'),
    duration: integer('duration'),
    downloadStatus: text('download_status').notNull().default('PENDING'),
    downloadAttempts: integer('download_attempts').notNull().default(0),
    encryptionVersion: integer('encryption_version').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    archivedAt: integer('archived_at'),
  },
  (t) => ({
    byMessage: index('ix_media_message').on(t.messageId),
    byAccount: index('ix_media_account').on(t.accountId),
    bySha: index('ix_media_sha256').on(t.sha256),
    byStatus: index('ix_media_status').on(t.accountId, t.downloadStatus),
  }),
);

// ── Reactions (spec §75) ───────────────────────────────────────────────────
export const messageReactions = sqliteTable(
  'message_reactions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    reactorId: text('reactor_id').notNull(),
    emoji: text('emoji'),
    timestamp: integer('timestamp').notNull(),
  },
  (t) => ({
    uniqReaction: uniqueIndex('uq_reaction').on(t.messageId, t.reactorId),
  }),
);

// ── Message edit history (spec §73) ────────────────────────────────────────
export const messageEdits = sqliteTable(
  'message_edits',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    previousText: text('previous_text'),
    newText: text('new_text'),
    editedAt: integer('edited_at').notNull(),
  },
  (t) => ({ byMessage: index('ix_edits_message').on(t.messageId) }),
);

// ── Links extracted from messages (spec §32 search) ────────────────────────
export const messageLinks = sqliteTable(
  'message_links',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    title: text('title'),
  },
  (t) => ({ byMessage: index('ix_links_message').on(t.messageId) }),
);

// ── Groups & participants (spec §76) ───────────────────────────────────────
export const groups = sqliteTable(
  'groups',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
    whatsappGroupId: text('whatsapp_group_id').notNull(),
    name: text('name'),
    description: text('description'),
    photoPath: text('photo_path'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => ({ uniqGroup: uniqueIndex('uq_group').on(t.accountId, t.whatsappGroupId) }),
);

export const groupParticipants = sqliteTable(
  'group_participants',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    participantWhatsappId: text('participant_whatsapp_id').notNull(),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    joinedAt: integer('joined_at'),
    leftAt: integer('left_at'),
  },
  (t) => ({ byGroup: index('ix_participants_group').on(t.groupId) }),
);

// ── Job queues (spec §69) ──────────────────────────────────────────────────
export const syncJobs = sqliteTable('sync_jobs', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  jobType: text('job_type').notNull(),
  status: text('status').notNull().default('QUEUED'),
  payloadJson: text('payload_json'),
  attempts: integer('attempts').notNull().default(0),
  runAfter: integer('run_after').notNull().default(now),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

export const mediaJobs = sqliteTable('media_jobs', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  mediaId: text('media_id').notNull(),
  status: text('status').notNull().default('QUEUED'),
  attempts: integer('attempts').notNull().default(0),
  runAfter: integer('run_after').notNull().default(now),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ── Backups (spec §61–63) ──────────────────────────────────────────────────
export const backupRecords = sqliteTable('backup_records', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(), // 'ALL' | accountId
  filePath: text('file_path').notNull(),
  sizeBytes: integer('size_bytes'),
  sha256: text('sha256'),
  encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().default(now),
});

// ── Authorized devices & sessions (spec §50–52) ────────────────────────────
export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  accountScope: text('account_scope'), // accountId this device may access, or null=admin
  lastSeenAt: integer('last_seen_at'),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull().default(now),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').references(() => devices.id, { onDelete: 'cascade' }),
    /** SHA-256 of the session token; the raw token is never stored (spec §49, §81). */
    tokenHash: text('token_hash').notNull(),
    accountScope: text('account_scope'),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => ({ byTokenHash: uniqueIndex('uq_session_token').on(t.tokenHash) }),
);

// ── Audit log (spec §82) — never stores message contents ───────────────────
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    event: text('event').notNull(),
    accountId: text('account_id'),
    deviceId: text('device_id'),
    ipAddress: text('ip_address'),
    detailJson: text('detail_json'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => ({ byEvent: index('ix_audit_event').on(t.event), byTime: index('ix_audit_time').on(t.createdAt) }),
);

// ── Settings (key/value) ───────────────────────────────────────────────────
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: integer('updated_at').notNull().default(now),
});

export type WhatsAppAccountRow = typeof whatsappAccounts.$inferSelect;
export type ChatRow = typeof chats.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type UserRow = typeof users.$inferSelect;
