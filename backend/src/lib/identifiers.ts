import { createHash, randomUUID } from 'node:crypto';
import {
  REQUEST_NUMBER_LENGTH,
  REQUEST_NUMBER_PREFIX,
  TICKET_NUMBER_LENGTH,
  TICKET_NUMBER_PREFIX,
} from '@pravasi/shared';
import { randomDigits } from './passwordGen.js';

/**
 * REQ-403827 — six digits, no letters.
 *
 * 10^6 = 1,000,000 of space. At ~50,000 tickets roughly 10% of issuances hit
 * a collision, which is NOT a failure: tickets.service's
 * NUMBER_COLLISION_RETRIES loop regenerates and retries the whole
 * transaction silently. Exhausting all five retries works out at about 1 in
 * 113,000 issuances at that volume — under one expected failure across the
 * event, surfacing as a plain retryable error rather than a lost sale.
 *
 * See constants.ts for why six digits rather than five: going numeric costs
 * length, and at five the space is 100,000, where one issuance in four would
 * fail outright at 50,000 tickets.
 */
export function generateRequestNumber(): string {
  return `${REQUEST_NUMBER_PREFIX}${randomDigits(REQUEST_NUMBER_LENGTH)}`;
}

/**
 * TKT-719564 — same format and same collision math as the request number
 * above. Every registration produces exactly one of each (§4.4), so their
 * collision domains grow at the same rate and there is no reason for the two
 * to differ in length.
 */
export function generateTicketNumber(): string {
  return `${TICKET_NUMBER_PREFIX}${randomDigits(TICKET_NUMBER_LENGTH)}`;
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
