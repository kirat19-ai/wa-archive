import {
  closeDatabase,
  createRepositories,
  openDatabase,
  type Db,
  type Repositories,
} from '@wa-archive/database';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { ArchiveEngine, EventBus, type MediaSink } from '@wa-archive/archive';
import { LocalArchiveStorage, MediaManager, type ArchiveStorage } from '@wa-archive/media';
import { MockWhatsAppAdapter } from '@wa-archive/whatsapp';
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

  constructor(
    private readonly adapterFactory: (
      accountId: string,
    ) => IWhatsAppAdapter | Promise<IWhatsAppAdapter>,
  ) {}

  /**
   * @param storageRoot base folder for archived media (spec §21). Defaults to a
   *   sibling of the DB file when omitted.
   */
  private authBaseDir: string | null = null;

  init(dbFile: string, migrationsFolder: string, storageRoot?: string, authBaseDir?: string): void {
    this.db = openDatabase({ file: dbFile, migrationsFolder });
    this.repos = createRepositories(this.db);
    this.storage = new LocalArchiveStorage(storageRoot ?? join(dbFile, '..', 'archive'));
    this.authBaseDir = authBaseDir ?? null;
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
    const adapter = await this.adapterFactory(accountId);
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

  /**
   * Remove the WhatsApp *connection* but KEEP the archive (spec §94). Stops the
   * socket and unlinks the device (deletes the account's auth folder), so it
   * would need re-linking, while every archived message/media stays intact.
   */
  async removeConnection(accountId: string): Promise<void> {
    await this.disconnectAccount(accountId);
    if (this.authBaseDir) {
      await rm(join(this.authBaseDir, `account_${accountId}`), { recursive: true, force: true });
    }
    this.repos.accounts.updateStatus(accountId, 'LOGGED_OUT');
  }

  /**
   * Permanently DELETE the archived account data (spec §94, §27): removes media
   * files from disk, then the account row (FK cascade drops all its rows). This
   * is irreversible — callers must require strong confirmation.
   */
  async deleteArchive(accountId: string): Promise<void> {
    await this.removeConnection(accountId);
    // Delete physical media files (distinct paths only).
    const paths = new Set<string>();
    for (const m of this.repos.media.listByAccount(accountId)) {
      if (m.storagePath) paths.add(m.storagePath);
      if (m.thumbnailPath) paths.add(m.thumbnailPath);
    }
    for (const rel of paths) await this.storage.remove(rel);
    this.repos.accounts.delete(accountId); // cascade removes chats/messages/media/...
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
 *
 * Baileys is loaded with a DYNAMIC import so its (heavy, occasionally
 * native-linked) dependency graph only loads when an account actually connects —
 * never at app startup. A failure to load surfaces on "Add Account", not as a
 * silent crash before the window is ever shown.
 */
export function makeBaileysFactory(
  authBaseDir: string,
): (accountId: string) => Promise<IWhatsAppAdapter> {
  return async (accountId: string) => {
    // Force `ws` to its pure-JS masking/validation before it is required — the
    // native bufferutil/utf-8-validate addons break when bundled+packaged
    // ("bufferUtil.mask is not a function"). Set here so it holds for every
    // entry point (Electron app and LAN server alike).
    process.env.WS_NO_BUFFER_UTIL = '1';
    process.env.WS_NO_UTF_8_VALIDATE = '1';
    const { BaileysWhatsAppAdapter } = await import('@wa-archive/whatsapp/baileys');
    return new BaileysWhatsAppAdapter(accountId, {
      authDir: join(authBaseDir, `account_${accountId}`),
      syncFullHistory: true,
    });
  };
}
