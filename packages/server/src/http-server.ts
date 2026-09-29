import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import type { AppEventName } from '@wa-archive/shared';
import { handlers, type AppServices, type ExportFormat } from '@wa-archive/app-core';
import type { SessionContext, SessionService } from '@wa-archive/auth';
import {
  clearSessionCookie,
  clientIp,
  isPrivateAddress,
  parseCookies,
  SESSION_COOKIE,
  setSessionCookie,
} from './auth-http.js';
import { lanInfo } from './lan.js';

export interface ArchiveServerOptions {
  services: AppServices;
  sessionService: SessionService;
  /** Absolute path to the built web UI (index.html + assets). Optional. */
  webRoot?: string;
  /** Require authentication for data endpoints (spec §48). Default true. */
  requireAuth?: boolean;
  /** Mark cookies Secure (only when serving over HTTPS/TLS, spec §57). */
  secureCookies?: boolean;
  /** Binding info, used to report LAN URLs + a pairing QR (spec §43). */
  lan?: { host: string; port: number; https: boolean };
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
 * The LAN archive server (spec §41-58). Same handlers as the desktop IPC layer,
 * plus session auth (spec §48), per-account authorization (403 on mismatch),
 * device management, a WebSocket for live updates, and private-range enforcement.
 */
export function createArchiveServer(opts: ArchiveServerOptions): Server {
  const { services, sessionService, webRoot } = opts;
  const requireAuth = opts.requireAuth ?? true;
  const secure = opts.secureCookies ?? false;

  const server = createServer((req, res) => {
    void route(req, res).catch((err) => json(res, 500, { error: String(err?.message ?? err) }));
  });

  // WebSocket bridge for live updates. Authorized via the session cookie.
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!isPrivateAddress(clientIp(req))) return socket.destroy();
    const ctx = sessionService.validate(parseCookies(req)[SESSION_COOKIE], clientIp(req));
    if (requireAuth && !ctx) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as { _ctx?: SessionContext | null })._ctx = ctx;
      wss.emit('connection', ws, req);
    });
  });
  services.bus.onAny((event: AppEventName, payload) => {
    const frame = JSON.stringify({ event, payload });
    const accountId = (payload as { accountId?: string } | null)?.accountId;
    for (const client of wss.clients) {
      const ctx = (client as { _ctx?: SessionContext | null })._ctx ?? null;
      // Only deliver an account's events to the session scoped to THAT profile
      // (spec §45/§48). Admin sessions do not receive profile data events.
      if (accountId && ctx?.accountScope !== accountId) continue;
      if (client.readyState === client.OPEN) client.send(frame);
    }
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = clientIp(req);
    // Reject non-private inbound connections outright (spec §56).
    if (!isPrivateAddress(ip)) return json(res, 403, { error: 'non-private address rejected' });

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) return api(req, res, url, req.method ?? 'GET', ip);
    if (webRoot) return serveStatic(res, webRoot, url.pathname);
    json(res, 404, { error: 'not found' });
  }

  async function api(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    method: string,
    ip: string | null,
  ): Promise<void> {
    const p = url.pathname;
    const seg = p.split('/').filter(Boolean);
    const ctx = sessionService.validate(parseCookies(req)[SESSION_COOKIE], ip);
    const dev = { ip, userAgent: req.headers['user-agent'] ?? null };

    // ── public (unauthenticated) ──────────────────────────────────────────
    if (p === '/api/health') return json(res, 200, { ok: true });

    // Login picker: account NAMES only, never any archived data.
    if (p === '/api/auth/accounts' && method === 'GET') {
      return json(
        res,
        200,
        services.repos.accounts.list().map((a) => ({ id: a.id, displayName: a.displayName })),
      );
    }
    if (p === '/api/auth/me' && method === 'GET') {
      return json(res, 200, {
        authenticated: Boolean(ctx),
        isAdmin: ctx?.isAdmin ?? false,
        accountScope: ctx?.accountScope ?? null,
      });
    }
    if (p === '/api/auth/login/account' && method === 'POST') {
      const body = await readJson(req);
      const result = await sessionService.loginAccount(String(body.accountId), String(body.password), {
        ...dev,
        remember: body.remember === 'true' || body.remember === '1',
      });
      if (!result) return json(res, 401, { error: 'invalid credentials' });
      setSessionCookie(res, result.token, result.expiresAt, secure);
      return json(res, 200, { ok: true, accountScope: result.context.accountScope, isAdmin: false });
    }
    if (p === '/api/auth/login/admin' && method === 'POST') {
      const body = await readJson(req);
      const result = await sessionService.loginAdmin(String(body.username), String(body.password), {
        ...dev,
        remember: body.remember === 'true' || body.remember === '1',
      });
      if (!result) return json(res, 401, { error: 'invalid credentials' });
      setSessionCookie(res, result.token, result.expiresAt, secure);
      return json(res, 200, { ok: true, isAdmin: true, accountScope: null });
    }
    if (p === '/api/auth/logout' && method === 'POST') {
      sessionService.logout(parseCookies(req)[SESSION_COOKIE]);
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }
    // First-run: is a master (admin) password set yet?
    if (p === '/api/auth/needs-setup' && method === 'GET') {
      return json(res, 200, { needsSetup: !sessionService.hasAdmin() });
    }
    // First-run: create the master password. Only allowed while no admin exists;
    // logs the caller straight in as admin so they can add profiles.
    if (p === '/api/auth/setup' && method === 'POST') {
      if (sessionService.hasAdmin()) return json(res, 403, { error: 'already set up' });
      const body = await readJson(req);
      const password = String(body.password ?? '');
      if (password.length < 6) return json(res, 400, { error: 'password too short (min 6)' });
      await sessionService.ensureAdmin('admin', password);
      const result = await sessionService.loginAdmin('admin', password, { ...dev });
      if (result) setSessionCookie(res, result.token, result.expiresAt, secure);
      return json(res, 200, { ok: true, isAdmin: true });
    }

    // ── everything below requires a session ───────────────────────────────
    if (requireAuth && !ctx) return json(res, 401, { error: 'authentication required' });

    // GET /api/accounts — scoped to what this session may see (spec §30-31, §48).
    if (p === '/api/accounts' && method === 'GET') {
      const all = handlers.listAccounts(services);
      const visible = ctx?.isAdmin ? all : all.filter((a) => a.id === ctx?.accountScope);
      return json(res, 200, visible);
    }
    // POST /api/accounts — admin only (adding accounts, spec §47).
    if (p === '/api/accounts' && method === 'POST') {
      if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
      const body = await readJson(req);
      if (!body.displayName) return json(res, 400, { error: 'displayName required' });
      const created = await handlers.createAccount(services, {
        displayName: body.displayName,
        phoneNumber: body.phoneNumber,
      });
      // Optional per-profile password set at creation time (spec §45).
      if (body.password && String(body.password).length >= 6) {
        await sessionService.setAccountPassword(created.id, String(body.password));
      }
      return json(res, 200, created);
    }

    // ── account-scoped routes: enforce authorization (spec §48) ───────────
    if (seg[1] === 'accounts' && seg[2]) {
      const accountId = seg[2];
      if (!sessionService.canAccessAccount(ctx, accountId)) {
        return json(res, 403, { error: 'forbidden' });
      }
      if (seg[3] === 'connect' && method === 'POST') {
        if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
        await handlers.connectAccount(services, accountId);
        return json(res, 200, { ok: true });
      }
      if (seg[3] === 'disconnect' && method === 'POST') {
        if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
        await handlers.disconnectAccount(services, accountId);
        return json(res, 200, { ok: true });
      }
      // POST /api/accounts/:id/remove { mode: 'connection' | 'archive' } (spec §94)
      if (seg[3] === 'remove' && method === 'POST') {
        if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
        const body = await readJson(req);
        if (body.mode === 'archive') {
          await handlers.deleteArchive(services, accountId);
          sessionService.audit('archive_deleted', { accountId, ipAddress: ip });
        } else {
          await handlers.removeConnection(services, accountId);
          sessionService.audit('account_removed', { accountId, ipAddress: ip, detail: { kept: 'archive' } });
        }
        return json(res, 200, { ok: true });
      }
      // Set/change this profile's password — admin (management), not data access.
      if (seg[3] === 'password' && method === 'POST') {
        if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
        const body = await readJson(req);
        if (!body.password) return json(res, 400, { error: 'password required' });
        await sessionService.setAccountPassword(accountId, body.password);
        return json(res, 200, { ok: true });
      }

      // ── PRIVACY GATE (spec §45): everything below reads this profile's
      // actual data (chats, messages, media, search, export). It requires a
      // session scoped to THIS profile — the admin/master password does NOT
      // grant it. No one can read another profile's chats. ──────────────────
      if (ctx?.accountScope !== accountId) {
        return json(res, 403, {
          error: 'This profile is private. Log in with its own password to view its chats.',
        });
      }

      if (seg[3] === 'chats' && !seg[4] && method === 'GET') {
        const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
        return json(res, 200, handlers.listChats(services, accountId, { includeDeleted }));
      }
      if (seg[3] === 'chats' && seg[4] === 'deleted' && method === 'GET') {
        return json(res, 200, handlers.listDeletedChats(services, accountId));
      }
      if (seg[3] === 'chats' && seg[4] && seg[5] === 'messages' && method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? '200');
        const beforeRaw = url.searchParams.get('before');
        return json(
          res,
          200,
          handlers.listMessages(services, accountId, seg[4], {
            limit,
            before: beforeRaw ? Number(beforeRaw) : undefined,
          }),
        );
      }
      if (seg[3] === 'search' && method === 'GET') {
        return json(res, 200, handlers.searchAccount(services, accountId, url.searchParams.get('query') ?? ''));
      }
      if (seg[3] === 'media' && !seg[4] && method === 'GET') {
        return json(res, 200, handlers.listMedia(services, accountId, url.searchParams.get('type') ?? undefined));
      }
      if (seg[3] === 'media' && seg[4] && seg[5] === 'file' && method === 'GET') {
        const file = handlers.mediaFile(services, accountId, seg[4]);
        if (!file) return json(res, 404, { error: 'media not archived' });
        return streamFile(req, res, file.absolutePath, file.mimeType ?? 'application/octet-stream');
      }
      // GET /api/accounts/:id/chats/:chatId/export?format=txt|json|html|csv|zip (spec §64)
      if (seg[3] === 'chats' && seg[4] && seg[5] === 'export' && method === 'GET') {
        const format = url.searchParams.get('format') ?? 'txt';
        try {
          if (format === 'zip') {
            const zip = await handlers.exportChatZip(services, accountId, seg[4]);
            res.writeHead(200, {
              'content-type': 'application/zip',
              'content-disposition': `attachment; filename="${zip.filename}"`,
            });
            return void res.end(zip.buffer);
          }
          const out = handlers.exportChat(services, accountId, seg[4], format as ExportFormat);
          res.writeHead(200, {
            'content-type': out.mimeType,
            'content-disposition': `attachment; filename="${out.filename}"`,
          });
          return void res.end(out.content);
        } catch (e) {
          return json(res, 404, { error: String((e as Error).message) });
        }
      }
      return json(res, 404, { error: 'unknown account endpoint' });
    }

    // Search is private per profile: only a profile-scoped session searches its
    // own messages. Admin has no cross-account search (spec §45 privacy).
    if (p === '/api/search' && method === 'GET') {
      const query = url.searchParams.get('query') ?? '';
      if (ctx?.accountScope) return json(res, 200, handlers.searchAccount(services, ctx.accountScope, query));
      return json(res, 200, []);
    }

    // ── admin-only management ─────────────────────────────────────────────
    if (p === '/api/devices' && method === 'GET') {
      if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
      return json(res, 200, sessionService.listDevices());
    }
    if (seg[1] === 'devices' && seg[2] && seg[3] === 'revoke' && method === 'POST') {
      if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
      sessionService.revokeDevice(seg[2], ip);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/audit' && method === 'GET') {
      if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
      return json(res, 200, sessionService.listAudit(200));
    }
    // GET /api/lan/info — LAN URLs + pairing QR (admin, spec §43)
    if (p === '/api/lan/info' && method === 'GET') {
      if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
      const info = opts.lan
        ? await lanInfo(opts.lan.host, opts.lan.port, opts.lan.https)
        : { enabled: false, urls: [], qr: null };
      return json(res, 200, info);
    }

    // ── backup / restore (admin only, spec §61-63) ────────────────────────
    if (p === '/api/backup' && method === 'POST') {
      if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
      const body = (await readJson(req)) as unknown as { accountIds?: string[]; password?: string };
      if (!body.password) return json(res, 400, { error: 'password required' });
      const ids = body.accountIds?.length
        ? body.accountIds
        : services.repos.accounts.list().map((a) => a.id);
      const buf = handlers.createBackup(services, ids, body.password);
      sessionService.audit('backup_created', { ipAddress: ip, detail: { accounts: ids.length } });
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="WAArchiveBackup.wabackup"',
      });
      return void res.end(buf);
    }
    if (p === '/api/restore/inspect' && method === 'POST') {
      if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
      const body = (await readJson(req)) as unknown as { fileBase64?: string; password?: string };
      if (!body.fileBase64 || !body.password) return json(res, 400, { error: 'file and password required' });
      try {
        return json(res, 200, handlers.inspectBackup(services, Buffer.from(body.fileBase64, 'base64'), body.password));
      } catch (e) {
        return json(res, 400, { error: String((e as Error).message) });
      }
    }
    if (p === '/api/restore' && method === 'POST') {
      if (!ctx?.isAdmin) return json(res, 403, { error: 'admin only' });
      const body = (await readJson(req)) as unknown as {
        fileBase64?: string;
        password?: string;
        accountIds?: string[];
      };
      if (!body.fileBase64 || !body.password) return json(res, 400, { error: 'file and password required' });
      try {
        const result = await handlers.restoreBackup(
          services,
          Buffer.from(body.fileBase64, 'base64'),
          body.password,
          body.accountIds,
        );
        sessionService.audit('backup_restored', { ipAddress: ip, detail: { restored: result.restored.length } });
        return json(res, 200, result);
      } catch (e) {
        return json(res, 400, { error: String((e as Error).message) });
      }
    }

    json(res, 404, { error: 'unknown endpoint' });
  }

  return server;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
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

/** Stream an archived media file with HTTP Range support (spec §38). */
function streamFile(req: IncomingMessage, res: ServerResponse, absPath: string, mime: string): void {
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

/** Serve a static file, guarding against path traversal (spec §80); SPA fallback. */
function serveStatic(res: ServerResponse, root: string, urlPath: string): void {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, rel);
  if (!resolve(filePath).startsWith(resolve(root))) return void json(res, 403, { error: 'forbidden' });
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(root, 'index.html');
  if (!existsSync(filePath)) return void json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}
