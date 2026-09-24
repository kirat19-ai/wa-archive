import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { AppServices, makeBaileysFactory, mockAdapterFactory } from '@wa-archive/app-core';
import { createArchiveServer } from './http-server.js';

/**
 * Development / LAN server entry (spec §41). Runs the full archive backend under
 * plain Node and serves the PWA. Binds to loopback by default; LAN exposure is
 * opt-in (spec §42) and configured via HOST.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const migrationsFolder = join(repoRoot, 'packages', 'database', 'drizzle');
const dataDir = process.env.WA_DATA_DIR ?? join(repoRoot, 'data');
const webRoot = join(repoRoot, 'apps', 'desktop', 'out', 'web');

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
// WA_REAL=1 uses Baileys (real linked-device); otherwise the mock adapter.
const REAL = process.env.WA_REAL === '1';

const factory = REAL ? makeBaileysFactory(join(dataDir, 'auth')) : mockAdapterFactory;
const services = new AppServices(factory);
services.init(join(dataDir, 'archive.sqlite'), migrationsFolder);

async function seed(): Promise<void> {
  const existing = services.repos.accounts.list();
  if (existing.length > 0) {
    for (const a of existing) await services.connectAccount(a.id);
    return;
  }
  if (REAL) {
    console.log('[wa-archive] real mode: add an account from the UI and scan the QR.');
    return; // never seed mock data in real mode
  }
  // Mock mode: seed demo accounts so the UI has data (spec §96).
  for (const name of ['Personal', 'Business', 'Factory']) {
    const acc = services.repos.accounts.create({ displayName: name });
    await services.connectAccount(acc.id);
    console.log(`[wa-archive] seeded account: ${name}`);
  }
}

async function main(): Promise<void> {
  await seed();
  const server = createArchiveServer({
    services,
    webRoot: existsSync(webRoot) ? webRoot : undefined,
  });
  server.listen(PORT, HOST, () => {
    console.log(`[wa-archive] server listening on http://${HOST}:${PORT}`);
    console.log(`[wa-archive] web UI: ${existsSync(webRoot) ? 'served from ' + webRoot : 'NOT BUILT (run build:web)'}`);
    console.log(`[wa-archive] data dir: ${dataDir}`);
  });
}

process.on('SIGINT', () => {
  services.shutdown();
  process.exit(0);
});

void main();
