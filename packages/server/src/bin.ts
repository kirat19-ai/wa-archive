import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { AppServices, makeBaileysFactory, mockAdapterFactory } from '@wa-archive/app-core';
import { SessionService } from '@wa-archive/auth';
import { createArchiveServer } from './http-server.js';

/**
 * Development / LAN server entry (spec §41). Runs the full archive backend under
 * plain Node and serves the PWA with per-account auth.
 *
 * Binding:
 *   HOST=127.0.0.1 (default) → loopback only, LAN OFF (spec §42)
 *   HOST=0.0.0.0            → LAN ON (reachable from phones on the same Wi-Fi)
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const migrationsFolder = join(repoRoot, 'packages', 'database', 'drizzle');
const dataDir = process.env.WA_DATA_DIR ?? join(repoRoot, 'data');
const webRoot = join(repoRoot, 'apps', 'desktop', 'out', 'web');

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const REAL = process.env.WA_REAL === '1';

const factory = REAL ? makeBaileysFactory(join(dataDir, 'auth')) : mockAdapterFactory;
const services = new AppServices(factory);
services.init(join(dataDir, 'archive.sqlite'), migrationsFolder, join(dataDir, 'archive'));
const sessions = new SessionService(services.db, services.repos);

function genPassword(): string {
  return randomBytes(9).toString('base64url');
}

async function bootstrapSecurity(): Promise<void> {
  // Admin account (spec §47) on first run.
  if (!sessions.hasAdmin()) {
    const adminPw = process.env.WA_ADMIN_PASSWORD ?? genPassword();
    await sessions.ensureAdmin('admin', adminPw);
    console.log(`[wa-archive] ADMIN created — username: admin  password: ${adminPw}`);
    if (!process.env.WA_ADMIN_PASSWORD) console.log('[wa-archive] (set WA_ADMIN_PASSWORD to pin it)');
  }
}

async function seed(): Promise<void> {
  const existing = services.repos.accounts.list();
  if (existing.length > 0) {
    for (const a of existing) await services.connectAccount(a.id);
    return;
  }
  if (REAL) {
    console.log('[wa-archive] real mode: sign in as admin, add an account, scan the QR.');
    return;
  }
  // Mock mode: seed demo accounts each with its own password (spec §45).
  for (const name of ['Personal', 'Business', 'Factory']) {
    const acc = services.repos.accounts.create({ displayName: name });
    const pw = process.env.WA_DEMO_PASSWORD ?? `${name.toLowerCase()}123`;
    await sessions.setAccountPassword(acc.id, pw);
    await services.connectAccount(acc.id);
    console.log(`[wa-archive] seeded account "${name}"  password: ${pw}`);
  }
}

async function main(): Promise<void> {
  await bootstrapSecurity();
  await seed();
  const lanOn = HOST === '0.0.0.0' || (!HOST.startsWith('127.') && HOST !== 'localhost');
  sessions.audit(lanOn ? 'LAN_enabled' : 'LAN_disabled', { detail: { host: HOST, port: PORT } });

  const server = createArchiveServer({
    services,
    sessionService: sessions,
    webRoot: existsSync(webRoot) ? webRoot : undefined,
    requireAuth: process.env.WA_AUTH === '0' ? false : true,
    secureCookies: process.env.WA_HTTPS === '1',
  });
  server.listen(PORT, HOST, () => {
    console.log(`[wa-archive] listening on http://${HOST}:${PORT}  (LAN ${lanOn ? 'ON' : 'OFF — loopback only'})`);
    console.log(`[wa-archive] web UI: ${existsSync(webRoot) ? 'served' : 'NOT BUILT (run build:web)'}`);
  });
}

process.on('SIGINT', () => {
  services.shutdown();
  process.exit(0);
});

void main();
