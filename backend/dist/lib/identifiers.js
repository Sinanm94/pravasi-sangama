import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { REQUEST_NUMBER_HEX_LENGTH, REQUEST_NUMBER_PREFIX, TICKET_NUMBER_HEX_LENGTH, TICKET_NUMBER_PREFIX, } from '@pravasi/shared';
const hex = (chars) => randomBytes(chars / 2)
    .toString('hex')
    .toUpperCase();
/** REQ-2026-A3F19C0B7E42 */
export function generateRequestNumber() {
    return `${REQUEST_NUMBER_PREFIX}${hex(REQUEST_NUMBER_HEX_LENGTH)}`;
}
/**
 * TKT-9C4E1A7B02
 *
 * 2^40 of space. At 50k tickets the birthday bound puts the chance of *any*
 * collision near 0.1%, which the unique constraint plus the retry loop in
 * tickets.service absorbs. Do not shorten this without redoing that maths.
 */
export function generateTicketNumber() {
    return `${TICKET_NUMBER_PREFIX}${hex(TICKET_NUMBER_HEX_LENGTH)}`;
}
/**
 * The value encoded into the printed QR. Returned to the client exactly once,
 * at issuance — the database only ever holds its hash.
 */
export function generateQrPayload() {
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
export function hashQrPayload(payload) {
    return createHash('sha256').update(payload).digest('hex');
}
//# sourceMappingURL=identifiers.js.map