import type {
  ApprovalStatus,
  AuthRole,
  QrCodeKind,
  QrCodeStatus,
  ScanReason,
  ScanResult,
  ScanStatus,
  TicketStatus,
  TicketType,
} from './constants.js';

/** Domain shapes returned by the API. camelCase — these are read models,
 *  not wire input (see schemas.ts for the snake_case request contracts). */

export interface Division {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

export interface Unit {
  id: string;
  divisionId: string;
  unitCode: string;
  name: string;
  sector: string | null;
  isActive: boolean;
}

export interface Agent {
  id: string;
  unitId: string;
  mobileNumber: string;
  name: string;
  isActive: boolean;
}

export interface QrCode {
  id: string;
  ticketId: string;
  kind: QrCodeKind;
  guestIndex: number | null;
  status: QrCodeStatus;
  scannedAt: string | null;
}

export interface Ticket {
  id: string;
  requestNumber: string;
  ticketNumber: string;
  ticketType: TicketType;
  purchaserName: string;
  purchaserMobile: string;
  purchaserEmail: string | null;
  countedPersons: number;
  childrenBelow12: number;
  status: TicketStatus;
  createdAt: string;
  qrCodes: QrCode[];
}

/* ------------------------------------------------------------------ */
/* JWT claims                                                          */
/* ------------------------------------------------------------------ */

/** Step 2 complete. Full agent access, scoped to one unit. */
export interface AgentClaims {
  role: Extract<AuthRole, 'AGENT'>;
  sessionId: string;
  agentId: string;
  unitId: string;
  divisionId: string;
}

/**
 * A gate, not a person (spec §2, Option A). Volunteers share the PIN, so
 * there is no individual identity to carry — scans attribute to `gateId`,
 * which is the operationally useful unit anyway.
 */
export interface ScannerClaims {
  role: Extract<AuthRole, 'SCANNER'>;
  sessionId: string;
  gateId: string;
  gateCode: string;
  gateName: string;
  divisionId: string | null;
}

export interface SuperuserClaims {
  role: Extract<AuthRole, 'SUPERUSER'>;
  superuserId: string;
}

/**
 * Scoped to ONE unit — approvals only, nothing else (§2). `unitId` is
 * nullable: a small number of seeded accounts ("zone supervisors") are
 * provisioned before their coverage is decided. An unscoped token is valid
 * to sign in with, but every approvals query returns empty rather than
 * guessing a scope — see unit-admin.repository.ts.
 */
export interface UnitAdminClaims {
  role: Extract<AuthRole, 'UNIT_ADMIN'>;
  unitAdminId: string;
  unitId: string | null;
}

export type SessionClaims =
  | AgentClaims
  | ScannerClaims
  | SuperuserClaims
  | UnitAdminClaims;

/* ------------------------------------------------------------------ */
/* Gate scanning                                                       */
/* ------------------------------------------------------------------ */

/** Ticket context the gate UI shows next to the verdict. */
export interface ScannedTicketSummary {
  ticketId: string;
  ticketNumber: string;
  ticketType: TicketType;
  purchaserName: string;
  countedPersons: number;
  childrenBelow12: number;
  /** Guest codes on this ticket already consumed, including this one. */
  admittedCount: number;
}

/** Who admitted this code the first time. Present only on DUPLICATE. */
export interface PriorScan {
  scannedAt: string;
  agentName: string | null;
  gateLabel: string | null;
}

export interface VerifyScanResponse {
  /** Green / amber / red. The only field the gate UI must branch on. */
  status: ScanStatus;
  /** The precise cause behind `status`. */
  reason: ScanReason;
  message: string;

  ticketId: string | null;
  codeKind: QrCodeKind | null;
  guestIndex: number | null;

  ticket?: ScannedTicketSummary;
  priorScan?: PriorScan;

  /** True when this response was replayed from an earlier identical request. */
  replay: boolean;
  scannedAt: string;
}

/**
 * One settled verdict from a bulk-sync batch.
 *
 * Client rule: **delete the local row when `error` is absent** — any settled
 * status, including DUPLICATE and INVALID, means the server has recorded it
 * and the queue entry is done. Keep and retry only when `error` is present.
 */
export interface BulkSyncItemResult {
  clientScanId: string;
  /** null only when the item failed to process — see `error`. */
  status: ScanStatus | null;
  reason: ScanReason | null;
  ticketId: string | null;
  codeKind: QrCodeKind | null;
  guestIndex: number | null;
  replay: boolean;
  /** When the server committed it. The client keeps its own capture time. */
  serverScannedAt: string | null;
  error?: { code: string; message: string };
}

export interface BulkSyncResponse {
  results: BulkSyncItemResult[];
  /** Settled — safe for the client to drop. */
  accepted: number;
  /** Failed — the client must keep these queued. */
  failed: number;
}

/* ------------------------------------------------------------------ */
/* Ticket issuance response                                            */
/* ------------------------------------------------------------------ */

/**
 * A raw QR payload. Present in the issuance response and NOWHERE else —
 * the database stores only `sha256(payload)` (§4.4). If the client loses this
 * before printing or sharing, the ticket must be reissued with new codes.
 */
export interface IssuedQrCodeWire {
  id: string;
  kind: QrCodeKind;
  guest_index: number | null;
  payload: string;
}

export interface IssueTicketResponse {
  ticket: {
    id: string;
    request_number: string;
    ticket_number: string;
    ticket_type: TicketType;
    ticket_type_label: string;
    purchaser_name: string;
    purchaser_mobile: string;
    purchaser_email: string | null;
    counted_persons: number;
    children_below_12: number;
    status: TicketStatus;
    created_at: string;
  };
  qr_codes: IssuedQrCodeWire[];
}

/* ------------------------------------------------------------------ */
/* Real-time (§10.5)                                                   */
/* ------------------------------------------------------------------ */

/** Socket.io namespace. Superuser JWT required on handshake. */
export const LIVE_NAMESPACE = '/live';

export const LIVE_EVENTS = {
  /** Coalesced batch of scan events, flushed on a 1s tick. */
  FEED: 'scan:feed',
  /** Exceptions only, emitted immediately so alerts are not delayed. */
  ALERT: 'scan:alert',
} as const;

/**
 * `POST_SYNC_DUPLICATE` is the §10.4 case: an offline device admitted a guest
 * whose code another device had already consumed. Both people are inside. It
 * is deliberately distinct from a live DUPLICATE, which was stopped at the
 * door.
 */
export type ScanAlertType =
  | 'ADMITTED'
  | 'LOCATION_INFO'
  | 'DUPLICATE'
  | 'POST_SYNC_DUPLICATE'
  | 'INVALID';

export interface LiveScanEvent extends RecentScanEntry {
  alertType: ScanAlertType;
  /** LIVE = at the gate in real time. SYNC = replayed from an offline queue. */
  source: 'LIVE' | 'SYNC';
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

export interface DashboardTotals {
  /** ACTIVE tickets only — revoked ones are excluded everywhere. */
  totalTickets: number;
  /** GUEST codes on active tickets. Location codes never count. */
  totalGuestsExpected: number;
  /** ADMITTED scans since midnight in the event timezone. */
  totalScannedToday: number;
  /** Distinct units with a scan in the last 5 minutes. */
  activeGates: number;
}

export interface TicketTypeBreakdownEntry {
  ticketType: TicketType;
  ticketCount: number;
  /** Seats, not tickets — one VIP ticket is four people. */
  seatCount: number;
}

export interface DivisionPerformanceEntry {
  divisionId: string;
  divisionName: string;
  divisionCode: string;
  ticketsSold: number;
  guestsExpected: number;
}

export interface RecentScanEntry {
  id: string;
  scannedAt: string;
  result: ScanResult;
  agentName: string | null;
  unitName: string | null;
  unitSector: string | null;
  gateLabel: string | null;
  ticketNumber: string | null;
  ticketType: TicketType | null;
}

export interface DashboardSnapshot {
  generatedAt: string;
  timezone: string;
  totals: DashboardTotals;
  ticketTypeBreakdown: TicketTypeBreakdownEntry[];
  divisionPerformance: DivisionPerformanceEntry[];
  recentScans: RecentScanEntry[];
}

/* ------------------------------------------------------------------ */
/* API envelope                                                        */
/* ------------------------------------------------------------------ */

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** What /auth/agent-login returns alongside the cookie. */
export interface SessionResponse {
  role: AuthRole;
  unit?: Pick<Unit, 'id' | 'unitCode' | 'name' | 'sector'>;
  division?: Pick<Division, 'id' | 'name' | 'code'>;
  agent?: Pick<Agent, 'id' | 'name' | 'mobileNumber'>;
  gate?: { id: string; gateCode: string; name: string };
  /**
   * UNIT_ADMIN only. `unit` above carries the scope when assigned — absent
   * entirely, not merely null, when the account has none yet (see
   * UnitAdminClaims). The client must render an explicit "no unit assigned"
   * state for that case, not an empty-looking approvals screen.
   */
  unitAdmin?: { id: string; name: string; username: string };
  expiresAt: string;
}

/* ------------------------------------------------------------------ */
/* Account management                                                  */
/* ------------------------------------------------------------------ */

/** What signup returns. No session — approval comes first (spec §3). */
export interface AgentSignupResponse {
  status: ApprovalStatus;
  message: string;
  agent: { id: string; name: string; mobileNumber: string; email: string };
}

/**
 * Public, unauthenticated: the full unit list. No longer consumed by the
 * signup form as of the Unit Gateway (§3.2) — a signup's unit is hardcoded
 * from the gateway step instead of picked from this list — but the
 * endpoint (`GET /api/auth/units`) is left in place; unit codes and names
 * were never secret, and removing a harmless read endpoint isn't this
 * change's job.
 */
export interface PublicUnit {
  unitCode: string;
  name: string;
  sector: string | null;
  divisionName: string;
}

/**
 * POST /api/auth/unit-gateway's success response — the unit a signup or
 * login session is now locked to. Not a session or a credential: no cookie
 * is set here, this only tells the frontend which unit to hardcode into the
 * signup form for the rest of this visit (§3.2).
 */
export interface UnitGatewayResponse {
  unitId: string;
  unitCode: string;
  unitName: string;
  divisionName: string;
}

/** Public, unauthenticated: the gate picker on the scanner login. */
export interface PublicGate {
  gateCode: string;
  name: string;
}

export interface PendingAgent {
  id: string;
  name: string;
  mobileNumber: string;
  email: string | null;
  unitCode: string;
  unitName: string;
  divisionName: string;
  createdAt: string;
}

/**
 * GET /api/unit-admin/agents. Two arrays, not one list with a status field —
 * the dashboard renders them completely differently (huge Approve/Reject
 * buttons vs. a plain read-only list), and this shape makes mixing them up
 * a type error instead of a runtime bug.
 */
export interface UnitAdminAgentListResponse {
  pending: PendingAgent[];
  approved: PendingAgent[];
}

export interface GateSummary {
  id: string;
  gateCode: string;
  name: string;
  divisionName: string | null;
  isActive: boolean;
  pinRotatedAt: string;
  pinValidOn: string | null;
}

/**
 * One row of the admin agent directory.
 *
 * Every count is aggregated server-side per agent. The client is never handed
 * a ticket list to count for itself — an admin browser has no business
 * holding the ledger, and a paginated list would undercount silently.
 */
export interface AgentDirectoryEntry {
  id: string;
  name: string;
  mobileNumber: string;
  email: string | null;
  unitCode: string;
  unitName: string;
  divisionName: string;
  /** A deactivated agent keeps their history but cannot sign in. */
  isActive: boolean;
  createdAt: string;

  /** Every ticket this agent has issued, revoked ones included. */
  ticketsIssued: number;
  /** Subset of `ticketsIssued` that was later revoked. */
  ticketsRevoked: number;
  /**
   * Seats on this agent's still-active tickets — SUM(counted_persons).
   *
   * This is issued CAPACITY, not attendance. Admission is a scan, and lives in
   * scan_logs. Labelling this "admitted" anywhere in the UI would misreport
   * the gate.
   */
  seatsIssued: number;
  /** Null when the agent has never issued a ticket. */
  lastIssuedAt: string | null;
}

/**
 * One row of an agent's own ticket ledger (`GET /api/tickets/mine`).
 *
 * Scoped server-side to the token's `agentId` — §2's rule that an agent sees
 * only their own registrations is enforced in the query, not by a filter the
 * client could drop.
 */
export interface AgentTicketSummary {
  id: string;
  requestNumber: string;
  ticketNumber: string;
  ticketType: TicketType;
  purchaserName: string;
  purchaserMobile: string;
  purchaserEmail: string | null;
  /** Adults admitted. Children below 12 are excluded from this (§4.2). */
  countedPersons: number;
  /** Free, and outside ticket capacity — headcount only (§4.2). */
  childrenBelow12: number;
  status: TicketStatus;
  createdAt: string;
}

export interface AgentTicketListResponse {
  tickets: AgentTicketSummary[];
  totals: {
    tickets: number;
    /** Sum of countedPersons on ACTIVE tickets. */
    seats: number;
    /** Sum of childrenBelow12 on ACTIVE tickets — catering and crowd safety. */
    children: number;
  };
}

/* ------------------------------------------------------------------ */
/* Admin — master ticket ledger                                        */
/* ------------------------------------------------------------------ */

/** One row of the admin-wide ticket ledger. Unscoped: superusers see all. */
export interface AdminTicketRow {
  id: string;
  requestNumber: string;
  ticketNumber: string;
  ticketType: TicketType;
  purchaserName: string;
  purchaserMobile: string;
  purchaserEmail: string | null;
  /** Adults. Children below 12 are excluded from this (§4.2). */
  countedPersons: number;
  childrenBelow12: number;
  status: TicketStatus;
  createdAt: string;

  agentId: string;
  agentName: string;
  unitId: string;
  unitName: string;
  unitCode: string;
  /** The unit's parent sector (migration 010). Null outside the real roster. */
  unitSector: string | null;
  divisionId: string;
  divisionName: string;
}

export interface AdminTicketLedgerResponse {
  tickets: AdminTicketRow[];
  /**
   * Aggregated over the WHOLE filtered set in SQL, not over `tickets`.
   * The row list is capped, so summing it client-side would silently
   * under-report the moment a filter matches more than the cap.
   */
  totals: {
    tickets: number;
    seats: number;
    children: number;
  };
  /** True when more rows matched than were returned — narrow the filters. */
  truncated: boolean;
  limit: number;
}

/**
 * GET /api/unit-admin/invite-pin — the agent invite PIN(s) for the units
 * this admin covers (§3.2). A list, not one value: a zone supervisor covers
 * many units and needs each one's PIN.
 */
export interface UnitInvitePin {
  unitCode: string;
  unitName: string;
  sector: string | null;
  /** Null when a working PIN exists but no readable copy was recorded. */
  invitePin: string | null;
  /** False when this unit has no invite PIN configured at all. */
  hasPin: boolean;
}

export interface UnitAdminInvitePinResponse {
  units: UnitInvitePin[];
}

/**
 * GET /api/unit-admin/tickets — a unit admin's own ticket ledger.
 *
 * Same row shape as the superuser's `AdminTicketRow` — the data a ticket
 * carries doesn't change depending on who's allowed to see it, only the
 * scope of which rows are returned (§3.3's OR-scope: direct unit posting
 * union zone assignments, resolved in SQL, never a client-supplied filter).
 */
export interface UnitAdminTicketListResponse {
  tickets: AdminTicketRow[];
  /** Aggregated server-side over the whole scoped+filtered set, not `tickets` — same reasoning as AdminTicketLedgerResponse.totals. */
  totals: {
    tickets: number;
    seats: number;
    children: number;
  };
  truncated: boolean;
  limit: number;
}

/** Option lists for the ledger's dependent dropdowns. */
export interface AdminFilterOptions {
  divisions: Array<{ id: string; name: string; code: string }>;
  units: Array<{
    id: string;
    name: string;
    unitCode: string;
    divisionId: string;
    /** The unit's parent sector (migration 010). Null for units outside the real roster. */
    sector: string | null;
  }>;
  agents: Array<{ id: string; name: string; mobileNumber: string; unitId: string }>;
  /** Distinct sectors present on active units, derived — see listFilterOptions. */
  sectors: string[];
}

export interface AgentDirectoryResponse {
  agents: AgentDirectoryEntry[];
  totals: {
    agents: number;
    ticketsIssued: number;
    seatsIssued: number;
  };
}
