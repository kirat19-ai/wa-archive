import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { newId } from '@wa-archive/shared';
import type { Db } from './client.js';
import { auditLogs, devices, sessions, users } from './schema.js';

/**
 * Low-level persistence for authentication (spec §14, §49-52, §82). Policy
 * (hashing, tokens, rate limiting) lives in @wa-archive/auth; this only does SQL.
 */
export class AuthRepository {
  constructor(private readonly db: Db) {}

  // ── users ────────────────────────────────────────────────────────────────
  countUsers(): number {
    const r = this.db.select({ n: sql<number>`count(*)` }).from(users).get();
    return r?.n ?? 0;
  }
  createUser(input: { username: string; passwordHash: string; role: string }): string {
    const id = newId();
    this.db.insert(users).values({ id, ...input }).run();
    return id;
  }
  getUserByUsername(username: string) {
    return this.db.select().from(users).where(eq(users.username, username)).get();
  }
  getUserById(userId: string) {
    return this.db.select().from(users).where(eq(users.id, userId)).get();
  }
  setUserPassword(userId: string, passwordHash: string) {
    this.db.update(users).set({ passwordHash, updatedAt: Date.now() }).where(eq(users.id, userId)).run();
  }

  // ── devices ────────────────────────────────────────────────────────────────
  createDevice(input: { label: string; ipAddress: string | null; userAgent: string | null; accountScope: string | null }): string {
    const id = newId();
    this.db
      .insert(devices)
      .values({ id, ...input, lastSeenAt: Date.now() })
      .run();
    return id;
  }
  touchDevice(deviceId: string, ip: string | null) {
    this.db.update(devices).set({ lastSeenAt: Date.now(), ipAddress: ip }).where(eq(devices.id, deviceId)).run();
  }
  listDevices() {
    return this.db.select().from(devices).orderBy(desc(devices.lastSeenAt)).all();
  }
  getDevice(deviceId: string) {
    return this.db.select().from(devices).where(eq(devices.id, deviceId)).get();
  }
  revokeDevice(deviceId: string) {
    this.db.update(devices).set({ revokedAt: Date.now() }).where(eq(devices.id, deviceId)).run();
    // Revoke all its sessions immediately (spec §52).
    this.db.update(sessions).set({ revokedAt: Date.now() }).where(eq(sessions.deviceId, deviceId)).run();
  }

  // ── sessions ────────────────────────────────────────────────────────────────
  createSession(input: {
    userId: string | null;
    deviceId: string | null;
    tokenHash: string;
    accountScope: string | null;
    expiresAt: number;
  }): string {
    const id = newId();
    this.db.insert(sessions).values({ id, ...input }).run();
    return id;
  }
  getValidSessionByTokenHash(tokenHash: string) {
    return this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, Date.now()),
        ),
      )
      .get();
  }
  revokeSession(sessionId: string) {
    this.db.update(sessions).set({ revokedAt: Date.now() }).where(eq(sessions.id, sessionId)).run();
  }
  listActiveSessions() {
    return this.db
      .select()
      .from(sessions)
      .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, Date.now())))
      .all();
  }

  // ── audit (never stores message contents, spec §82) ───────────────────────
  appendAudit(input: {
    event: string;
    accountId?: string | null;
    deviceId?: string | null;
    ipAddress?: string | null;
    detail?: Record<string, unknown> | null;
  }) {
    this.db
      .insert(auditLogs)
      .values({
        id: newId(),
        event: input.event,
        accountId: input.accountId ?? null,
        deviceId: input.deviceId ?? null,
        ipAddress: input.ipAddress ?? null,
        detailJson: input.detail ? JSON.stringify(input.detail) : null,
      })
      .run();
  }
  listAudit(limit = 200) {
    return this.db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit).all();
  }
}
