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
  onEvent: (cb) => {
    const listener = (_e: unknown, msg: { event: string; payload: unknown }) =>
      cb(msg.event, msg.payload);
    ipcRenderer.on(IPC.EventChannel, listener);
    return () => ipcRenderer.off(IPC.EventChannel, listener);
  },
};

contextBridge.exposeInMainWorld('wa', api);
