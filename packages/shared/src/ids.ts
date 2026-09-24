import { randomUUID } from 'node:crypto';

/**
 * Immutable local identifiers (spec §7): account_id and other primary keys are
 * app-generated UUIDs, never derived from a phone number or a WhatsApp id
 * (those can change or collide across accounts).
 */
export function newId(): string {
  return randomUUID();
}
