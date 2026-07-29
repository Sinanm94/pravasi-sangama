import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

/**
 * A pre-computed hash of a value nobody knows. Compared against when a unit
 * or agent lookup misses, so a wrong unit code and a wrong PIN take the same
 * amount of time. Without this, response latency enumerates valid accounts.
 */
const DUMMY_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.jjR3fMV0/pV8vT1JjKfa6VOo4yQvYqu';

export function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifySecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Burn the same time as a real comparison, then fail. */
export async function verifyAgainstDummy(plain: string): Promise<false> {
  await bcrypt.compare(plain, DUMMY_HASH);
  return false;
}

/** SHA-256 of a signed token. `unit_sessions.token_hash` never stores the
 *  token itself, so a database leak does not hand over live sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const newId = randomUUID;
