import { ipcMain, type BrowserWindow } from 'electron';
import { handlers, type AppServices } from '@wa-archive/app-core';
import { IPC } from '../shared-ipc/contract.js';

/** Register IPC handlers and bridge backend events to the renderer (spec §58). */
export function registerIpc(services: AppServices, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.AccountsList, () => handlers.listAccounts(services));
  ipcMain.handle(IPC.AccountsCreate, (_e, input: { displayName: string; phoneNumber?: string }) =>
    handlers.createAccount(services, input),
  );
  ipcMain.handle(IPC.AccountsConnect, (_e, id: string) => handlers.connectAccount(services, id));
  ipcMain.handle(IPC.AccountsDisconnect, (_e, id: string) =>
    handlers.disconnectAccount(services, id),
  );

  ipcMain.handle(IPC.ChatsList, (_e, id: string, opts?: { includeDeleted?: boolean }) =>
    handlers.listChats(services, id, opts),
  );
  ipcMain.handle(IPC.ChatsListDeleted, (_e, id: string) => handlers.listDeletedChats(services, id));
  ipcMain.handle(
    IPC.MessagesList,
    (_e, id: string, chatId: string, opts?: { limit?: number; before?: number }) =>
      handlers.listMessages(services, id, chatId, opts),
  );
  ipcMain.handle(IPC.SearchAccount, (_e, id: string, query: string) =>
    handlers.searchAccount(services, id, query),
  );
  ipcMain.handle(IPC.SearchAll, (_e, query: string) => handlers.searchAll(services, query));

  services.bus.onAny((event, payload) => {
    getWindow()?.webContents.send(IPC.EventChannel, { event, payload });
  });
}
