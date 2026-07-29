import type { PoolClient } from 'pg';
import type {
  AgentClaims,
  BulkSyncInput,
  BulkSyncItemResult,
  BulkSyncResponse,
  ScanReason,
  ScannedTicketSummary,
  VerifyScanInput,
  VerifyScanResponse,
} from '@pravasi/shared';
import {
  SCAN_REASON_TO_RESULT,
  SCAN_REASON_TO_STATUS,
  TICKET_TYPE_LABELS,
} from '@pravasi/shared';
import { withTransaction } from '../../db/index.js';
import { hashQrPayload } from '../../lib/identifiers.js';
import { publishScanSafely } from './scanning.events.js';
import * as repo from './scanning.repository.js';

/* ------------------------------------------------------------------ */

const MESSAGES: Record<ScanReason, string> = {
  ADMITTED: 'Admitted',
  LOCATION_INFO: 'Location pass — not an admission',
  ALREADY_SCANNED: 'Already scanned',
  CODE_REVOKED: 'This code has been revoked',
  TICKET_REVOKED: 'This ticket has been revoked',
  UNKNOWN_CODE: 'Unrecognised code',
};

interface ScanContext {
  ip?: string | null;
}

interface ResolveArgs {
  payload: string;
  clientScanId: string | null;
  gateLabel: string | null;
  /** Client capture time. Null for live scans, which use NOW(). */
  capturedAt: Date | null;
  scope: AgentClaims;
  ip: string | null;
}

function summaryOf(
  ticketId: string,
  row: repo.TicketSummaryRow,
): ScannedTicketSummary {
  return {
    ticketId,
    ticketNumber: row.ticket_number,
    ticketType: row.ticket_type,
    purchaserName: row.purchaser_name,
    countedPersons: row.counted_persons,
    childrenBelow12: row.children_below_12,
    admittedCount: Number(row.admitted_count),
  };
}

/* ================================================================== */
/* The core. Both endpoints go through this — there is exactly one     */
/* admission path in the system.                                       */
/* ================================================================== */

async function resolveScan(
  client: PoolClient,
  args: ResolveArgs,
): Promise<VerifyScanResponse> {
  const qrHash = hashQrPayload(args.payload);

  const logIt = (
    reason: ScanReason,
    qrCodeId: string | null,
    ticketId: string | null,
  ) =>
    repo.insertScanLog(client, {
      clientScanId: args.clientScanId,
      qrCodeId,
      ticketId,
      scannedHash: qrHash,
      result: SCAN_REASON_TO_RESULT[reason],
      scannedBy: args.scope.agentId,
      unitId: args.scope.unitId,
      gateLabel: args.gateLabel,
      ip: args.ip,
      capturedAt: args.capturedAt,
    });

  /* --- The lock ---------------------------------------------------- */
  const admitted = await repo.admitGuestCode(client, qrHash, args.scope.agentId);

  if (admitted) {
    const summary = await repo.ticketSummary(client, admitted.ticket_id);
    await logIt('ADMITTED', admitted.id, admitted.ticket_id);

    return respond({
      reason: 'ADMITTED',
      ticketId: admitted.ticket_id,
      codeKind: admitted.code_kind,
      guestIndex: admitted.guest_index,
      ticket: summary ? summaryOf(admitted.ticket_id, summary) : undefined,
    });
  }

  /* --- Zero rows: work out why ------------------------------------- */
  const found = await repo.findByHash(client, qrHash);

  if (!found) {
    await logIt('UNKNOWN_CODE', null, null);
    return respond({
      reason: 'UNKNOWN_CODE',
      ticketId: null,
      codeKind: null,
      guestIndex: null,
    });
  }

  const reason = diagnose(found);

  const summary =
    reason === 'LOCATION_INFO' || reason === 'ALREADY_SCANNED'
      ? await repo.ticketSummary(client, found.ticket_id)
      : null;

  await logIt(reason, found.id, found.ticket_id);

  const priorGate =
    reason === 'ALREADY_SCANNED'
      ? await repo.lastAdmissionGate(client, found.id)
      : null;

  return respond({
    reason,
    ticketId: found.ticket_id,
    codeKind: found.code_kind,
    guestIndex: found.guest_index,
    ticket: summary ? summaryOf(found.ticket_id, summary) : undefined,
    priorScan:
      reason === 'ALREADY_SCANNED' && found.scanned_at
        ? {
            scannedAt: found.scanned_at.toISOString(),
            agentName: found.scanned_by_name,
            gateLabel: priorGate,
          }
        : undefined,
  });
}

/* ================================================================== */
/* POST /api/scan/verify                                               */
/* ================================================================== */

export async function verifyScan(
  input: VerifyScanInput,
  scope: AgentClaims,
  ctx: ScanContext = {},
): Promise<VerifyScanResponse> {
  /* Replay check runs BEFORE any state change. A retry after a lost
   * response must return the original verdict — re-running the UPDATE
   * would find the code already SCANNED and report DUPLICATE against
   * this scan's own success. */
  if (input.client_scan_id) {
    const existing = await repo.findByClientScanId(input.client_scan_id);
    if (existing) return replayOf(existing);
  }

  const outcome = await withTransaction((client) =>
    resolveScan(client, {
      payload: input.payload,
      clientScanId: input.client_scan_id ?? null,
      gateLabel: input.gate_label ?? null,
      capturedAt: null, // live scan — the server clock is authoritative
      scope,
      ip: ctx.ip ?? null,
    }),
  );

  // After commit (§10.5). The dashboard must never see an admission that
  // could still roll back. Fire-and-forget — the gate does not wait.
  publishScanSafely({
    outcome,
    scope,
    gateLabel: input.gate_label ?? null,
    source: 'LIVE',
    capturedAt: null,
  });

  return outcome;
}

/* ================================================================== */
/* POST /api/scan/bulk-sync                                            */
/* ================================================================== */

export async function bulkSync(
  input: BulkSyncInput,
  scope: AgentClaims,
  ctx: ScanContext = {},
): Promise<BulkSyncResponse> {
  const now = Date.now();

  // Oldest capture first (§10.4): offline scans are replayed in the order
  // they physically happened, not in the order they arrived.
  const ordered = [...input.scans].sort(
    (a, b) =>
      Date.parse(a.offline_scanned_at) - Date.parse(b.offline_scanned_at),
  );

  const results: BulkSyncItemResult[] = [];
  const seen = new Set<string>();

  for (const scan of ordered) {
    // A client can resend the same id inside one batch; the DB would absorb
    // it, but resolving it twice would burn a transaction for nothing.
    if (seen.has(scan.client_scan_id)) continue;
    seen.add(scan.client_scan_id);

    try {
      const existing = await repo.findByClientScanId(scan.client_scan_id);
      if (existing) {
        results.push(itemOf(scan.client_scan_id, replayOf(existing)));
        continue;
      }

      // Device clocks drift and can run ahead. A future capture time would
      // corrupt gate timelines, so clamp it to arrival.
      const capturedAt = new Date(
        Math.min(Date.parse(scan.offline_scanned_at), now),
      );

      /* Each scan is its own transaction. One bad row must not roll back
       * the admissions either side of it — §10.4, results are per-item. */
      const outcome = await withTransaction((client) =>
        resolveScan(client, {
          payload: scan.payload,
          clientScanId: scan.client_scan_id,
          gateLabel: scan.gate_label ?? null,
          capturedAt,
          scope,
          ip: ctx.ip ?? null,
        }),
      );

      /* source: 'SYNC' turns an ALREADY_SCANNED into POST_SYNC_DUPLICATE —
       * the §10.4 case where two offline devices both admitted one code and
       * both people are already inside. That needs a louder alert than a
       * duplicate caught at the door. */
      publishScanSafely({
        outcome,
        scope,
        gateLabel: scan.gate_label ?? null,
        source: 'SYNC',
        capturedAt,
      });

      results.push(itemOf(scan.client_scan_id, outcome));
    } catch (err) {
      console.error('[scan] bulk-sync item failed', scan.client_scan_id, err);

      // Unsettled. The client must KEEP this one queued and retry.
      results.push({
        clientScanId: scan.client_scan_id,
        status: null,
        reason: null,
        ticketId: null,
        codeKind: null,
        guestIndex: null,
        replay: false,
        serverScannedAt: null,
        error: {
          code: 'SCAN_PROCESSING_FAILED',
          message: 'Could not process this scan. It remains queued.',
        },
      });
    }
  }

  const failed = results.filter((r) => r.error).length;

  return {
    results,
    accepted: results.length - failed,
    failed,
  };
}

function itemOf(
  clientScanId: string,
  outcome: VerifyScanResponse,
): BulkSyncItemResult {
  return {
    clientScanId,
    status: outcome.status,
    reason: outcome.reason,
    ticketId: outcome.ticketId,
    codeKind: outcome.codeKind,
    guestIndex: outcome.guestIndex,
    replay: outcome.replay,
    serverScannedAt: outcome.scannedAt,
  };
}

/* ------------------------------------------------------------------ */

function diagnose(row: repo.DiagnosticRow): ScanReason {
  // Order matters: ticket-level revocation outranks code state, so a revoked
  // ticket reads as TICKET_REVOKED rather than as a stale ISSUED code.
  if (row.ticket_status === 'REVOKED') return 'TICKET_REVOKED';
  if (row.code_status === 'REVOKED') return 'CODE_REVOKED';
  if (row.code_kind === 'LOCATION') return 'LOCATION_INFO';
  if (row.code_status === 'SCANNED') return 'ALREADY_SCANNED';

  // ISSUED + GUEST + ACTIVE ticket should have matched the UPDATE. Reaching
  // here means a concurrent transaction admitted it microseconds ago.
  return 'ALREADY_SCANNED';
}

function respond(args: {
  reason: ScanReason;
  ticketId: string | null;
  codeKind: VerifyScanResponse['codeKind'];
  guestIndex: number | null;
  ticket?: ScannedTicketSummary;
  priorScan?: VerifyScanResponse['priorScan'];
}): VerifyScanResponse {
  return {
    status: SCAN_REASON_TO_STATUS[args.reason],
    reason: args.reason,
    message: messageFor(args.reason, args.ticket),
    ticketId: args.ticketId,
    codeKind: args.codeKind,
    guestIndex: args.guestIndex,
    ticket: args.ticket,
    priorScan: args.priorScan,
    replay: false,
    scannedAt: new Date().toISOString(),
  };
}

function messageFor(reason: ScanReason, ticket?: ScannedTicketSummary): string {
  if (reason === 'ADMITTED' && ticket) {
    const label = TICKET_TYPE_LABELS[ticket.ticketType];
    return `Admitted — ${label}, ${ticket.admittedCount} of ${ticket.countedPersons}`;
  }
  return MESSAGES[reason];
}

/**
 * Rebuild the original verdict from the stored log row. The persisted
 * `scan_logs.result` is coarser than the wire `reason`, so REVOKED collapses
 * to CODE_REVOKED — the distinction between a revoked code and a revoked
 * ticket is not worth a second column to preserve across a replay.
 */
function replayOf(row: repo.ExistingScanRow): VerifyScanResponse {
  const reason: ScanReason =
    row.result === 'ADMITTED'
      ? 'ADMITTED'
      : row.result === 'LOCATION_INFO'
        ? 'LOCATION_INFO'
        : row.result === 'DUPLICATE'
          ? 'ALREADY_SCANNED'
          : row.result === 'REVOKED'
            ? 'CODE_REVOKED'
            : 'UNKNOWN_CODE';

  return {
    status: SCAN_REASON_TO_STATUS[reason],
    reason,
    message: MESSAGES[reason],
    ticketId: row.ticket_id,
    codeKind: row.code_kind,
    guestIndex: row.guest_index,
    replay: true,
    scannedAt: row.created_at.toISOString(),
  };
}
