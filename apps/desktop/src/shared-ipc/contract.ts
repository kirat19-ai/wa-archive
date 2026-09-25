import type {
  AccountDTO,
  BackupSummary,
  ChatDTO,
  ExportResult,
  MediaDTO,
  MessageDTO,
  SearchHitDTO,
} from '@wa-archive/app-core';

/**
 * Typed IPC contract between the Electron main process and the renderer.
 * DTOs are shared with the LAN server via @wa-archive/app-core so both
 * transports speak the same shapes.
 */
export type { AccountDTO, BackupSummary, ChatDTO, ExportResult, MediaDTO, MessageDTO, SearchHitDTO };

export type ExportFmt = 'txt' | 'json' | 'html' | 'csv';

export interface WaApi {
  accounts: {
    list(): Promise<AccountDTO[]>;
    create(input: { displayName: string; phoneNumber?: string }): Promise<AccountDTO>;
    connect(accountId: string): Promise<void>;
    disconnect(accountId: string): Promise<void>;
    /** Remove connection but keep the archive, or permanently delete it (spec §94). */
    remove(accountId: string, mode: 'connection' | 'archive'): Promise<void>;
  };
  chats: {
    list(accountId: string, opts?: { includeDeleted?: boolean }): Promise<ChatDTO[]>;
    listDeleted(accountId: string): Promise<ChatDTO[]>;
  };
  messages: {
    list(
      accountId: string,
      chatId: string,
      opts?: { limit?: number; before?: number },
    ): Promise<MessageDTO[]>;
  };
  search: {
    account(accountId: string, query: string): Promise<SearchHitDTO[]>;
    all(query: string): Promise<SearchHitDTO[]>;
  };
  media: {
    list(accountId: string, type?: string): Promise<MediaDTO[]>;
    /** Synchronous URL for <img>/<video>/<a> (spec §38). */
    url(accountId: string, mediaId: string): string;
  };
  files: {
    exportChat(accountId: string, chatId: string, format: ExportFmt): Promise<ExportResult>;
    /** ZIP bundle (messages + media) as base64 (spec §64). */
    exportChatZip(accountId: string, chatId: string): Promise<{ filename: string; base64: string }>;
  };
  backups: {
    create(accountIds: string[], password: string): Promise<{ filename: string; base64: string }>;
    inspect(base64: string, password: string): Promise<BackupSummary>;
    restore(base64: string, password: string, accountIds?: string[]): Promise<{ restored: string[] }>;
  };
  /**
   * Present only over the LAN transport (spec §44-48). Absent in Electron, where
   * the local user is trusted and no login is required.
   */
  auth?: AuthApi;
  /** Admin management (LAN pairing + devices), LAN transport only. */
  admin?: AdminApi;
  /** Subscribe to backend events (spec §58 live updates). Returns an unsubscribe. */
  onEvent(cb: (event: string, payload: unknown) => void): () => void;
}

export interface AuthState {
  authenticated: boolean;
  isAdmin: boolean;
  accountScope: string | null;
}

export interface AuthApi {
  me(): Promise<AuthState>;
  accounts(): Promise<{ id: string; displayName: string }[]>;
  loginAccount(accountId: string, password: string, remember?: boolean): Promise<boolean>;
  loginAdmin(username: string, password: string, remember?: boolean): Promise<boolean>;
  logout(): Promise<void>;
}

export interface LanInfoDTO {
  enabled: boolean;
  urls: string[];
  qr: string | null;
}

export interface DeviceDTO {
  id: string;
  label: string;
  ipAddress: string | null;
  userAgent: string | null;
  accountScope: string | null;
  lastSeenAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

/** Admin-only management, present only over the authenticated LAN transport. */
export interface AdminApi {
  lanInfo(): Promise<LanInfoDTO>;
  devices(): Promise<DeviceDTO[]>;
  revokeDevice(deviceId: string): Promise<void>;
}

export const IPC = {
  AccountsList: 'accounts:list',
  AccountsCreate: 'accounts:create',
  AccountsConnect: 'accounts:connect',
  AccountsDisconnect: 'accounts:disconnect',
  AccountsRemove: 'accounts:remove',
  ChatsList: 'chats:list',
  ChatsListDeleted: 'chats:listDeleted',
  MessagesList: 'messages:list',
  SearchAccount: 'search:account',
  SearchAll: 'search:all',
  MediaList: 'media:list',
  ExportChat: 'files:exportChat',
  ExportChatZip: 'files:exportChatZip',
  BackupCreate: 'backup:create',
  BackupInspect: 'backup:inspect',
  BackupRestore: 'backup:restore',
  EventChannel: 'wa:event',
} as const;
