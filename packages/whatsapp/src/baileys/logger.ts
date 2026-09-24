/**
 * Silent logger for Baileys. We deliberately drop everything: message contents,
 * keys and auth data must never be logged (spec §81). `enabled` logs only a
 * coarse level + static message for local connection debugging, never payloads.
 *
 * Structurally compatible with Baileys' `ILogger` (not re-exported at top level),
 * so it is accepted wherever a logger is expected.
 */
export interface SilentLogger {
  level: string;
  child(obj: Record<string, unknown>): SilentLogger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export function makeSilentLogger(enabled = false): SilentLogger {
  const noop = () => {};
  const log =
    (level: string) =>
    (obj: unknown, msg?: string): void => {
      if (!enabled) return;
      if (typeof obj === 'string') console.debug(`[baileys:${level}]`, obj);
      else if (msg) console.debug(`[baileys:${level}]`, msg);
    };
  const logger: SilentLogger = {
    level: enabled ? 'debug' : 'silent',
    child: () => logger,
    trace: log('trace'),
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: noop,
  };
  return logger;
}
