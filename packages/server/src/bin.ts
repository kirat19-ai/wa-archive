import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { AppServices, mockAdapterFactory } from '@wa-archive/app-core';
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

const services = new AppServices(mockAdapterFactory);
services.init(join(dataDir, 'archive.sqlite'), migrationsFolder);

// Seed default accounts on first run so the demo has data (spec §96).
async function seed(): Promise<void> {
  if (services.repos.accounts.list().length > 0) {
    // Reconnect existing accounts for live updates.
    for (const a of services.repos.accounts.list()) await services.connectAccount(a.id);
    return;
  }
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
