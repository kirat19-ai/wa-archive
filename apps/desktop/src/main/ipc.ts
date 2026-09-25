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
  ipcMain.handle(IPC.AccountsRemove, (_e, id: string, mode: 'connection' | 'archive') =>
    mode === 'archive' ? handlers.deleteArchive(services, id) : handlers.removeConnection(services, id),
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
  ipcMain.handle(IPC.MediaList, (_e, id: string, type?: string) =>
    handlers.listMedia(services, id, type),
  );

  ipcMain.handle(IPC.ExportChat, (_e, id: string, chatId: string, format: 'txt' | 'json' | 'html' | 'csv') =>
    handlers.exportChat(services, id, chatId, format),
  );
  ipcMain.handle(IPC.ExportChatZip, async (_e, id: string, chatId: string) => {
    const zip = await handlers.exportChatZip(services, id, chatId);
    return { filename: zip.filename, base64: zip.buffer.toString('base64') };
  });
  ipcMain.handle(IPC.BackupCreate, (_e, accountIds: string[], password: string) => {
    const ids = accountIds?.length ? accountIds : services.repos.accounts.list().map((a) => a.id);
    const buf = handlers.createBackup(services, ids, password);
    return { filename: 'WAArchiveBackup.wabackup', base64: buf.toString('base64') };
  });
  ipcMain.handle(IPC.BackupInspect, (_e, base64: string, password: string) =>
    handlers.inspectBackup(services, Buffer.from(base64, 'base64'), password),
  );
  ipcMain.handle(IPC.BackupRestore, (_e, base64: string, password: string, accountIds?: string[]) =>
    handlers.restoreBackup(services, Buffer.from(base64, 'base64'), password, accountIds),
  );

  services.bus.onAny((event, payload) => {
    getWindow()?.webContents.send(IPC.EventChannel, { event, payload });
  });
}
