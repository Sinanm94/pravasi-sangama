/**
 * THE single source of truth for capacity.
 *
 * If the issuer and the scanner ever disagree about what a tier means, the
 * gate admits the wrong number of people. Nothing in this file may be
 * re-declared in frontend/ or backend/ — import it.
 */
/**
 * Canonical wire + storage form is UPPERCASE, matching the Postgres
 * `ticket_type` enum. Never send a display label to the API.
 */
export declare const TICKET_TYPES: readonly ["NORMAL", "VIP", "VVIP", "SVIP"];
export type TicketType = (typeof TICKET_TYPES)[number];
/** The three premium tiers. Identical in capacity — they differ only in
 *  presentation, pricing and access zone. */
export declare const PREMIUM_TICKET_TYPES: readonly ["VIP", "VVIP", "SVIP"];
export type PremiumTicketType = (typeof PREMIUM_TICKET_TYPES)[number];
/** Persons admitted per tier. Mirrored by the DB constraint
 *  `tickets_capacity_matches_tier`. */
export declare const SEATS_PER_TIER: Readonly<Record<TicketType, number>>;
/** Guest QR codes are indexed 1..4. Mirrored by `qr_codes_index_matches_kind`. */
export declare const MAX_GUEST_INDEX = 4;
/** Human-facing labels. Presentation only — never persisted, never sent. */
export declare const TICKET_TYPE_LABELS: Readonly<Record<TicketType, string>>;
export declare function isPremiumTier(type: TicketType): type is PremiumTicketType;
/** Persons this ticket admits. */
export declare function seatsFor(type: TicketType): number;
/**
 * QR codes generated at issuance.
 *   NORMAL -> 1 (one guest code)
 *   premium -> 5 (four guest codes + one location code)
 * The location code is NOT an admission credential and never counts toward
 * capacity — it is the +1 here and nowhere else.
 */
export declare function qrCodeCountFor(type: TicketType): number;
export declare const QR_CODE_KINDS: readonly ["GUEST", "LOCATION"];
export type QrCodeKind = (typeof QR_CODE_KINDS)[number];
export declare const QR_CODE_STATUSES: readonly ["ISSUED", "SCANNED", "REVOKED"];
export type QrCodeStatus = (typeof QR_CODE_STATUSES)[number];
/** Persisted in `scan_logs.result`. Mirrors the Postgres `scan_result` enum. */
export declare const SCAN_RESULTS: readonly ["ADMITTED", "LOCATION_INFO", "DUPLICATE", "REVOKED", "UNKNOWN_CODE"];
export type ScanResult = (typeof SCAN_RESULTS)[number];
/**
 * The wire discriminant for POST /api/scan/verify.
 *
 * Coarse on purpose — the gate UI has three states: green, amber, red. It
 * does not branch on *why* a code was rejected, only that it was.
 */
export declare const SCAN_STATUSES: readonly ["SUCCESS", "DUPLICATE", "INVALID"];
export type ScanStatus = (typeof SCAN_STATUSES)[number];
/** The precise cause, carried alongside `status` for logs and analytics. */
export declare const SCAN_REASONS: readonly ["ADMITTED", "LOCATION_INFO", "ALREADY_SCANNED", "CODE_REVOKED", "TICKET_REVOKED", "UNKNOWN_CODE"];
export type ScanReason = (typeof SCAN_REASONS)[number];
/** Wire reason -> the value stored in scan_logs.result. */
export declare const SCAN_REASON_TO_RESULT: Readonly<Record<ScanReason, ScanResult>>;
export declare const SCAN_REASON_TO_STATUS: Readonly<Record<ScanReason, ScanStatus>>;
/** The exact code set a ticket of this tier must have, in issue order. */
export declare function qrCodePlanFor(type: TicketType): ReadonlyArray<{
    kind: QrCodeKind;
    guestIndex: number | null;
}>;
export declare const AUTH_ROLES: readonly ["UNIT_PENDING", "AGENT", "SUPERUSER"];
/** UNIT_PENDING = step 1 complete, step 2 outstanding. Cannot issue tickets. */
export type AuthRole = (typeof AUTH_ROLES)[number];
export declare const TICKET_STATUSES: readonly ["ACTIVE", "REVOKED"];
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export declare const EVENT_YEAR = 2026;
export declare const EVENT_NAME = "Pravasi Sangama 2026";
export declare const ORGANISATION_NAME = "Karnataka Cultural Foundation";
/** Printed on the pass. Display string, not a parseable date. */
export declare const EVENT_DATE_LABEL = "15, Oct 2026";
/**
 * Static venue-information target.
 *
 * The Normal ticket design carries a LOCATION INFO panel, but a Normal ticket
 * is issued with **one** QR code (§4.1) and the database holds no LOCATION row
 * for it. That panel therefore encodes this fixed venue link — identical on
 * every Normal ticket, not an admission credential, and the gate will report
 * UNKNOWN_CODE if anyone tries to enter on it.
 *
 * Replace with the real venue map URL before anything is printed.
 */
export declare const VENUE_INFO_URL = "https://maps.google.com/?q=Pravasi+Sangama+2026";
/**
 * Numbers are crypto-random, not sequential — a sequential ticket number
 * leaks total sales volume to anyone holding one ticket, and lets an attacker
 * enumerate the range.
 *
 * Generation is server-side only (`backend/src/lib/identifiers.ts`); these are
 * the shared format contracts for validation and display.
 *
 *   REQ-2026-A3F19C0B7E42   (12 hex — 2^48 space)
 *   TKT-9C4E1A7B02          (10 hex — 2^40 space)
 */
export declare const REQUEST_NUMBER_PREFIX = "REQ-2026-";
export declare const TICKET_NUMBER_PREFIX = "TKT-";
export declare const REQUEST_NUMBER_HEX_LENGTH = 12;
export declare const TICKET_NUMBER_HEX_LENGTH = 10;
export declare const REQUEST_NUMBER_REGEX: RegExp;
export declare const TICKET_NUMBER_REGEX: RegExp;
export declare function isRequestNumber(value: string): boolean;
export declare function isTicketNumber(value: string): boolean;
export declare const MOBILE_NUMBER_REGEX: RegExp;
/** Session cookie name. Same string on both tiers or auth silently breaks. */
export declare const SESSION_COOKIE_NAME = "ps_session";
//# sourceMappingURL=constants.d.ts.map