import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Authenticated, password-based encryption for backups (spec §62).
 *
 * Container: [magic 'WAB01'][salt 16][iv 12][authTag 16][ciphertext].
 * Key = scrypt(password, salt). Cipher = AES-256-GCM (the GCM auth tag is the
 * integrity check verified before restore). Payload is gzip-compressed first.
 */
const MAGIC = Buffer.from('WAB01', 'utf8');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

export function encryptBackup(plain: Buffer, password: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(password, salt, KEY_LEN, { N: 16384, r: 8, p: 1 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const compressed = gzipSync(plain);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
}

export class BackupIntegrityError extends Error {}

export function decryptBackup(file: Buffer, password: string): Buffer {
  if (file.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN) {
    throw new BackupIntegrityError('backup file too small / corrupt');
  }
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupIntegrityError('not a WA Archive backup file');
  }
  let off = MAGIC.length;
  const salt = file.subarray(off, (off += SALT_LEN));
  const iv = file.subarray(off, (off += IV_LEN));
  const tag = file.subarray(off, (off += TAG_LEN));
  const ciphertext = file.subarray(off);
  const key = scryptSync(password, salt, KEY_LEN, { N: 16384, r: 8, p: 1 });
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return gunzipSync(compressed);
  } catch {
    // final() throws if the auth tag fails: wrong password or tampered file.
    throw new BackupIntegrityError('wrong password or corrupt backup');
  }
}
