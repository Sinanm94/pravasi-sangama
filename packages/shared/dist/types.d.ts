import type { ApprovalStatus, AuthRole, QrCodeKind, QrCodeStatus, ScanReason, ScanResult, ScanStatus, TicketStatus, TicketType } from './constants.js';
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
/** Step 1 complete. Authenticates, but cannot issue tickets. */
export interface UnitPendingClaims {
    role: Extract<AuthRole, 'UNIT_PENDING'>;
    sessionId: string;
    unitId: string;
    divisionId: string;
}
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
export type SessionClaims = UnitPendingClaims | AgentClaims | ScannerClaims | SuperuserClaims;
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
    error?: {
        code: string;
        message: string;
    };
}
export interface BulkSyncResponse {
    results: BulkSyncItemResult[];
    /** Settled — safe for the client to drop. */
    accepted: number;
    /** Failed — the client must keep these queued. */
    failed: number;
}
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
/** Socket.io namespace. Superuser JWT required on handshake. */
export declare const LIVE_NAMESPACE = "/live";
export declare const LIVE_EVENTS: {
    /** Coalesced batch of scan events, flushed on a 1s tick. */
    readonly FEED: "scan:feed";
    /** Exceptions only, emitted immediately so alerts are not delayed. */
    readonly ALERT: "scan:alert";
};
/**
 * `POST_SYNC_DUPLICATE` is the §10.4 case: an offline device admitted a guest
 * whose code another device had already consumed. Both people are inside. It
 * is deliberately distinct from a live DUPLICATE, which was stopped at the
 * door.
 */
export type ScanAlertType = 'ADMITTED' | 'LOCATION_INFO' | 'DUPLICATE' | 'POST_SYNC_DUPLICATE' | 'INVALID';
export interface LiveScanEvent extends RecentScanEntry {
    alertType: ScanAlertType;
    /** LIVE = at the gate in real time. SYNC = replayed from an offline queue. */
    source: 'LIVE' | 'SYNC';
}
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
export interface ApiError {
    error: {
        code: string;
        message: string;
        details?: unknown;
    };
}
/** What /auth/unit-login and /auth/agent-login return alongside the cookie. */
export interface SessionResponse {
    role: AuthRole;
    unit?: Pick<Unit, 'id' | 'unitCode' | 'name' | 'sector'>;
    division?: Pick<Division, 'id' | 'name' | 'code'>;
    agent?: Pick<Agent, 'id' | 'name' | 'mobileNumber'>;
    gate?: {
        id: string;
        gateCode: string;
        name: string;
    };
    expiresAt: string;
}
/** What signup returns. No session — approval comes first (spec §3). */
export interface AgentSignupResponse {
    status: ApprovalStatus;
    message: string;
    agent: {
        id: string;
        name: string;
        mobileNumber: string;
        email: string;
    };
}
/** Public, unauthenticated: the unit picker on the signup form. */
export interface PublicUnit {
    unitCode: string;
    name: string;
    sector: string | null;
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
export interface GateSummary {
    id: string;
    gateCode: string;
    name: string;
    divisionName: string | null;
    isActive: boolean;
    pinRotatedAt: string;
    pinValidOn: string | null;
}
//# sourceMappingURL=types.d.ts.map