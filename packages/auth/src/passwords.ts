import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * Password hashing with Argon2id (spec §46), via hash-wasm — a pure-WASM
 * implementation, so there is no native build step. Hashes are self-describing
 * (PHC "encoded" string embedding salt + params), so verification needs no
 * separate salt column. Passwords are never logged (spec §81).
 */
const PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 19_456, // ~19 MiB (OWASP Argon2id guidance)
  hashLength: 32,
  outputType: 'encoded' as const,
};

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return argon2id({ password, salt, ...PARAMS });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}
