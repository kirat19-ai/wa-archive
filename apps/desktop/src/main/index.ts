import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, net, protocol, shell } from 'electron';
import { AppServices, handlers, makeBaileysFactory, mockAdapterFactory } from '@wa-archive/app-core';
import { registerIpc } from './ipc.js';

// The main process is bundled as an ES module ("type": "module"), where
// __dirname does not exist. Derive it from import.meta.url so preload/renderer
// paths resolve when packaged (this was the original silent-startup crash).
const moduleDir = dirname(fileURLToPath(import.meta.url));

// Custom scheme to stream archived media into <img>/<video>/<a> (spec §38).
protocol.registerSchemesAsPrivileged([
  { scheme: 'wa-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

let mainWindow: BrowserWindow | null = null;
let services: AppServices | null = null;

function dataDir(): string {
  // Local-first: everything lives under the OS user-data dir (spec §40, §65).
  return join(app.getPath('userData'), 'archive-data');
}

/** Append a timestamped line to a persistent log the user can send us. */
function logDir(): string {
  const dir = join(app.getPath('userData'), 'logs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
function logLine(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    appendFileSync(join(logDir(), 'startup.log'), line);
  } catch {
    /* logging must never itself crash startup */
  }
  // Also to stdout for `--enable-logging` / console runs.
  console.log(msg);
}

/** Show the error to the user AND record it, instead of vanishing silently. */
function reportFatal(where: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  logLine(`FATAL (${where}): ${detail}`);
  const logFile = join(app.getPath('userData'), 'logs', 'startup.log');
  try {
    dialog.showErrorBox(
      'WA Archive failed to start',
      `Something went wrong during startup (${where}).\n\n${detail}\n\n` +
        `A full log was saved to:\n${logFile}\n\n` +
        `Please send that file so this can be fixed.`,
    );
  } catch {
    /* dialog may be unavailable very early; the log file still has it */
  }
}

// Catch anything that escapes — the whole point is: never fail invisibly.
process.on('uncaughtException', (err) => reportFatal('uncaughtException', err));
process.on('unhandledRejection', (err) => reportFatal('unhandledRejection', err));

/** Resolve the generated Drizzle migrations folder in dev and when packaged. */
function migrationsFolder(): string {
  const packaged = join(process.resourcesPath ?? '', 'drizzle');
  if (app.isPackaged && existsSync(packaged)) return packaged;
  // Dev: apps/desktop -> repo root -> packages/database/drizzle
  return join(app.getAppPath(), '..', '..', 'packages', 'database', 'drizzle');
}

/**
 * electron-vite emits the preload as index.mjs (ESM, because "type": "module")
 * but has emitted index.js in other setups. Point at whichever actually exists —
 * a wrong path silently disables the preload, leaving the renderer with no
 * window.wa bridge (it then falls back to a LAN server that isn't there and
 * spins forever).
 */
function preloadPath(): string {
  const mjs = join(moduleDir, '../preload/index.mjs');
  const js = join(moduleDir, '../preload/index.js');
  return existsSync(mjs) ? mjs : js;
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
      preload: preloadPath(),
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
    void mainWindow.loadFile(join(moduleDir, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // Create the window FIRST so the user always sees something, even if backend
  // init below fails — a visible window + error dialog beats a silent no-op.
  try {
    createWindow();
  } catch (err) {
    reportFatal('createWindow', err);
  }

  try {
    // The packaged desktop app connects to real WhatsApp by default (QR on
    // "Add Account"). Set WA_MOCK=1 to use demo data instead. Baileys is loaded
    // lazily on connect, so a WhatsApp-side problem can't stop startup.
    const useMock = process.env.WA_MOCK === '1';
    const factory = useMock ? mockAdapterFactory : makeBaileysFactory(join(dataDir(), 'auth'));
    services = new AppServices(factory);
    const dbFile = join(dataDir(), 'archive.sqlite');
    logLine(`data dir: ${dataDir()}`);
    logLine(`migrations: ${migrationsFolder()}`);
    logLine(`mode: ${useMock ? 'mock' : 'real'}`);
    services.init(dbFile, migrationsFolder(), join(dataDir(), 'archive'), join(dataDir(), 'auth'));
    registerIpc(services, () => mainWindow);
    logLine('backend ready');

    // Stream archived media: wa-media://media/<accountId>/<mediaId>
    protocol.handle('wa-media', (request) => {
      const u = new URL(request.url);
      const [, accountId, mediaId] = u.pathname.split('/');
      const file = accountId && mediaId ? handlers.mediaFile(services!, accountId, mediaId) : null;
      if (!file) return new Response('not found', { status: 404 });
      return net.fetch(pathToFileURL(file.absolutePath).toString());
    });
  } catch (err) {
    // Most likely culprit historically: the native better-sqlite3 binary failing
    // to load. Surface it instead of dying before a window appears.
    reportFatal('backend-init', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => services?.shutdown());
