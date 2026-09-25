import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
import { LocalArchiveStorage } from '@wa-archive/media';
import { MediaType, MessageDirection, MessageType, ChatType } from '@wa-archive/shared';
import { BackupIntegrityError, createBackup, inspectBackup, restoreBackup } from '../src/index.js';

const MIGRATIONS = join(process.cwd(), 'packages/database/drizzle');

function seed(repos: Repositories, storage: LocalArchiveStorage, accountId: string) {
  const chatRowId = repos.chats.upsert(accountId, {
    whatsappChatId: 'c@s.whatsapp.net',
    chatType: ChatType.INDIVIDUAL,
    name: 'Rahul',
    phoneNumber: '+91',
    profilePhotoUrl: null,
    muted: false,
    pinned: false,
    archived: false,
    lastMessageAt: Date.now(),
    lastMessagePreview: null,
  });
  for (let i = 0; i < 5; i++) {
    repos.messages.insert(accountId, chatRowId, {
      whatsappMessageId: `m${i}`,
      chatId: 'c@s.whatsapp.net',
      senderId: 'c@s.whatsapp.net',
      participantId: null,
      timestamp: Date.now() + i,
      direction: MessageDirection.INCOMING,
      messageType: MessageType.TEXT,
      text: `invoice number ${i}`,
      caption: null,
      quotedMessageId: null,
      forwarded: false,
      media: null,
      rawMetadata: null,
    });
  }
  return chatRowId;
}

describe('Backup round-trip (Phase 6)', () => {
  let dir: string;
  let db1: Db;
  let repos1: Repositories;
  let storage1: LocalArchiveStorage;
  let accountId: string;
  let backup: Buffer;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wa-backup-'));
    db1 = openDatabase({ file: join(dir, 'a.sqlite'), migrationsFolder: MIGRATIONS });
    repos1 = createRepositories(db1);
    storage1 = new LocalArchiveStorage(join(dir, 'archive1'));
    accountId = repos1.accounts.create({ displayName: 'Personal' }).id;
    const chatRowId = seed(repos1, storage1, accountId);

    // A media row with a real stored file, to prove media survives backup.
    const rel = await storage1.save(accountId, MediaType.IMAGE, 'img1', 'svg', Buffer.from('<svg/>'));
    const mid = repos1.media.create(accountId, {
      messageId: repos1.messages.list(accountId, chatRowId, { limit: 1 })[0]!.id,
      mediaType: MediaType.IMAGE,
      mimeType: 'image/svg+xml',
      originalFilename: 'a.svg',
      width: null,
      height: null,
      duration: null,
      fileSize: 6,
    });
    repos1.media.markArchived(mid, { storagePath: rel, sha256: 'abc', fileSize: 6, thumbnailPath: null });

    backup = createBackup(db1, storage1, [accountId], 'backup-pass');
  });

  afterAll(() => {
    closeDatabase(db1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('inspects a backup without applying it (spec §63)', () => {
    const summary = inspectBackup(backup, 'backup-pass');
    expect(summary.accounts).toHaveLength(1);
    expect(summary.accounts[0]!.displayName).toBe('Personal');
    expect(summary.accounts[0]!.messages).toBe(5);
  });

  it('rejects a wrong password / tampered file (spec §62 integrity)', () => {
    expect(() => inspectBackup(backup, 'wrong')).toThrow(BackupIntegrityError);
    const tampered = Buffer.from(backup);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => inspectBackup(tampered, 'backup-pass')).toThrow(BackupIntegrityError);
  });

  it('restores account, messages, media and search into a fresh archive (spec §63)', async () => {
    const db2 = openDatabase({ file: join(dir, 'b.sqlite'), migrationsFolder: MIGRATIONS });
    const repos2 = createRepositories(db2);
    const storage2 = new LocalArchiveStorage(join(dir, 'archive2'));

    const { restored } = await restoreBackup(db2, storage2, backup, 'backup-pass');
    expect(restored).toEqual([accountId]);

    expect(repos2.accounts.get(accountId)?.displayName).toBe('Personal');
    expect(repos2.messages.countByAccount(accountId)).toBe(5);
    expect(repos2.media.countByAccount(accountId)).toBe(1);

    // Media file physically restored on disk.
    const mediaRow = repos2.media.listByAccount(accountId)[0]!;
    expect(existsSync(storage2.absolutePath(mediaRow.storagePath!))).toBe(true);
    expect((await storage2.read(mediaRow.storagePath!)).toString()).toBe('<svg/>');

    // FTS index rebuilt via triggers on restore insert.
    expect(repos2.search.searchAccount(accountId, 'invoice').length).toBe(5);

    closeDatabase(db2);
  });
});
