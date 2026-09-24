/**
 * Brute-force protection for authentication (spec §84). Escalating lockout keyed
 * by client identifier (usually IP). In-memory: resets on process restart, which
 * is acceptable for a local-first LAN server. Thresholds are configurable.
 */
export interface RateLimitTier {
  attempts: number;
  lockMs: number;
}

const DEFAULT_TIERS: RateLimitTier[] = [
  { attempts: 5, lockMs: 10_000 },
  { attempts: 10, lockMs: 120_000 },
  { attempts: 15, lockMs: 900_000 },
];

interface Entry {
  fails: number;
  lockUntil: number;
}

export class LoginRateLimiter {
  private map = new Map<string, Entry>();

  constructor(private readonly tiers: RateLimitTier[] = DEFAULT_TIERS) {}

  /** ms remaining if locked, else 0. */
  retryAfter(key: string): number {
    const e = this.map.get(key);
    if (!e) return 0;
    return e.lockUntil > Date.now() ? e.lockUntil - Date.now() : 0;
  }

  recordFailure(key: string): void {
    const e = this.map.get(key) ?? { fails: 0, lockUntil: 0 };
    e.fails += 1;
    // Apply the highest tier whose threshold is met.
    for (const tier of [...this.tiers].reverse()) {
      if (e.fails >= tier.attempts) {
        e.lockUntil = Date.now() + tier.lockMs;
        break;
      }
    }
    this.map.set(key, e);
  }

  reset(key: string): void {
    this.map.delete(key);
  }
}
