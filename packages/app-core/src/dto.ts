/** Transport-agnostic DTOs shared by the Electron IPC layer and the LAN server. */
export interface AccountDTO {
  id: string;
  displayName: string;
  phoneNumber: string | null;
  connectionStatus: string;
  profileName: string | null;
  archiveStartedAt: number | null;
  lastSyncAt: number | null;
  stats: { chats: number; messages: number; media: number; storageBytes: number };
}

export interface MediaDTO {
  id: string;
  accountId: string;
  messageId: string;
  mediaType: string;
  mimeType: string | null;
  originalFilename: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  downloadStatus: string;
  /** URL to fetch the bytes (LAN server); null until archived. */
  hasFile: boolean;
}

export interface ChatDTO {
  id: string;
  accountId: string;
  name: string | null;
  chatType: string;
  phoneNumber: string | null;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
  pinned: boolean;
  muted: boolean;
  whatsappDeleted: boolean;
}

export interface MessageDTO {
  id: string;
  chatId: string;
  senderId: string | null;
  participantId: string | null;
  timestamp: number;
  direction: string;
  messageType: string;
  text: string | null;
  caption: string | null;
  quotedMessageId: string | null;
  forwarded: boolean;
  whatsappDeleted: boolean;
  media: MediaDTO[];
}

export interface SearchHitDTO {
  accountId: string;
  chatId: string;
  chatName: string | null;
  messageId: string;
  text: string | null;
  timestamp: number;
}
