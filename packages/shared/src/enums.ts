/**
 * Canonical enumerations for WA Archive.
 *
 * These are the normalized, adapter-independent values used across the whole
 * system (database, IPC, LAN API, UI). The Baileys adapter maps raw WhatsApp
 * values onto these; the rest of the app never sees a raw Baileys enum.
 */

/** Connection lifecycle of a single WhatsApp account socket (spec §10). */
export const ConnectionStatus = {
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  RECONNECTING: 'RECONNECTING',
  LOGGED_OUT: 'LOGGED_OUT',
  PAUSED: 'PAUSED',
  ERROR: 'ERROR',
} as const;
export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

/** Normalized message / media kinds (spec §20). UNKNOWN is a first-class value. */
export const MessageType = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  AUDIO: 'AUDIO',
  VOICE_NOTE: 'VOICE_NOTE',
  DOCUMENT: 'DOCUMENT',
  STICKER: 'STICKER',
  GIF: 'GIF',
  LOCATION: 'LOCATION',
  CONTACT: 'CONTACT',
  POLL: 'POLL',
  REACTION: 'REACTION',
  LINK: 'LINK',
  SYSTEM: 'SYSTEM',
  UNKNOWN: 'UNKNOWN',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Physical media categories that map to on-disk storage folders (spec §21). */
export const MediaType = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  AUDIO: 'AUDIO',
  VOICE_NOTE: 'VOICE_NOTE',
  DOCUMENT: 'DOCUMENT',
  STICKER: 'STICKER',
  GIF: 'GIF',
  UNKNOWN: 'UNKNOWN',
} as const;
export type MediaType = (typeof MediaType)[keyof typeof MediaType];

/** Media download pipeline state (spec §19, §24). */
export const MediaDownloadStatus = {
  PENDING: 'PENDING',
  DOWNLOADING: 'DOWNLOADING',
  ARCHIVED: 'ARCHIVED',
  FAILED: 'FAILED',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;
export type MediaDownloadStatus =
  (typeof MediaDownloadStatus)[keyof typeof MediaDownloadStatus];

/** Chat kinds. */
export const ChatType = {
  INDIVIDUAL: 'INDIVIDUAL',
  GROUP: 'GROUP',
  BROADCAST: 'BROADCAST',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ChatType = (typeof ChatType)[keyof typeof ChatType];

/** Direction of a message relative to the archiving account. */
export const MessageDirection = {
  INCOMING: 'INCOMING',
  OUTGOING: 'OUTGOING',
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

/** Local application user roles (spec §14). Distinct from WhatsApp accounts. */
export const UserRole = {
  ADMIN: 'ADMIN',
  ACCOUNT_USER: 'ACCOUNT_USER',
  READ_ONLY: 'READ_ONLY',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Background job lifecycle (spec §69). */
export const JobStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];
