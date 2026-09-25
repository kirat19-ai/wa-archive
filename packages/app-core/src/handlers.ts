import {
  createBackup,
  exportChat,
  inspectBackup,
  restoreBackup,
  type BackupSummary,
  type ExportFormat,
  type ExportResult,
} from '@wa-archive/backup';
import type { AccountDTO, ChatDTO, MediaDTO, MessageDTO, SearchHitDTO } from './dto.js';
import type { AppServices } from './services.js';

type MediaRow = ReturnType<AppServices['repos']['media']['listByAccount']>[number];

type ChatRow = ReturnType<AppServices['repos']['chats']['list']>[number];
type MessageRow = ReturnType<AppServices['repos']['messages']['list']>[number];
type AccountRow = NonNullable<ReturnType<AppServices['repos']['accounts']['get']>>;

/**
 * Application handlers — the single source of truth for read/write behavior,
 * called identically from Electron IPC and the LAN HTTP API. Keeping them here
 * (not in a transport) means account isolation and DTO shaping are enforced in
 * one place (spec §95, §106).
 */
export const handlers = {
  listAccounts(s: AppServices): AccountDTO[] {
    return s.repos.accounts.list().map((a) => toAccountDTO(s, a));
  },

  async createAccount(
    s: AppServices,
    input: { displayName: string; phoneNumber?: string },
  ): Promise<AccountDTO> {
    const acc = s.repos.accounts.create(input);
    await s.connectAccount(acc.id); // Phase 1: mock connect + import
    return toAccountDTO(s, s.repos.accounts.get(acc.id)!);
  },

  connectAccount: (s: AppServices, accountId: string) => s.connectAccount(accountId),
  disconnectAccount: (s: AppServices, accountId: string) => s.disconnectAccount(accountId),
  removeConnection: (s: AppServices, accountId: string) => s.removeConnection(accountId),
  deleteArchive: (s: AppServices, accountId: string) => s.deleteArchive(accountId),

  listChats(s: AppServices, accountId: string, opts?: { includeDeleted?: boolean }): ChatDTO[] {
    return s.repos.chats.list(accountId, opts).map(toChatDTO);
  },
  listDeletedChats(s: AppServices, accountId: string): ChatDTO[] {
    return s.repos.chats.listDeleted(accountId).map(toChatDTO);
  },
  listMessages(
    s: AppServices,
    accountId: string,
    chatId: string,
    opts?: { limit?: number; before?: number },
  ): MessageDTO[] {
    return s.repos.messages.list(accountId, chatId, opts).map((m) => {
      const dto = toMessageDTO(m);
      // Attach archived media so the thread can render it inline (spec §36).
      if (m.messageType !== 'TEXT' && m.messageType !== 'SYSTEM') {
        dto.media = s.repos.media.listByMessage(accountId, m.id).map(toMediaDTO);
      }
      return dto;
    });
  },
  searchAccount(s: AppServices, accountId: string, query: string): SearchHitDTO[] {
    return s.repos.search.searchAccount(accountId, query);
  },
  searchAll(s: AppServices, query: string): SearchHitDTO[] {
    const ids = s.repos.accounts.list().map((a) => a.id);
    return s.repos.search.searchAccounts(ids, query);
  },

  listMedia(s: AppServices, accountId: string, mediaType?: string): MediaDTO[] {
    return s.repos.media.listByAccount(accountId, mediaType).map(toMediaDTO);
  },
  mediaForMessage(s: AppServices, accountId: string, messageId: string): MediaDTO[] {
    return s.repos.media.listByMessage(accountId, messageId).map(toMediaDTO);
  },

  exportChat(
    s: AppServices,
    accountId: string,
    chatId: string,
    format: ExportFormat,
  ): ExportResult {
    return exportChat(s.repos, accountId, chatId, format);
  },

  /** Encrypted backup of the given accounts (spec §61-62). */
  createBackup(s: AppServices, accountIds: string[], password: string): Buffer {
    return createBackup(s.db, s.storage, accountIds, password);
  },
  inspectBackup(_s: AppServices, file: Buffer, password: string): BackupSummary {
    return inspectBackup(file, password);
  },
  restoreBackup(
    s: AppServices,
    file: Buffer,
    password: string,
    selected?: string[],
  ): Promise<{ restored: string[] }> {
    return restoreBackup(s.db, s.storage, file, password, selected);
  },

  /** Resolve an archived media file to an absolute path for streaming (spec §38). */
  mediaFile(
    s: AppServices,
    accountId: string,
    mediaId: string,
  ): { absolutePath: string; mimeType: string | null; filename: string | null } | null {
    const row = s.repos.media.get(accountId, mediaId);
    if (!row || row.downloadStatus !== 'ARCHIVED' || !row.storagePath) return null;
    if (!s.storage.exists(row.storagePath)) return null;
    return {
      absolutePath: s.storage.absolutePath(row.storagePath),
      mimeType: row.mimeType,
      filename: row.originalFilename,
    };
  },
};

export function toMediaDTO(m: MediaRow): MediaDTO {
  return {
    id: m.id,
    accountId: m.accountId,
    messageId: m.messageId,
    mediaType: m.mediaType,
    mimeType: m.mimeType,
    originalFilename: m.originalFilename,
    fileSize: m.fileSize,
    width: m.width,
    height: m.height,
    duration: m.duration,
    downloadStatus: m.downloadStatus,
    hasFile: m.downloadStatus === 'ARCHIVED' && Boolean(m.storagePath),
  };
}

export function toAccountDTO(s: AppServices, r: AccountRow): AccountDTO {
  return {
    id: r.id,
    displayName: r.displayName,
    phoneNumber: r.phoneNumber,
    connectionStatus: r.connectionStatus,
    profileName: r.profileName,
    archiveStartedAt: r.archiveStartedAt,
    lastSyncAt: r.lastSyncAt,
    stats: {
      chats: s.repos.chats.list(r.id, { includeDeleted: true }).length,
      messages: s.repos.messages.countByAccount(r.id),
      media: s.repos.media.countByAccount(r.id),
      storageBytes: s.repos.media.storageBytesByAccount(r.id),
    },
  };
}

export function toChatDTO(c: ChatRow): ChatDTO {
  return {
    id: c.id,
    accountId: c.accountId,
    name: c.name,
    chatType: c.chatType,
    phoneNumber: c.phoneNumber,
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: c.lastMessagePreview,
    pinned: c.pinned,
    muted: c.muted,
    whatsappDeleted: c.whatsappDeleted,
  };
}

export function toMessageDTO(m: MessageRow): MessageDTO {
  return {
    id: m.id,
    chatId: m.chatId,
    senderId: m.senderId,
    participantId: m.participantId,
    timestamp: m.timestamp,
    direction: m.direction,
    messageType: m.messageType,
    text: m.text,
    caption: m.caption,
    quotedMessageId: m.quotedMessageId,
    forwarded: m.forwarded,
    whatsappDeleted: m.whatsappDeleted,
    media: [],
  };
}
