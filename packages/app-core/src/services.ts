import {
  closeDatabase,
  createRepositories,
  openDatabase,
  type Db,
  type Repositories,
} from '@wa-archive/database';
import { ArchiveEngine, EventBus } from '@wa-archive/archive';
import { MockWhatsAppAdapter } from '@wa-archive/whatsapp';
import type { IWhatsAppAdapter } from '@wa-archive/shared';

interface AccountRuntime {
  adapter: IWhatsAppAdapter;
  engine: ArchiveEngine;
}

/**
 * AccountConnectionManager (spec §9): one independent adapter + archive engine
 * per WhatsApp account. No global socket — accounts connect, disconnect, and
 * sync independently (spec §72). Shared by the desktop shell and the LAN server.
 *
 * Phase 1 uses MockWhatsAppAdapter; Phase 2 swaps in BaileysWhatsAppAdapter
 * behind the same IWhatsAppAdapter seam.
 */
export class AppServices {
  db!: Db;
  repos!: Repositories;
  readonly bus = new EventBus();
  private runtimes = new Map<string, AccountRuntime>();

  constructor(private readonly adapterFactory: (accountId: string) => IWhatsAppAdapter) {}

  init(dbFile: string, migrationsFolder: string): void {
    this.db = openDatabase({ file: dbFile, migrationsFolder });
    this.repos = createRepositories(this.db);
  }

  shutdown(): void {
    for (const rt of this.runtimes.values()) rt.engine.stop();
    if (this.db) closeDatabase(this.db);
  }

  isConnected(accountId: string): boolean {
    return this.runtimes.has(accountId);
  }

  async connectAccount(accountId: string): Promise<void> {
    if (this.runtimes.has(accountId)) return;
    const adapter = this.adapterFactory(accountId);
    const engine = new ArchiveEngine(accountId, adapter, this.repos, this.bus);
    engine.start();
    this.runtimes.set(accountId, { adapter, engine });

    // Decide BEFORE connecting: the CONNECTED event sets archive_started_at, so
    // we key the initial import off an empty archive instead (idempotent anyway).
    const needsImport = this.repos.messages.countByAccount(accountId) === 0;
    await adapter.connect();
    if (needsImport) {
      await engine.importSnapshot();
    }
  }

  async disconnectAccount(accountId: string): Promise<void> {
    const rt = this.runtimes.get(accountId);
    if (!rt) return;
    rt.engine.stop();
    await rt.adapter.disconnect();
    this.runtimes.delete(accountId);
    // Archive remains fully intact; only the live connection stops (spec §93).
    this.repos.accounts.updateStatus(accountId, 'DISCONNECTED');
  }
}

/** Default factory used in Phase 1 (mock data, periodic live messages). */
export function mockAdapterFactory(accountId: string): IWhatsAppAdapter {
  return new MockWhatsAppAdapter(accountId, {
    chats: 30,
    messagesPerChat: 150,
    liveMessageIntervalMs: 8000,
  });
}
