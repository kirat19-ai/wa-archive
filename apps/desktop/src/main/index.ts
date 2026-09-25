import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, net, protocol, shell } from 'electron';
import { AppServices, handlers, makeBaileysFactory, mockAdapterFactory } from '@wa-archive/app-core';
import { registerIpc } from './ipc.js';

// Custom scheme to stream archived media into <img>/<video>/<a> (spec §38).
protocol.registerSchemesAsPrivileged([
  { scheme: 'wa-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

let mainWindow: BrowserWindow | null = null;
let services: AppServices | null = null;

/** Resolve the generated Drizzle migrations folder in dev and when packaged. */
function migrationsFolder(): string {
  const packaged = join(process.resourcesPath ?? '', 'drizzle');
  if (app.isPackaged && existsSync(packaged)) return packaged;
  // Dev: apps/desktop -> repo root -> packages/database/drizzle
  return join(app.getAppPath(), '..', '..', 'packages', 'database', 'drizzle');
}

function dataDir(): string {
  // Local-first: everything lives under the OS user-data dir (spec §40, §65).
  return join(app.getPath('userData'), 'archive-data');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b141a',
    title: 'WA Archive',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  const real = process.env.WA_REAL === '1';
  const factory = real ? makeBaileysFactory(join(dataDir(), 'auth')) : mockAdapterFactory;
  services = new AppServices(factory);
  const dbFile = join(dataDir(), 'archive.sqlite');
  console.log('[wa-archive] data dir:', dataDir());
  console.log('[wa-archive] migrations:', migrationsFolder());
  services.init(dbFile, migrationsFolder(), join(dataDir(), 'archive'), join(dataDir(), 'auth'));
  registerIpc(services, () => mainWindow);

  // Stream archived media: wa-media://media/<accountId>/<mediaId>
  protocol.handle('wa-media', (request) => {
    const u = new URL(request.url);
    const [, accountId, mediaId] = u.pathname.split('/');
    const file = accountId && mediaId ? handlers.mediaFile(services!, accountId, mediaId) : null;
    if (!file) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file.absolutePath).toString());
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => services?.shutdown());
