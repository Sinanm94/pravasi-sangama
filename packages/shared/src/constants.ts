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

export const AUTH_ROLES = ['AGENT', 'SCANNER', 'SUPERUSER', 'UNIT_ADMIN'] as const;
/**
 * SCANNER — a gate, not a person. Verifies codes; cannot issue anything.
 *
 * UNIT_ADMIN — approves/rejects agent registrations for ONE unit only.
 * Decentralises the approval bottleneck at SUPERUSER; a superuser still
 * retains unrestricted approval across every unit (§2).
 *
 * There is no UNIT_PENDING: agent login is a single step and mints a full
 * AGENT token directly (§3.2). UNIT_ADMIN is unrelated to that deleted
 * flow — it authenticates a person, not a location. See migration 005.
 */
export type AuthRole = (typeof AUTH_ROLES)[number];

/** Persisted `user_role` enum — same set, named for the database. */
export const USER_ROLES = ['SUPERUSER', 'AGENT', 'SCANNER', 'UNIT_ADMIN'] as const;
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

/**
 * The Unit Gateway's per-unit agent invite PIN (§3.2) — fixed at exactly 4
 * digits, deliberately simpler than a real credential. A unit head hands
 * this to their own agents once; it gates entry to the whole agent portal
 * (login and first-time setup alike), not a specific account.
 */
export const AGENT_INVITE_PIN_LENGTH = 4;

export const TICKET_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Premium client tracking (migration 015)                             */
/* ------------------------------------------------------------------ */

/** Where a premium conversation stands. Mirrors the `client_status` enum. */
export const CLIENT_STATUSES = [
  'PROSPECT',
  'AWAITING_REPLY',
  'CONFIRMED',
  'TICKETED',
  'DECLINED',
] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABELS: Readonly<Record<ClientStatus, string>> = {
  PROSPECT: 'Prospect',
  AWAITING_REPLY: 'Awaiting reply',
  CONFIRMED: 'Confirmed',
  TICKETED: 'Ticketed',
  DECLINED: 'Declined',
} as const;

/* ------------------------------------------------------------------ */
/* Activities — the organiser's own task list (migration 018)          */
/* ------------------------------------------------------------------ */

export const ACTIVITY_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type ActivityPriority = (typeof ACTIVITY_PRIORITIES)[number];

export const ACTIVITY_PRIORITY_LABELS: Readonly<
  Record<ActivityPriority, string>
> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
} as const;

/** What kind of exchange a timeline entry records. */
export const CLIENT_INTERACTION_KINDS = ['NOTE', 'OUTREACH', 'RESPONSE'] as const;
export type ClientInteractionKind = (typeof CLIENT_INTERACTION_KINDS)[number];

export const CLIENT_INTERACTION_LABELS: Readonly<
  Record<ClientInteractionKind, string>
> = {
  NOTE: 'Note',
  OUTREACH: 'We asked',
  RESPONSE: 'They replied',
} as const;

/* ------------------------------------------------------------------ */
/* Numbering                                                           */
/* ------------------------------------------------------------------ */

export const EVENT_YEAR = 2026;
export const EVENT_NAME = 'Pravasi Sangama 2026';
export const ORGANISATION_NAME = 'Karnataka Cultural Foundation';

/** Printed on the pass. Display string, not a parseable date. */
export const EVENT_DATE_LABEL = '15, Oct 2026';

/**
 * The event's timezone. Every timestamp shown to staff — gate scans, the
 * admin scan log — is rendered in this zone rather than the device's.
 *
 * A volunteer's phone may be set to any timezone (many are still on their
 * home country's), and "was this ticket already used?" is a question about
 * when it happened AT THE GATE. Two people comparing screens must see the
 * same clock, so the zone is fixed here rather than left to the device.
 * Timestamps are still STORED as UTC `timestamptz` — this is display only.
 */
export const EVENT_TIME_ZONE = 'Asia/Riyadh';

/**
 * Static venue-information target — the real event location.
 *
 * EVERY ticket prints a Location panel carrying this link, on all tiers. It
 * is a plain https URL so a guest's phone camera opens directions; the
 * backend's LOCATION qr_codes payload is a bare UUID, which a camera app can
 * do nothing with.
 *
 * It is NOT an admission credential and never was. The gate reports
 * UNKNOWN_CODE for it, and it never consumes guest capacity.
 */
export const VENUE_INFO_URL =
  'https://maps.app.goo.gl/QpuirTEdGJGnZyED9?g_st=ic';

/**
 * Numbers are SEQUENTIAL, allocated from a Postgres sequence
 * (migration 016): TKT-0001, TKT-0002, TKT-0003 …
 *
 *   REQ-0001   (4 digits — 9,999 tickets)
 *   TKT-0001   (4 digits — 9,999 tickets)
 *
 * ⚠ This reverses an earlier decision, on explicit instruction, and the
 *   tradeoff should stay visible rather than be quietly forgotten:
 *
 *   Numbers used to be crypto-random precisely BECAUSE a sequential number
 *   leaks total sales volume to anyone holding a single ticket (the holder
 *   of TKT-0350 knows 350 have been sold) and makes the range enumerable
 *   instead of sparse.
 *
 *   What makes that acceptable here: NEITHER NUMBER IS AN ADMISSION
 *   CREDENTIAL. The QR payload is a full UUID and is the only thing that
 *   admits anyone (§4.3, §10.1). A guessed or enumerated number buys a
 *   searchable label, not entry — the exposure is commercial, not a gate
 *   breach.
 *
 * DIGITS ONLY. These are read off a printed stub and re-typed, often on a
 * phone's numeric keypad by staff coming off paper systems — a letter/digit
 * mix means switching keyboards and second-guessing an O against a 0.
 *
 * FOUR digits, sized to the event rather than to collision math. Sequential
 * allocation has no collisions to absorb — the sequence never hands out the
 * same value twice — so length only has to cover volume, where the random
 * scheme needed a sparse space many times larger than the ticket count.
 * 9,999 is roughly 20x the expected attendance.
 *
 * If volume ever approaches 9,999, raise both lengths here. Nothing else
 * needs to change: LPAD in `nextTicketNumbers` reads these constants, and a
 * number that outgrows the width simply prints wider rather than breaking.
 *
 * Leading zeros are significant — ticket 41 is `TKT-0041`, never `TKT-41`.
 *
 * Tickets issued under every older format (12/10 hex, 6 alphanumeric, and
 * the 6-digit random scheme) keep their original numbers and stay
 * searchable. The regexes below have no runtime callers that would reject
 * one, so nothing re-validates an existing ticket.
 */
export const REQUEST_NUMBER_PREFIX = 'REQ-';
export const TICKET_NUMBER_PREFIX = 'TKT-';

export const REQUEST_NUMBER_LENGTH = 4;
export const TICKET_NUMBER_LENGTH = 4;

export const REQUEST_NUMBER_REGEX = new RegExp(
  `^REQ-[0-9]{${REQUEST_NUMBER_LENGTH}}$`,
);
export const TICKET_NUMBER_REGEX = new RegExp(
  `^TKT-[0-9]{${TICKET_NUMBER_LENGTH}}$`,
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
