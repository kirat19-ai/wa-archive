import type { IncomingMessage, ServerResponse } from 'node:http';

export const SESSION_COOKIE = 'wa_session';

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setSessionCookie(
  res: ServerResponse,
  token: string,
  expiresAt: number,
  secure: boolean,
): void {
  // HttpOnly + SameSite + optional Secure (spec §49): never readable by JS.
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function clientIp(req: IncomingMessage): string | null {
  // Local-first LAN server: trust the socket address, not forwarded headers.
  return req.socket.remoteAddress ?? null;
}

/**
 * Private/loopback ranges only (spec §56). Rejects public inbound connections
 * unless the operator explicitly opts into an advanced remote-access setup.
 */
export function isPrivateAddress(ip: string | null): boolean {
  if (!ip) return false;
  let a = ip;
  if (a.startsWith('::ffff:')) a = a.slice(7); // IPv4-mapped IPv6
  if (a === '::1' || a === '127.0.0.1' || a === 'localhost') return true;
  // IPv6 unique-local / link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a)) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  if (x === 10) return true;
  if (x === 172 && y >= 16 && y <= 31) return true;
  if (x === 192 && y === 168) return true;
  if (x === 169 && y === 254) return true; // link-local
  return false;
}
