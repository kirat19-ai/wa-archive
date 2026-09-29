// The WhatsApp connection uses `ws`, which optionally loads the native
// `bufferutil` / `utf-8-validate` addons. When the app is bundled+packaged the
// native interop breaks ("bufferUtil.mask is not a function"), killing the
// connection. Force ws to use its built-in pure-JS implementations instead —
// functionally identical, just slightly less CPU-optimal. MUST be set before
// ws is ever required.
process.env.WS_NO_BUFFER_UTIL = '1';
process.env.WS_NO_UTF_8_VALIDATE = '1';

import type { Server } from 'node:http';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { AppServices, makeBaileysFactory } from '@wa-archive/app-core';
import { SessionService } from '@wa-archive/auth';
import { createArchiveServer } from '@wa-archive/server';

const moduleDir = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let services: AppServices | null = null;
let httpServer: Server | null = null;

function dataDir(): string {
  return join(app.getPath('userData'), 'archive-data');
}
function logDir(): string {
  const dir = join(app.getPath('userData'), 'logs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
function logLine(msg: string): void {
  try {
    appendFileSync(join(logDir(), 'startup.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* logging must never itself crash startup */
  }
  console.log(msg);
}

// True only while the backend is initializing. Once the app is up, stray async
// errors (dropped WhatsApp sockets, aborted fetches) are background noise.
let startupPhase = true;

function reportFatal(where: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  logLine(`ERROR (${where})${startupPhase ? ' [startup]' : ' [background]'}: ${detail}`);
  if (!startupPhase) return;
  const logFile = join(app.getPath('userData'), 'logs', 'startup.log');
  try {
    dialog.showErrorBox(
      'WA Archive failed to start',
      `Something went wrong during startup (${where}).\n\n${detail}\n\n` +
        `A full log was saved to:\n${logFile}\n\nPlease send that file so this can be fixed.`,
    );
  } catch {
    /* dialog may be unavailable very early; the log file still has it */
  }
}

function isBenignNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ''}` : String(err);
  return /terminated|aborted|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|UND_ERR|other side closed|EPIPE/i.test(
    msg,
  );
}
process.on('uncaughtException', (err) => {
  if (isBenignNetworkError(err)) return void logLine(`ignored network error: ${String(err)}`);
  reportFatal('uncaughtException', err);
});
process.on('unhandledRejection', (err) => {
  if (isBenignNetworkError(err)) return void logLine(`ignored network rejection: ${String(err)}`);
  reportFatal('unhandledRejection', err);
});

function migrationsFolder(): string {
  const packaged = join(process.resourcesPath ?? '', 'drizzle');
  if (app.isPackaged && existsSync(packaged)) return packaged;
  return join(app.getAppPath(), '..', '..', 'packages', 'database', 'drizzle');
}

/** Built web UI (index.html + assets) served to the window and to phones. */
function webRoot(): string {
  return join(moduleDir, '../web');
}

/** Try to listen on the first free port from a small list (LAN-wide bind). */
function listenWithFallback(server: Server, ports: number[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (i: number): void => {
      if (i >= ports.length) return reject(new Error('no free port'));
      const port = ports[i]!;
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') tryPort(i + 1);
        else reject(err);
      });
      // 0.0.0.0 → reachable from the whole Wi-Fi (private-range enforced + auth
      // required in the server). Loopback still works for the desktop window.
      server.listen(port, '0.0.0.0', () => resolve(port));
    };
    tryPort(0);
  });
}

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b141a',
    title: 'WA Archive',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.on('ready-to-show', () => mainWindow?.show());
  // External links open in the real browser, not inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  void mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(async () => {
  try {
    const factory = makeBaileysFactory(join(dataDir(), 'auth'));
    services = new AppServices(factory);
    const dbFile = join(dataDir(), 'archive.sqlite');
    logLine(`data dir: ${dataDir()}`);
    services.init(dbFile, migrationsFolder(), join(dataDir(), 'archive'), join(dataDir(), 'auth'));
    const sessions = new SessionService(services.db, services.repos);
    logLine('backend ready');

    // Reconnect previously-linked accounts so archiving resumes on launch.
    for (const acc of services.repos.accounts.list()) {
      services
        .connectAccount(acc.id)
        .catch((e) => logLine(`reconnect ${acc.id} failed: ${String(e)}`));
    }

    // Passed by reference; the /api/lan/info handler reads it at request time,
    // so updating .port after we learn the real bound port keeps the QR correct.
    const lan = { host: '0.0.0.0', port: 8787, https: false };
    httpServer = createArchiveServer({
      services,
      sessionService: sessions,
      webRoot: webRoot(),
      requireAuth: true, // password required in the app AND on the network
      secureCookies: false, // plain HTTP on the LAN
      lan,
    });
    const port = await listenWithFallback(httpServer, [8787, 8788, 8799, 8080, 8181]);
    lan.port = port;
    logLine(`server listening on 0.0.0.0:${port}`);

    createWindow(port);
  } catch (err) {
    reportFatal('backend-init', err);
  } finally {
    startupPhase = false;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && httpServer) {
      const addr = httpServer.address();
      if (addr && typeof addr === 'object') createWindow(addr.port);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    httpServer?.close();
  } catch {
    /* ignore */
  }
  services?.shutdown();
});
