import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type WaApi } from '../shared-ipc/contract.js';

/**
 * Secure bridge (spec §80): contextIsolation is on, nodeIntegration off. The
 * renderer only ever sees this narrow, typed surface — never ipcRenderer,
 * Node, the database, or Baileys.
 */
const api: WaApi = {
  accounts: {
    list: () => ipcRenderer.invoke(IPC.AccountsList),
    create: (input) => ipcRenderer.invoke(IPC.AccountsCreate, input),
    connect: (accountId) => ipcRenderer.invoke(IPC.AccountsConnect, accountId),
    disconnect: (accountId) => ipcRenderer.invoke(IPC.AccountsDisconnect, accountId),
    remove: (accountId, mode) => ipcRenderer.invoke(IPC.AccountsRemove, accountId, mode),
  },
  chats: {
    list: (accountId, opts) => ipcRenderer.invoke(IPC.ChatsList, accountId, opts),
    listDeleted: (accountId) => ipcRenderer.invoke(IPC.ChatsListDeleted, accountId),
  },
  messages: {
    list: (accountId, chatId, opts) => ipcRenderer.invoke(IPC.MessagesList, accountId, chatId, opts),
  },
  search: {
    account: (accountId, query) => ipcRenderer.invoke(IPC.SearchAccount, accountId, query),
    all: (query) => ipcRenderer.invoke(IPC.SearchAll, query),
  },
  media: {
    list: (accountId, type) => ipcRenderer.invoke(IPC.MediaList, accountId, type),
    // Streamed by the custom `wa-media://` protocol registered in the main process.
    url: (accountId, mediaId) => `wa-media://media/${accountId}/${mediaId}`,
  },
  files: {
    exportChat: (accountId, chatId, format) => ipcRenderer.invoke(IPC.ExportChat, accountId, chatId, format),
    exportChatZip: (accountId, chatId) => ipcRenderer.invoke(IPC.ExportChatZip, accountId, chatId),
  },
  backups: {
    create: (accountIds, password) => ipcRenderer.invoke(IPC.BackupCreate, accountIds, password),
    inspect: (base64, password) => ipcRenderer.invoke(IPC.BackupInspect, base64, password),
    restore: (base64, password, accountIds) => ipcRenderer.invoke(IPC.BackupRestore, base64, password, accountIds),
  },
  onEvent: (cb) => {
    const listener = (_e: unknown, msg: { event: string; payload: unknown }) =>
      cb(msg.event, msg.payload);
    ipcRenderer.on(IPC.EventChannel, listener);
    return () => ipcRenderer.off(IPC.EventChannel, listener);
  },
};

contextBridge.exposeInMainWorld('wa', api);
