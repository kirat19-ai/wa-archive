import type { AccountDTO, ChatDTO, MessageDTO, SearchHitDTO } from './dto.js';
import type { AppServices } from './services.js';

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
    return s.repos.messages.list(accountId, chatId, opts).map(toMessageDTO);
  },
  searchAccount(s: AppServices, accountId: string, query: string): SearchHitDTO[] {
    return s.repos.search.searchAccount(accountId, query);
  },
  searchAll(s: AppServices, query: string): SearchHitDTO[] {
    const ids = s.repos.accounts.list().map((a) => a.id);
    return s.repos.search.searchAccounts(ids, query);
  },
};

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
  };
}
