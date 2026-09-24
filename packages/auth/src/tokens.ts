import { createHash, randomBytes } from 'node:crypto';

/** Opaque session token; only its SHA-256 is stored (spec §49, §81). */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Short-lived pairing token for the LAN QR (spec §43). */
export function newPairingToken(): string {
  return randomBytes(18).toString('base64url');
}
