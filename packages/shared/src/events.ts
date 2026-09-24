/**
 * Internal event-bus channel names (spec §68).
 *
 * A single typed string union keeps producers and consumers honest. The bus
 * itself lives in @wa-archive/archive; these names are shared so the desktop
 * app, LAN server, and workers all agree on the vocabulary.
 */
export const AppEvent = {
  WhatsAppConnected: 'whatsapp.connected',
  WhatsAppDisconnected: 'whatsapp.disconnected',
  /** Full connection state incl. QR data URL, for the linked-device UI (spec §5). */
  AccountConnection: 'account.connection',
  WhatsAppMessageReceived: 'whatsapp.message.received',
  WhatsAppMessageUpdated: 'whatsapp.message.updated',
  WhatsAppMessageDeleted: 'whatsapp.message.deleted',
  WhatsAppChatUpdated: 'whatsapp.chat.updated',

  ArchiveMessageCreated: 'archive.message.created',
  ArchiveMediaQueued: 'archive.media.queued',
  ArchiveMediaDownloaded: 'archive.media.downloaded',
  ArchiveMediaFailed: 'archive.media.failed',

  SyncStarted: 'sync.started',
  SyncProgress: 'sync.progress',
  SyncCompleted: 'sync.completed',

  DeviceConnected: 'device.connected',
  DeviceRevoked: 'device.revoked',
} as const;

export type AppEventName = (typeof AppEvent)[keyof typeof AppEvent];
