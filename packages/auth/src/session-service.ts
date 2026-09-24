import { AuthRepository, type Db, type Repositories } from '@wa-archive/database';
import { UserRole } from '@wa-archive/shared';
import { hashPassword, verifyPassword } from './passwords.js';
import { hashToken, newSessionToken } from './tokens.js';
import { LoginRateLimiter } from './rate-limit.js';

export interface SessionContext {
  sessionId: string;
  userId: string | null;
  deviceId: string | null;
  /** accountId this session may access, or null for admin (full access). */
  accountScope: string | null;
  isAdmin: boolean;
}

export interface DeviceInfo {
  ip: string | null;
  userAgent: string | null;
  label?: string;
  remember?: boolean;
}

export interface LoginResult {
  token: string;
  expiresAt: number;
  context: SessionContext;
}

const DAY = 86_400_000;

/**
 * Authentication + session policy for the LAN server (spec §45-52, §84).
 * Per-account passwords and an admin account are supported; sessions are opaque
 * tokens (only their hash is stored) delivered as HttpOnly cookies by the server.
 */
export class SessionService {
  private readonly auth: AuthRepository;
  private readonly limiter = new LoginRateLimiter();

  constructor(
    db: Db,
    private readonly repos: Repositories,
  ) {
    this.auth = new AuthRepository(db);
  }

  audit(
    event: string,
    detail: {
      accountId?: string | null;
      deviceId?: string | null;
      ipAddress?: string | null;
      detail?: Record<string, unknown> | null;
    } = {},
  ): void {
    this.auth.appendAudit({ event, ...detail });
  }

  hasAdmin(): boolean {
    return this.auth.countUsers() > 0;
  }

  /** Create the admin user on first run (spec §47). Idempotent-ish: only if none. */
  async ensureAdmin(username: string, password: string): Promise<void> {
    if (this.auth.countUsers() > 0) return;
    const passwordHash = await hashPassword(password);
    this.auth.createUser({ username, passwordHash, role: UserRole.ADMIN });
    this.auth.appendAudit({ event: 'account_added', detail: { admin: true, username } });
  }

  /** Set (or change) a per-account archive password (spec §45, §53). */
  async setAccountPassword(accountId: string, password: string): Promise<void> {
    const hash = await hashPassword(password);
    this.repos.accounts.setArchivePasswordHash(accountId, hash);
    this.auth.appendAudit({ event: 'account_password_changed', accountId });
  }

  async loginAdmin(username: string, password: string, dev: DeviceInfo): Promise<LoginResult | null> {
    const key = `admin:${dev.ip ?? 'unknown'}`;
    if (this.limiter.retryAfter(key) > 0) return null;
    const user = this.auth.getUserByUsername(username);
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok || user.role !== UserRole.ADMIN) {
      this.limiter.recordFailure(key);
      this.auth.appendAudit({ event: 'login_failed', ipAddress: dev.ip, detail: { admin: true } });
      return null;
    }
    this.limiter.reset(key);
    return this.startSession({ userId: user.id, accountScope: null, isAdmin: true }, dev, 'Admin');
  }

  async loginAccount(accountId: string, password: string, dev: DeviceInfo): Promise<LoginResult | null> {
    const key = `acct:${accountId}:${dev.ip ?? 'unknown'}`;
    if (this.limiter.retryAfter(key) > 0) return null;
    const account = this.repos.accounts.get(accountId);
    const ok = account?.archivePasswordHash
      ? await verifyPassword(password, account.archivePasswordHash)
      : false;
    if (!account || !ok) {
      this.limiter.recordFailure(key);
      this.auth.appendAudit({ event: 'login_failed', accountId, ipAddress: dev.ip });
      return null;
    }
    this.limiter.reset(key);
    return this.startSession(
      { userId: null, accountScope: accountId, isAdmin: false },
      dev,
      account.displayName,
    );
  }

  private async startSession(
    who: { userId: string | null; accountScope: string | null; isAdmin: boolean },
    dev: DeviceInfo,
    label: string,
  ): Promise<LoginResult> {
    const deviceId = this.auth.createDevice({
      label: dev.label ?? deviceLabel(dev.userAgent) ?? label,
      ipAddress: dev.ip,
      userAgent: dev.userAgent,
      accountScope: who.accountScope,
    });
    const token = newSessionToken();
    const expiresAt = Date.now() + (dev.remember ? 30 * DAY : DAY);
    const sessionId = this.auth.createSession({
      userId: who.userId,
      deviceId,
      tokenHash: hashToken(token),
      accountScope: who.accountScope,
      expiresAt,
    });
    this.auth.appendAudit({
      event: 'login_success',
      accountId: who.accountScope,
      deviceId,
      ipAddress: dev.ip,
    });
    this.auth.appendAudit({ event: 'device_added', deviceId, ipAddress: dev.ip });
    return {
      token,
      expiresAt,
      context: { sessionId, userId: who.userId, deviceId, accountScope: who.accountScope, isAdmin: who.isAdmin },
    };
  }

  /** Resolve a raw token to a live session context, or null (spec §49). */
  validate(token: string | undefined, ip: string | null): SessionContext | null {
    if (!token) return null;
    const session = this.auth.getValidSessionByTokenHash(hashToken(token));
    if (!session) return null;
    if (session.deviceId) {
      const device = this.auth.getDevice(session.deviceId);
      if (!device || device.revokedAt) return null; // device revoked → access lost (spec §52)
      this.auth.touchDevice(session.deviceId, ip);
    }
    const isAdmin = session.userId
      ? this.auth.getUserById(session.userId)?.role === UserRole.ADMIN
      : false;
    return {
      sessionId: session.id,
      userId: session.userId,
      deviceId: session.deviceId,
      accountScope: session.accountScope,
      isAdmin,
    };
  }

  logout(token: string | undefined): void {
    if (!token) return;
    const session = this.auth.getValidSessionByTokenHash(hashToken(token));
    if (session) this.auth.revokeSession(session.id);
  }

  /** Authorization gate (spec §48): admin sees all; an account session sees only its own. */
  canAccessAccount(ctx: SessionContext | null, accountId: string): boolean {
    if (!ctx) return false;
    if (ctx.isAdmin) return true;
    return ctx.accountScope === accountId;
  }

  listDevices() {
    return this.auth.listDevices();
  }
  revokeDevice(deviceId: string, byIp: string | null): void {
    this.auth.revokeDevice(deviceId);
    this.auth.appendAudit({ event: 'device_revoked', deviceId, ipAddress: byIp });
  }
  listAudit(limit?: number) {
    return this.auth.listAudit(limit);
  }
  retryAfterFor(scopeKey: string): number {
    return this.limiter.retryAfter(scopeKey);
  }
}

function deviceLabel(ua: string | null): string | undefined {
  if (!ua) return undefined;
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/android/i.test(ua)) return 'Android';
  if (/macintosh|mac os/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows PC';
  if (/linux/i.test(ua)) return 'Linux';
  return undefined;
}
