/**
 * THE single source of truth for capacity.
 *
 * If the issuer and the scanner ever disagree about what a tier means, the
 * gate admits the wrong number of people. Nothing in this file may be
 * re-declared in frontend/ or backend/ — import it.
 */

/* ------------------------------------------------------------------ */
/* Ticket tiers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Canonical wire + storage form is UPPERCASE, matching the Postgres
 * `ticket_type` enum. Never send a display label to the API.
 */
export const TICKET_TYPES = ['NORMAL', 'VIP', 'VVIP', 'SVIP'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

/** The three premium tiers. Identical in capacity — they differ only in
 *  presentation, pricing and access zone. */
export const PREMIUM_TICKET_TYPES = ['VIP', 'VVIP', 'SVIP'] as const;
export type PremiumTicketType = (typeof PREMIUM_TICKET_TYPES)[number];

/** Persons admitted per tier. Mirrored by the DB constraint
 *  `tickets_capacity_matches_tier`. */
export const SEATS_PER_TIER: Readonly<Record<TicketType, number>> = {
  NORMAL: 1,
  VIP: 4,
  VVIP: 4,
  SVIP: 4,
} as const;

/** Guest QR codes are indexed 1..4. Mirrored by `qr_codes_index_matches_kind`. */
export const MAX_GUEST_INDEX = 4;

/** Human-facing labels. Presentation only — never persisted, never sent. */
export const TICKET_TYPE_LABELS: Readonly<Record<TicketType, string>> = {
  NORMAL: 'Normal',
  VIP: 'VIP',
  VVIP: 'VVIP',
  SVIP: 'SVIP',
} as const;

export function isPremiumTier(type: TicketType): type is PremiumTicketType {
  return type !== 'NORMAL';
}

/** Persons this ticket admits. */
export function seatsFor(type: TicketType): number {
  return SEATS_PER_TIER[type];
}

/**
 * QR codes generated at issuance.
 *   NORMAL -> 1 (one guest code)
 *   premium -> 5 (four guest codes + one location code)
 * The location code is NOT an admission credential and never counts toward
 * capacity — it is the +1 here and nowhere else.
 */
export function qrCodeCountFor(type: TicketType): number {
  return isPremiumTier(type) ? SEATS_PER_TIER[type] + 1 : 1;
}

/* ------------------------------------------------------------------ */
/* QR codes                                                            */
/* ------------------------------------------------------------------ */

export const QR_CODE_KINDS = ['GUEST', 'LOCATION'] as const;
export type QrCodeKind = (typeof QR_CODE_KINDS)[number];

export const QR_CODE_STATUSES = ['ISSUED', 'SCANNED', 'REVOKED'] as const;
export type QrCodeStatus = (typeof QR_CODE_STATUSES)[number];

/** Persisted in `scan_logs.result`. Mirrors the Postgres `scan_result` enum. */
export const SCAN_RESULTS = [
  'ADMITTED',
  'LOCATION_INFO',
  'DUPLICATE',
  'REVOKED',
  'UNKNOWN_CODE',
] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

/**
 * The wire discriminant for POST /api/scan/verify.
 *
 * Coarse on purpose — the gate UI has three states: green, amber, red. It
 * does not branch on *why* a code was rejected, only that it was.
 */
export const SCAN_STATUSES = ['SUCCESS', 'DUPLICATE', 'INVALID'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/** The precise cause, carried alongside `status` for logs and analytics. */
export const SCAN_REASONS = [
  'ADMITTED',
  'LOCATION_INFO',
  'ALREADY_SCANNED',
  'CODE_REVOKED',
  'TICKET_REVOKED',
  'UNKNOWN_CODE',
] as const;
export type ScanReason = (typeof SCAN_REASONS)[number];

/** Wire reason -> the value stored in scan_logs.result. */
export const SCAN_REASON_TO_RESULT: Readonly<Record<ScanReason, ScanResult>> = {
  ADMITTED: 'ADMITTED',
  LOCATION_INFO: 'LOCATION_INFO',
  ALREADY_SCANNED: 'DUPLICATE',
  CODE_REVOKED: 'REVOKED',
  TICKET_REVOKED: 'REVOKED',
  UNKNOWN_CODE: 'UNKNOWN_CODE',
} as const;

export const SCAN_REASON_TO_STATUS: Readonly<Record<ScanReason, ScanStatus>> = {
  ADMITTED: 'SUCCESS',
  LOCATION_INFO: 'SUCCESS',
  ALREADY_SCANNED: 'DUPLICATE',
  CODE_REVOKED: 'INVALID',
  TICKET_REVOKED: 'INVALID',
  UNKNOWN_CODE: 'INVALID',
} as const;

/** The exact code set a ticket of this tier must have, in issue order. */
export function qrCodePlanFor(
  type: TicketType,
): ReadonlyArray<{ kind: QrCodeKind; guestIndex: number | null }> {
  if (!isPremiumTier(type)) {
    return [{ kind: 'GUEST', guestIndex: 1 }];
  }

  return [
    ...Array.from({ length: SEATS_PER_TIER[type] }, (_, i) => ({
      kind: 'GUEST' as const,
      guestIndex: i + 1,
    })),
    { kind: 'LOCATION' as const, guestIndex: null },
  ];
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

export const AUTH_ROLES = ['AGENT', 'SCANNER', 'SUPERUSER'] as const;
/**
 * SCANNER — a gate, not a person. Verifies codes; cannot issue anything.
 *
 * There is no UNIT_PENDING: agent login is a single step and mints a full
 * AGENT token directly (§3.2).
 */
export type AuthRole = (typeof AUTH_ROLES)[number];

/** Persisted `user_role` enum — same set, named for the database. */
export const USER_ROLES = ['SUPERUSER', 'AGENT', 'SCANNER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * The only addresses permitted to hold a superuser account (spec §4).
 * Enforced server-side; there is no superuser signup route, by design.
 */
export const SUPERUSER_EMAILS = [
  'admin1@pravasisangama.com',
  'admin2@pravasisangama.com',
  'admin3@pravasisangama.com',
] as const;

/** Self-registered agent password floor (spec §3). */
export const AGENT_PASSWORD_MIN_LENGTH = 6;
/** Gate PINs are short by design — volunteers key them in all evening. */
export const GATE_PIN_MIN_LENGTH = 4;
export const GATE_PIN_MAX_LENGTH = 6;

export const TICKET_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Numbering                                                           */
/* ------------------------------------------------------------------ */

export const EVENT_YEAR = 2026;
export const EVENT_NAME = 'Pravasi Sangama 2026';
export const ORGANISATION_NAME = 'Karnataka Cultural Foundation';

/** Printed on the pass. Display string, not a parseable date. */
export const EVENT_DATE_LABEL = '15, Oct 2026';

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
export const VENUE_INFO_URL = 'https://maps.google.com/?q=Pravasi+Sangama+2026';

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
export const REQUEST_NUMBER_PREFIX = `REQ-${EVENT_YEAR}-`;
export const TICKET_NUMBER_PREFIX = 'TKT-';

export const REQUEST_NUMBER_HEX_LENGTH = 12;
export const TICKET_NUMBER_HEX_LENGTH = 10;

export const REQUEST_NUMBER_REGEX = new RegExp(
  `^REQ-${EVENT_YEAR}-[0-9A-F]{${REQUEST_NUMBER_HEX_LENGTH}}$`,
);
export const TICKET_NUMBER_REGEX = new RegExp(
  `^TKT-[0-9A-F]{${TICKET_NUMBER_HEX_LENGTH}}$`,
);

export function isRequestNumber(value: string): boolean {
  return REQUEST_NUMBER_REGEX.test(value);
}

export function isTicketNumber(value: string): boolean {
  return TICKET_NUMBER_REGEX.test(value);
}

/* ------------------------------------------------------------------ */
/* Shared validation primitives                                        */
/* ------------------------------------------------------------------ */

export const MOBILE_NUMBER_REGEX = /^[0-9]{10}$/;

/** Session cookie name. Same string on both tiers or auth silently breaks. */
export const SESSION_COOKIE_NAME = 'ps_session';
