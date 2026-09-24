import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  createRepositories,
  openDatabase,
  type Db,
  type Repositories,
} from '@wa-archive/database';
import { MediaType, type IWhatsAppAdapter, type NormalizedMediaRef } from '@wa-archive/shared';
import { LocalArchiveStorage, MediaManager } from '../src/index.js';

const MIGRATIONS = join(process.cwd(), 'packages/database/drizzle');

function fakeAdapter(bytesFor: (ref: NormalizedMediaRef) => Buffer | Error): IWhatsAppAdapter {
  return {
    accountId: 'acc',
    async downloadMedia(ref: NormalizedMediaRef) {
      const r = bytesFor(ref);
      if (r instanceof Error) throw r;
      return { data: r, mimeType: ref.mimeType };
    },
  } as unknown as IWhatsAppAdapter;
}

async function drain(mgr: MediaManager): Promise<void> {
  const start = Date.now();
  while (mgr.pending > 0 && Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

function ref(name: string): NormalizedMediaRef {
  return {
    mediaType: MediaType.IMAGE,
    mimeType: 'image/jpeg',
    originalFilename: name,
    fileSize: null,
    width: null,
    height: null,
    duration: null,
    downloadToken: { name },
  };
}

describe('Media pipeline (Phase 3)', () => {
  let dir: string;
  let db: Db;
  let repos: Repositories;
  let storage: LocalArchiveStorage;
  let accountId: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'wa-media-'));
    db = openDatabase({ file: join(dir, 'db.sqlite'), migrationsFolder: MIGRATIONS });
    repos = createRepositories(db);
    storage = new LocalArchiveStorage(join(dir, 'archive'));
    accountId = repos.accounts.create({ displayName: 'Acc' }).id;
  });

  afterAll(() => {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  function seedMessageWithMedia(): { messageRowId: string; mediaId: string } {
    const chatRowId = repos.chats.upsert(accountId, {
      whatsappChatId: 'c@s.whatsapp.net',
      chatType: 'INDIVIDUAL',
      name: 'C',
      phoneNumber: null,
      profilePhotoUrl: null,
      muted: false,
      pinned: false,
      archived: false,
      lastMessageAt: Date.now(),
      lastMessagePreview: null,
    });
    const messageRowId = repos.messages.insert(accountId, chatRowId, {
      whatsappMessageId: `m${Math.random()}`,
      chatId: 'c@s.whatsapp.net',
      senderId: null,
      participantId: null,
      timestamp: Date.now(),
      direction: 'INCOMING',
      messageType: 'IMAGE',
      text: null,
      caption: null,
      quotedMessageId: null,
      forwarded: false,
      media: null,
      rawMetadata: null,
    })!;
    const mediaId = repos.media.create(accountId, {
      messageId: messageRowId,
      mediaType: MediaType.IMAGE,
      mimeType: 'image/jpeg',
      originalFilename: 'x.jpg',
      width: null,
      height: null,
      duration: null,
      fileSize: null,
    });
    return { messageRowId, mediaId };
  }

  it('downloads, hashes, stores and marks a media file archived (spec §23)', async () => {
    const mgr = new MediaManager(repos, storage, { concurrency: 2 });
    const { mediaId } = seedMessageWithMedia();
    const adapter = fakeAdapter(() => Buffer.from('JPEG-BYTES-A'));
    mgr.enqueue({ accountId, mediaId, ref: ref('a.jpg'), adapter });
    await drain(mgr);

    const row = repos.media.get(accountId, mediaId)!;
    expect(row.downloadStatus).toBe('ARCHIVED');
    expect(row.sha256).toBeTruthy();
    expect(row.storagePath).toContain(`accounts/${accountId}/media/images/`);
    expect(readFileSync(storage.absolutePath(row.storagePath!)).toString()).toBe('JPEG-BYTES-A');
  });

  it('de-duplicates identical bytes to one physical file (spec §22)', async () => {
    const mgr = new MediaManager(repos, storage);
    const a = seedMessageWithMedia();
    const b = seedMessageWithMedia();
    const same = () => Buffer.from('IDENTICAL-BYTES');
    mgr.enqueue({ accountId, mediaId: a.mediaId, ref: ref('a.jpg'), adapter: fakeAdapter(same) });
    await drain(mgr);
    mgr.enqueue({ accountId, mediaId: b.mediaId, ref: ref('b.jpg'), adapter: fakeAdapter(same) });
    await drain(mgr);

    const ra = repos.media.get(accountId, a.mediaId)!;
    const rb = repos.media.get(accountId, b.mediaId)!;
    expect(ra.sha256).toBe(rb.sha256);
    expect(rb.storagePath).toBe(ra.storagePath); // second reuses the first physical file
  });

  it('marks FAILED after retries are exhausted, never falsely archived (spec §24)', async () => {
    const mgr = new MediaManager(repos, storage, { backoffMs: [] }); // no retries
    const { mediaId } = seedMessageWithMedia();
    mgr.enqueue({
      accountId,
      mediaId,
      ref: ref('bad.jpg'),
      adapter: fakeAdapter(() => new Error('network down')),
    });
    await drain(mgr);

    const row = repos.media.get(accountId, mediaId)!;
    expect(row.downloadStatus).toBe('FAILED');
    expect(row.storagePath).toBeNull();
  });
});
