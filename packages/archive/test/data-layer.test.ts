import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, createRepositories, openDatabase, type Db, type Repositories } from '@wa-archive/database';
import { MockWhatsAppAdapter } from '@wa-archive/whatsapp';
import { ArchiveEngine, EventBus } from '../src/index.js';

const MIGRATIONS = join(process.cwd(), 'packages/database/drizzle');

describe('WA Archive data layer (Phase 1)', () => {
  let dir: string;
  let dbFile: string;
  let db: Db;
  let repos: Repositories;
  let personalId: string;
  let businessId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wa-archive-test-'));
    dbFile = join(dir, 'archive.sqlite');
    db = openDatabase({ file: dbFile, migrationsFolder: MIGRATIONS });
    repos = createRepositories(db);
    const bus = new EventBus();

    const personal = repos.accounts.create({ displayName: 'Personal' });
    const business = repos.accounts.create({ displayName: 'Business' });
    personalId = personal.id;
    businessId = business.id;

    for (const acc of [personal, business]) {
      const adapter = new MockWhatsAppAdapter(acc.id, { chats: 20, messagesPerChat: 100 });
      const engine = new ArchiveEngine(acc.id, adapter, repos, bus);
      engine.start();
      await adapter.connect();
      await engine.importSnapshot();
    }
  });

  afterAll(() => {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('archives chats and messages for each account', () => {
    expect(repos.chats.list(personalId).length).toBe(20);
    expect(repos.messages.countByAccount(personalId)).toBe(2000);
    expect(repos.messages.countByAccount(businessId)).toBe(2000);
  });

  it('FTS search finds archived text scoped to one account', () => {
    const hits = repos.search.searchAccount(personalId, 'invoice');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.accountId === personalId)).toBe(true);
  });

  it('enforces account isolation — no cross-account contamination (spec §98)', () => {
    const both = repos.search.searchAccounts([personalId, businessId], 'invoice', 5000);
    const accounts = new Set(both.map((h) => h.accountId));
    expect(accounts.has(personalId)).toBe(true);
    expect(accounts.has(businessId)).toBe(true);
    // A single-account search must never leak the other account.
    const onlyBiz = repos.search.searchAccount(businessId, 'invoice');
    expect(onlyBiz.every((h) => h.accountId === businessId)).toBe(true);
  });

  it('preserves the archive when WhatsApp deletes a chat (spec §25)', () => {
    const chat = repos.chats.list(personalId)[0]!;
    const before = repos.chats.list(personalId).length;
    repos.chats.markWhatsappDeleted(personalId, chat.whatsappChatId);

    // Live list hides it; deleted list still has it; messages remain searchable.
    expect(repos.chats.list(personalId).length).toBe(before - 1);
    expect(repos.chats.listDeleted(personalId).some((c) => c.id === chat.id)).toBe(true);
    const msgs = repos.messages.list(personalId, chat.id, { limit: 5 });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('survives an application restart (spec §102)', () => {
    const before = repos.messages.countByAccount(personalId);
    closeDatabase(db);

    const db2 = openDatabase({ file: dbFile, migrationsFolder: MIGRATIONS });
    const repos2 = createRepositories(db2);
    expect(repos2.messages.countByAccount(personalId)).toBe(before);
    expect(repos2.accounts.list().length).toBe(2);
    // hand back so afterAll can close cleanly
    db = db2;
    repos = repos2;
  });
});
