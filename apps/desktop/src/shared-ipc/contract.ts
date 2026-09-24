import type { AccountDTO, ChatDTO, MediaDTO, MessageDTO, SearchHitDTO } from '@wa-archive/app-core';

/**
 * Typed IPC contract between the Electron main process and the renderer.
 * DTOs are shared with the LAN server via @wa-archive/app-core so both
 * transports speak the same shapes.
 */
export type { AccountDTO, ChatDTO, MediaDTO, MessageDTO, SearchHitDTO };

export interface WaApi {
  accounts: {
    list(): Promise<AccountDTO[]>;
    create(input: { displayName: string; phoneNumber?: string }): Promise<AccountDTO>;
    connect(accountId: string): Promise<void>;
    disconnect(accountId: string): Promise<void>;
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
  /**
   * Present only over the LAN transport (spec §44-48). Absent in Electron, where
   * the local user is trusted and no login is required.
   */
  auth?: AuthApi;
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

export const IPC = {
  AccountsList: 'accounts:list',
  AccountsCreate: 'accounts:create',
  AccountsConnect: 'accounts:connect',
  AccountsDisconnect: 'accounts:disconnect',
  ChatsList: 'chats:list',
  ChatsListDeleted: 'chats:listDeleted',
  MessagesList: 'messages:list',
  SearchAccount: 'search:account',
  SearchAll: 'search:all',
  MediaList: 'media:list',
  EventChannel: 'wa:event',
} as const;
