import {
  closeDatabase,
  createRepositories,
  openDatabase,
  type Db,
  type Repositories,
} from '@wa-archive/database';
import { join } from 'node:path';
import { ArchiveEngine, EventBus, type MediaSink } from '@wa-archive/archive';
import { LocalArchiveStorage, MediaManager, type ArchiveStorage } from '@wa-archive/media';
import { BaileysWhatsAppAdapter, MockWhatsAppAdapter } from '@wa-archive/whatsapp';
import type { AppEventName, IWhatsAppAdapter } from '@wa-archive/shared';

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
  storage!: ArchiveStorage;
  media!: MediaManager;
  readonly bus = new EventBus();
  private runtimes = new Map<string, AccountRuntime>();

  constructor(private readonly adapterFactory: (accountId: string) => IWhatsAppAdapter) {}

  /**
   * @param storageRoot base folder for archived media (spec §21). Defaults to a
   *   sibling of the DB file when omitted.
   */
  init(dbFile: string, migrationsFolder: string, storageRoot?: string): void {
    this.db = openDatabase({ file: dbFile, migrationsFolder });
    this.repos = createRepositories(this.db);
    this.storage = new LocalArchiveStorage(storageRoot ?? join(dbFile, '..', 'archive'));
    this.media = new MediaManager(this.repos, this.storage, {
      emit: (event, payload) => this.bus.emit(event as AppEventName, payload),
    });
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
    // Media sink: create the DB row, then enqueue the download (spec §23).
    const mediaSink: MediaSink = ({ accountId: acc, messageRowId, ref, adapter: ad }) => {
      const mediaId = this.repos.media.create(acc, {
        messageId: messageRowId,
        mediaType: ref.mediaType,
        mimeType: ref.mimeType,
        originalFilename: ref.originalFilename,
        width: ref.width,
        height: ref.height,
        duration: ref.duration,
        fileSize: ref.fileSize,
      });
      this.media.enqueue({ accountId: acc, mediaId, ref, adapter: ad });
    };
    const engine = new ArchiveEngine(accountId, adapter, this.repos, this.bus, mediaSink);
    engine.start();
    this.runtimes.set(accountId, { adapter, engine });

    // Decide BEFORE connecting: the CONNECTED event sets archive_started_at, so
    // we key the initial import off an empty archive instead (idempotent anyway).
    const needsImport = this.repos.messages.countByAccount(accountId) === 0;
    await adapter.connect();

    // Bulk import only for adapters that hand over history synchronously (mock).
    // Baileys streams history via 'messaging-history.set' events instead (§71).
    const canBulk =
      typeof (adapter as Partial<{ getAllMessages: unknown }>).getAllMessages === 'function';
    if (needsImport && canBulk) {
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

/** Mock factory (Phase 1 dev / tests): synthetic data + periodic live messages. */
export function mockAdapterFactory(accountId: string): IWhatsAppAdapter {
  return new MockWhatsAppAdapter(accountId, {
    chats: 30,
    messagesPerChat: 150,
    liveMessageIntervalMs: 8000,
  });
}

/**
 * Real factory (Phase 2): one BaileysWhatsAppAdapter per account, each with an
 * isolated auth folder under <authBaseDir>/account_<id>/ (spec §8). Auth state is
 * NEVER shared between accounts.
 */
export function makeBaileysFactory(authBaseDir: string): (accountId: string) => IWhatsAppAdapter {
  return (accountId: string) =>
    new BaileysWhatsAppAdapter(accountId, {
      authDir: join(authBaseDir, `account_${accountId}`),
      syncFullHistory: true,
    });
}
