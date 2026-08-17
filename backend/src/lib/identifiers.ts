import { createHash, randomUUID } from 'node:crypto';

/* generateRequestNumber() / generateTicketNumber() were removed with the
 * random numbering scheme (migration 016).
 *
 * Numbers are now allocated by the DATABASE, from `request_number_seq` and
 * `ticket_number_seq`, via `tickets.repository.nextTicketNumbers()` — drawn
 * inside the issuing transaction so two concurrent agents can never receive
 * the same value. There is deliberately no application-side generator any
 * more: one existing here would be a second source of truth for a value
 * whose uniqueness only the sequence can guarantee.
 *
 * Formatting (prefix + zero padding) lives in that same SQL, reading
 * REQUEST_NUMBER_LENGTH / TICKET_NUMBER_LENGTH from packages/shared so the
 * width stays defined in exactly one place (§4.5). */

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
