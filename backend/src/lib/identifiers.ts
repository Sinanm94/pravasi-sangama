import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  ID_CHARSET,
  REQUEST_NUMBER_LENGTH,
  REQUEST_NUMBER_PREFIX,
  TICKET_NUMBER_LENGTH,
  TICKET_NUMBER_PREFIX,
} from '@pravasi/shared';

/**
 * One crypto.randomInt(0, 32) draw per character — ID_CHARSET is exactly 32
 * characters (5 bits), so this is unbiased with no modulo/rejection-sampling
 * needed, unlike pulling bytes and reducing mod an alphabet size that
 * doesn't evenly divide 256.
 */
function randomId(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ID_CHARSET[randomInt(0, ID_CHARSET.length)];
  }
  return out;
}

/**
 * REQ-2026-K4H8QR
 *
 * 6 chars * 5 bits = 2^30 of space (~1.07 billion). At 100,000 tickets — well
 * above what this event will plausibly sell — the chance any single insert
 * collides with an existing row is ~0.01%, and a collision is not a failure:
 * tickets.service's NUMBER_COLLISION_RETRIES loop regenerates and retries
 * the whole transaction silently. See constants.ts for why this is shorter
 * than the previous 12-hex-character format.
 */
export function generateRequestNumber(): string {
  return `${REQUEST_NUMBER_PREFIX}${randomId(REQUEST_NUMBER_LENGTH)}`;
}

/**
 * TKT-Q7X4M2
 *
 * Same alphabet, length, and collision math as generateRequestNumber() above.
 * The two previously carried different bit budgets (12 vs 10 hex chars) for
 * no reason tied to how they're actually used — every registration produces
 * exactly one of each (CLAUDE.md §4.4), so their collision domains grow at
 * the same rate. Nothing here justifies them differing.
 */
export function generateTicketNumber(): string {
  return `${TICKET_NUMBER_PREFIX}${randomId(TICKET_NUMBER_LENGTH)}`;
}

/**
 * The value encoded into the printed QR. Returned to the client exactly once,
 * at issuance — the database only ever holds its hash.
 */
export function generateQrPayload(): string {
  return randomUUID();
}

/**
 * Gate lookup key. The scanner hashes the payload it read and matches on
 * `qr_codes.qr_hash`, so a database leak yields no usable tickets.
 *
 * Plain SHA-256, not bcrypt: this is a 122-bit random value, not a password.
 * There is no dictionary to attack, and the gate needs a single indexed
 * lookup rather than a per-row comparison.
 */
export function hashQrPayload(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}
