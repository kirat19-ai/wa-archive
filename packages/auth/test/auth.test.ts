import { mkdtempSync, rmSync } from 'node:fs';
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
import { hashPassword, verifyPassword, SessionService } from '../src/index.js';

const MIGRATIONS = join(process.cwd(), 'packages/database/drizzle');
const dev = { ip: '192.168.1.50', userAgent: 'iPhone' };

describe('Auth & LAN security (Phase 5)', () => {
  let dir: string;
  let db: Db;
  let repos: Repositories;
  let sessions: SessionService;
  let personalId: string;
  let businessId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wa-auth-'));
    db = openDatabase({ file: join(dir, 'db.sqlite'), migrationsFolder: MIGRATIONS });
    repos = createRepositories(db);
    sessions = new SessionService(db, repos);
    personalId = repos.accounts.create({ displayName: 'Personal' }).id;
    businessId = repos.accounts.create({ displayName: 'Business' }).id;
    await sessions.ensureAdmin('admin', 'admin-pass');
    await sessions.setAccountPassword(personalId, 'personal-pass');
    await sessions.setAccountPassword(businessId, 'business-pass');
  });

  afterAll(() => {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('hashes with Argon2id and rejects wrong passwords (spec §46)', async () => {
    const hash = await hashPassword('s3cret');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword('s3cret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('grants access with the correct account password, denies wrong (spec §99)', async () => {
    expect(await sessions.loginAccount(personalId, 'wrong', dev)).toBeNull();
    const ok = await sessions.loginAccount(personalId, 'personal-pass', dev);
    expect(ok).not.toBeNull();
    const ctx = sessions.validate(ok!.token, dev.ip);
    expect(ctx?.accountScope).toBe(personalId);
    expect(ctx?.isAdmin).toBe(false);
  });

  it('enforces per-account isolation — 403 across accounts (spec §48, §99)', async () => {
    const login = await sessions.loginAccount(personalId, 'personal-pass', dev);
    const ctx = sessions.validate(login!.token, dev.ip);
    expect(sessions.canAccessAccount(ctx, personalId)).toBe(true);
    expect(sessions.canAccessAccount(ctx, businessId)).toBe(false); // Business archive → forbidden
  });

  it('admin can access every account', async () => {
    const login = await sessions.loginAdmin('admin', 'admin-pass', dev);
    const ctx = sessions.validate(login!.token, dev.ip);
    expect(ctx?.isAdmin).toBe(true);
    expect(sessions.canAccessAccount(ctx, personalId)).toBe(true);
    expect(sessions.canAccessAccount(ctx, businessId)).toBe(true);
  });

  it('revoking a device immediately kills its session (spec §52)', async () => {
    const login = await sessions.loginAccount(businessId, 'business-pass', dev);
    const ctx = sessions.validate(login!.token, dev.ip)!;
    expect(ctx.accountScope).toBe(businessId);
    sessions.revokeDevice(ctx.deviceId!, dev.ip);
    expect(sessions.validate(login!.token, dev.ip)).toBeNull(); // access lost at once
  });

  it('logout revokes the session', async () => {
    const login = await sessions.loginAccount(personalId, 'personal-pass', dev);
    expect(sessions.validate(login!.token, dev.ip)).not.toBeNull();
    sessions.logout(login!.token);
    expect(sessions.validate(login!.token, dev.ip)).toBeNull();
  });

  it('rate-limits repeated failures (spec §84)', async () => {
    const ip = { ip: '10.0.0.9', userAgent: 'x' };
    for (let i = 0; i < 6; i++) await sessions.loginAccount(personalId, 'nope', ip);
    // Now locked: even the correct password is refused until the lock expires.
    expect(await sessions.loginAccount(personalId, 'personal-pass', ip)).toBeNull();
  });
});
