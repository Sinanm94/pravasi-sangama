import type { PoolClient } from 'pg';
import type { QrCodeKind, ScanResult, TicketType } from '@pravasi/shared';
import { query } from '../../db/index.js';

/* ------------------------------------------------------------------ */

export interface AdmittedRow {
  id: string;
  ticket_id: string;
  code_kind: QrCodeKind;
  guest_index: number | null;
}

export interface DiagnosticRow {
  id: string;
  ticket_id: string;
  code_kind: QrCodeKind;
  guest_index: number | null;
  code_status: 'ISSUED' | 'SCANNED' | 'REVOKED';
  scanned_at: Date | null;
  scanned_by_name: string | null;
  ticket_status: 'ACTIVE' | 'REVOKED';
}

export interface TicketSummaryRow {
  ticket_number: string;
  ticket_type: TicketType;
  purchaser_name: string;
  counted_persons: number;
  children_below_12: number;
  admitted_count: string; // COUNT() arrives as a string from pg
}

export interface ExistingScanRow {
  id: string;
  result: ScanResult;
  qr_code_id: string | null;
  ticket_id: string | null;
  gate_label: string | null;
  created_at: Date;
  code_kind: QrCodeKind | null;
  guest_index: number | null;
}

/* ------------------------------------------------------------------ */
/* The lock                                                            */
/* ------------------------------------------------------------------ */

/**
 * The single admission mechanism. Never read-then-write — the row is the lock.
 *
 * Two guards beyond `status = 'ISSUED'`:
 *
 *   code_kind = 'GUEST'   A LOCATION code must not be consumed. Guests rescan
 *                         it all evening; burning it on first use would turn
 *                         every later scan into a false DUPLICATE.
 *
 *   t.status = 'ACTIVE'   A revoked ticket's codes may still read ISSUED.
 *                         Joining the parent here keeps revocation atomic with
 *                         admission instead of a separate racy check.
 *
 * Exactly one concurrent transaction can match. Zero rows means the caller
 * must diagnose why — see findByHash.
 */
export async function admitGuestCode(
  client: PoolClient,
  qrHash: string,
  agentId: string,
): Promise<AdmittedRow | null> {
  const { rows } = await client.query<AdmittedRow>(
    `UPDATE qr_codes AS q
        SET status     = 'SCANNED',
            scanned_at = NOW(),
            scanned_by = $2
       FROM tickets AS t
      WHERE q.qr_hash    = $1
        AND q.status     = 'ISSUED'
        AND q.code_kind  = 'GUEST'
        AND t.id         = q.ticket_id
        AND t.status     = 'ACTIVE'
    RETURNING q.id, q.ticket_id, q.code_kind, q.guest_index`,
    [qrHash, agentId],
  );

  return rows[0] ?? null;
}

/** Why did the UPDATE match nothing? Only runs off the hot path. */
export async function findByHash(
  client: PoolClient,
  qrHash: string,
): Promise<DiagnosticRow | null> {
  const { rows } = await client.query<DiagnosticRow>(
    `SELECT q.id,
            q.ticket_id,
            q.code_kind,
            q.guest_index,
            q.status     AS code_status,
            q.scanned_at,
            a.name       AS scanned_by_name,
            t.status     AS ticket_status
       FROM qr_codes q
       JOIN tickets  t ON t.id = q.ticket_id
       LEFT JOIN agents a ON a.id = q.scanned_by
      WHERE q.qr_hash = $1`,
    [qrHash],
  );

  return rows[0] ?? null;
}

export async function ticketSummary(
  client: PoolClient,
  ticketId: string,
): Promise<TicketSummaryRow | null> {
  const { rows } = await client.query<TicketSummaryRow>(
    `SELECT t.ticket_number,
            t.ticket_type,
            t.purchaser_name,
            t.counted_persons,
            t.children_below_12,
            (SELECT COUNT(*)
               FROM qr_codes g
              WHERE g.ticket_id = t.id
                AND g.code_kind = 'GUEST'
                AND g.status    = 'SCANNED') AS admitted_count
       FROM tickets t
      WHERE t.id = $1`,
    [ticketId],
  );

  return rows[0] ?? null;
}

/** Which gate admitted this code the first time. DUPLICATE path only. */
export async function lastAdmissionGate(
  client: PoolClient,
  qrCodeId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ gate_label: string | null }>(
    `SELECT gate_label
       FROM scan_logs
      WHERE qr_code_id = $1 AND result = 'ADMITTED'
      ORDER BY created_at ASC
      LIMIT 1`,
    [qrCodeId],
  );

  return rows[0]?.gate_label ?? null;
}

/* ------------------------------------------------------------------ */
/* scan_logs                                                           */
/* ------------------------------------------------------------------ */

/**
 * Replay lookup. Runs before any state change, so a retried request returns
 * the original verdict rather than re-running the admission and reporting
 * DUPLICATE against its own earlier success.
 */
export async function findByClientScanId(
  clientScanId: string,
): Promise<ExistingScanRow | null> {
  const { rows } = await query<ExistingScanRow>(
    `SELECT s.id, s.result, s.qr_code_id, s.ticket_id, s.gate_label,
            s.created_at, q.code_kind, q.guest_index
       FROM scan_logs s
       LEFT JOIN qr_codes q ON q.id = s.qr_code_id
      WHERE s.client_scan_id = $1`,
    [clientScanId],
  );

  return rows[0] ?? null;
}

/**
 * Returns false when the insert was skipped because this client_scan_id was
 * already recorded — a concurrent duplicate of the same physical scan.
 */
export async function insertScanLog(
  client: PoolClient,
  params: {
    clientScanId: string | null;
    qrCodeId: string | null;
    ticketId: string | null;
    scannedHash: string;
    result: ScanResult;
    scannedBy: string;
    unitId: string;
    gateLabel: string | null;
    ip: string | null;
    /**
     * Capture time for offline replays. Defaults to NOW() for live scans.
     * This is what makes gate analytics reflect when people actually walked
     * through rather than when the network came back.
     */
    capturedAt?: Date | null;
  },
): Promise<boolean> {
  const { rowCount } = await client.query(
    `INSERT INTO scan_logs
       (client_scan_id, qr_code_id, ticket_id, scanned_hash,
        result, scanned_by, unit_id, gate_label, ip_address, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::TIMESTAMPTZ, NOW()))
     ON CONFLICT (client_scan_id) DO NOTHING`,
    [
      params.clientScanId,
      params.qrCodeId,
      params.ticketId,
      params.scannedHash,
      params.result,
      params.scannedBy,
      params.unitId,
      params.gateLabel,
      params.ip,
      params.capturedAt ?? null,
    ],
  );

  return (rowCount ?? 0) > 0;
}
