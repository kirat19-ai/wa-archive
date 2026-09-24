import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { AppEvent, type AppEventName } from '@wa-archive/shared';
import { handlers, type AppServices } from '@wa-archive/app-core';

export interface ArchiveServerOptions {
  services: AppServices;
  /** Absolute path to the built web UI (index.html + assets). Optional. */
  webRoot?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * The LAN archive server (spec §41, §58). Exposes the same handlers the desktop
 * IPC layer uses over JSON, plus a WebSocket that broadcasts backend events for
 * live phone updates. Serves the PWA build when webRoot is provided.
 *
 * NOTE: Phase 5 layers per-account passwords, sessions, device authorization,
 * private-range validation and the LAN on/off toggle on top of this. For now it
 * binds to the host given by the caller (default loopback).
 */
export function createArchiveServer(opts: ArchiveServerOptions): Server {
  const { services, webRoot } = opts;

  const server = createServer((req, res) => {
    void route(req, res).catch((err) => {
      json(res, 500, { error: String(err?.message ?? err) });
    });
  });

  // WebSocket bridge for live updates.
  const wss = new WebSocketServer({ server, path: '/ws' });
  services.bus.onAny((event: AppEventName, payload) => {
    const frame = JSON.stringify({ event, payload });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(frame);
    }
  });
  void AppEvent;

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path.startsWith('/api/')) return api(req, res, url, method);

    // Static + SPA fallback.
    if (webRoot) return serveStatic(res, webRoot, path);
    json(res, 404, { error: 'not found' });
  }

  async function api(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    method: string,
  ): Promise<void> {
    const p = url.pathname;
    const seg = p.split('/').filter(Boolean); // ['api', ...]

    // GET /api/accounts
    if (p === '/api/accounts' && method === 'GET') {
      return json(res, 200, handlers.listAccounts(services));
    }
    // POST /api/accounts
    if (p === '/api/accounts' && method === 'POST') {
      const body = await readJson(req);
      if (!body.displayName) return json(res, 400, { error: 'displayName required' });
      return json(res, 200, await handlers.createAccount(services, {
        displayName: body.displayName,
        phoneNumber: body.phoneNumber,
      }));
    }
    // POST /api/accounts/:id/connect|disconnect
    if (seg[1] === 'accounts' && seg[2] && seg[3] === 'connect' && method === 'POST') {
      await handlers.connectAccount(services, seg[2]);
      return json(res, 200, { ok: true });
    }
    if (seg[1] === 'accounts' && seg[2] && seg[3] === 'disconnect' && method === 'POST') {
      await handlers.disconnectAccount(services, seg[2]);
      return json(res, 200, { ok: true });
    }
    // GET /api/accounts/:id/chats
    if (seg[1] === 'accounts' && seg[2] && seg[3] === 'chats' && !seg[4] && method === 'GET') {
      const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
      return json(res, 200, handlers.listChats(services, seg[2], { includeDeleted }));
    }
    // GET /api/accounts/:id/chats/deleted
    if (seg[1] === 'accounts' && seg[2] && seg[3] === 'chats' && seg[4] === 'deleted' && method === 'GET') {
      return json(res, 200, handlers.listDeletedChats(services, seg[2]));
    }
    // GET /api/accounts/:id/chats/:chatId/messages
    if (seg[1] === 'accounts' && seg[2] && seg[3] === 'chats' && seg[4] && seg[5] === 'messages' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? '200');
      const beforeRaw = url.searchParams.get('before');
      const before = beforeRaw ? Number(beforeRaw) : undefined;
      return json(res, 200, handlers.listMessages(services, seg[2], seg[4], { limit, before }));
    }
    // GET /api/accounts/:id/search
    if (seg[1] === 'accounts' && seg[2] && seg[3] === 'search' && method === 'GET') {
      const query = url.searchParams.get('query') ?? '';
      return json(res, 200, handlers.searchAccount(services, seg[2], query));
    }
    // GET /api/accounts/:id/media
    if (seg[1] === 'accounts' && seg[2] && seg[3] === 'media' && !seg[4] && method === 'GET') {
      const type = url.searchParams.get('type') ?? undefined;
      return json(res, 200, handlers.listMedia(services, seg[2], type));
    }
    // GET /api/accounts/:id/media/:mediaId/file  → stream bytes
    if (seg[1] === 'accounts' && seg[2] && seg[3] === 'media' && seg[4] && seg[5] === 'file' && method === 'GET') {
      const file = handlers.mediaFile(services, seg[2], seg[4]);
      if (!file) return json(res, 404, { error: 'media not archived' });
      return streamFile(req, res, file.absolutePath, file.mimeType ?? 'application/octet-stream');
    }
    // GET /api/search
    if (p === '/api/search' && method === 'GET') {
      const query = url.searchParams.get('query') ?? '';
      return json(res, 200, handlers.searchAll(services, query));
    }

    json(res, 404, { error: 'unknown endpoint' });
  }

  return server;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(s);
}

async function readJson(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/** Stream an archived media file with HTTP Range support (spec §38 media viewer). */
function streamFile(
  req: IncomingMessage,
  res: ServerResponse,
  absPath: string,
  mime: string,
): void {
  if (!existsSync(absPath)) return void json(res, 404, { error: 'not found' });
  const size = statSync(absPath).size;
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (start >= size || end >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      return void res.end();
    }
    res.writeHead(206, {
      'content-type': mime,
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
    });
    return void createReadStream(absPath, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': mime, 'content-length': size, 'accept-ranges': 'bytes' });
  createReadStream(absPath).pipe(res);
}

/** Serve a static file, guarding against path traversal (spec §80), SPA fallback to index.html. */
function serveStatic(res: ServerResponse, root: string, urlPath: string): void {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, rel);
  if (!resolve(filePath).startsWith(resolve(root))) {
    return void json(res, 403, { error: 'forbidden' });
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, 'index.html'); // SPA fallback
  }
  if (!existsSync(filePath)) return void json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}
