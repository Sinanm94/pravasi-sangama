import type { TicketStatus, TicketType } from '@pravasi/shared';
import { query } from '../../db/index.js';

/* ------------------------------------------------------------------ */
/* Agent approval queue (spec §3)                                      */
/* ------------------------------------------------------------------ */

export interface PendingAgentRow {
  id: string;
  name: string;
  mobile_number: string;
  email: string | null;
  unit_code: string;
  unit_name: string;
  division_name: string;
  created_at: Date;
}

export async function listAgentsByStatus(
  status: 'PENDING' | 'APPROVED' | 'REJECTED',
): Promise<PendingAgentRow[]> {
  const { rows } = await query<PendingAgentRow>(
    `SELECT a.id, a.name, a.mobile_number, a.email,
            u.unit_code, u.name AS unit_name, d.name AS division_name,
            a.created_at
       FROM agents a
       JOIN units u     ON u.id = a.unit_id
       JOIN divisions d ON d.id = u.division_id
      WHERE a.approval_status = $1
      ORDER BY a.created_at DESC
      LIMIT 200`,
    [status],
  );
  return rows;
}

/**
 * Decides a pending registration.
 *
 * `approval_status = 'PENDING'` is the guard: two superusers acting on the
 * same row means exactly one UPDATE matches, so an approval cannot silently
 * overwrite a rejection made a second earlier.
 */
export async function decideAgent(params: {
  agentId: string;
  decision: 'APPROVED' | 'REJECTED';
  superuserId: string;
  reason?: string | null;
}): Promise<{ id: string; name: string; email: string | null } | null> {
  const { rows } = await query<{
    id: string;
    name: string;
    email: string | null;
  }>(
    /*
     * Both uses of $2 carry an explicit ::approval_status cast.
     *
     * Without it Postgres deduces the parameter's type twice — `approval_status`
     * from the SET assignment, `text` from the comparison against a bare
     * 'APPROVED' literal — and rejects the statement with 42P08
     * (ambiguous_parameter, "text versus approval_status"). Casting one use is
     * not enough; the two deductions must agree.
     */
    `UPDATE agents
        SET approval_status  = $2::approval_status,
            approved_at      = NOW(),
            approved_by      = $3,
            rejected_reason  = $4,
            -- A rejected account must not be able to authenticate at all.
            is_active        = ($2::approval_status = 'APPROVED')
      WHERE id = $1
        AND approval_status = 'PENDING'
     RETURNING id, name, email`,
    [params.agentId, params.decision, params.superuserId, params.reason ?? null],
  );
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Agent directory                                                     */
/* ------------------------------------------------------------------ */

export interface AgentDirectoryRow {
  id: string;
  name: string;
  mobile_number: string;
  email: string | null;
  unit_code: string;
  unit_name: string;
  division_name: string;
  is_active: boolean;
  created_at: Date;
  tickets_issued: number;
  tickets_revoked: number;
  seats_issued: number;
  last_issued_at: Date | null;
}

/**
 * Approved agents with their issuance totals.
 *
 * The counts come from a LATERAL subquery rather than a JOIN + GROUP BY.
 * Joining tickets directly would multiply each agent row by its ticket count
 * before collapsing it again, and every non-aggregated agent column would
 * have to be repeated in GROUP BY. The lateral runs one indexed lookup per
 * agent against idx_tickets_agent_created and returns exactly one row.
 *
 * `::INT` on each count matters: pg returns COUNT() as BIGINT, which the
 * driver hands back as a *string* to protect precision. Without the cast the
 * JSON would carry "42" and the UI would sort and total it as text.
 */
export async function listAgentDirectory(): Promise<AgentDirectoryRow[]> {
  const { rows } = await query<AgentDirectoryRow>(
    `SELECT a.id, a.name, a.mobile_number, a.email, a.is_active, a.created_at,
            u.unit_code, u.name AS unit_name, d.name AS division_name,
            t.tickets_issued, t.tickets_revoked, t.seats_issued,
            t.last_issued_at
       FROM agents a
       JOIN units u     ON u.id = a.unit_id
       JOIN divisions d ON d.id = u.division_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::INT AS tickets_issued,
                COUNT(*) FILTER (WHERE tk.status = 'REVOKED')::INT
                  AS tickets_revoked,
                COALESCE(
                  SUM(tk.counted_persons) FILTER (WHERE tk.status = 'ACTIVE'), 0
                )::INT AS seats_issued,
                MAX(tk.created_at) AS last_issued_at
           FROM tickets tk
          WHERE tk.agent_id = a.id
       ) t ON TRUE
      WHERE a.approval_status = 'APPROVED'
      -- Busiest first: this page exists to spot who is and is not working.
      ORDER BY t.tickets_issued DESC, a.name ASC
      LIMIT 500`,
  );
  return rows;
}

/* ------------------------------------------------------------------ */
/* Gates (spec §2, Option A)                                           */
/* ------------------------------------------------------------------ */

export interface GateSummaryRow {
  id: string;
  gate_code: string;
  name: string;
  division_name: string | null;
  is_active: boolean;
  pin_rotated_at: Date;
  pin_valid_on: string | null;
}

export async function listGates(): Promise<GateSummaryRow[]> {
  const { rows } = await query<GateSummaryRow>(
    `SELECT g.id, g.gate_code, g.name, d.name AS division_name,
            g.is_active, g.pin_rotated_at,
            to_char(g.pin_valid_on, 'YYYY-MM-DD') AS pin_valid_on
       FROM gates g
       LEFT JOIN divisions d ON d.id = g.division_id
      ORDER BY g.name`,
  );
  return rows;
}

export async function findDivisionIdByCode(
  code: string,
): Promise<string | null> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM divisions WHERE code = $1`,
    [code],
  );
  return rows[0]?.id ?? null;
}

export async function createGate(params: {
  gateCode: string;
  name: string;
  divisionId: string | null;
  pinHash: string;
  pinValidOn: string | null;
}): Promise<{ id: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO gates (gate_code, name, division_id, pin_hash, pin_valid_on)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      params.gateCode,
      params.name,
      params.divisionId,
      params.pinHash,
      params.pinValidOn,
    ],
  );
  return rows[0]!;
}

/**
 * Rotating the PIN also revokes every live session for that gate. A rotation
 * exists precisely because the old PIN is no longer trusted, so leaving
 * tokens minted from it alive would defeat the point.
 */
export async function rotateGatePin(params: {
  gateId: string;
  pinHash: string;
  pinValidOn: string | null;
}): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE gates
        SET pin_hash = $2, pin_valid_on = $3, pin_rotated_at = NOW()
      WHERE id = $1`,
    [params.gateId, params.pinHash, params.pinValidOn],
  );

  if ((rowCount ?? 0) === 0) return false;

  await query(
    `UPDATE gate_sessions SET revoked_at = NOW()
      WHERE gate_id = $1 AND revoked_at IS NULL`,
    [params.gateId],
  );

  return true;
}

export async function setGateActive(
  gateId: string,
  isActive: boolean,
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE gates SET is_active = $2 WHERE id = $1`,
    [gateId, isActive],
  );

  if (!isActive) {
    await query(
      `UPDATE gate_sessions SET revoked_at = NOW()
        WHERE gate_id = $1 AND revoked_at IS NULL`,
      [gateId],
    );
  }

  return (rowCount ?? 0) > 0;
}

export async function writeAudit(params: {
  superuserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (actor_role, actor_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES ('SUPERUSER', $1, $2, $3, $4, $5, $6)`,
    [
      params.superuserId,
      params.action,
      params.entityType,
      params.entityId,
      JSON.stringify(params.metadata ?? {}),
      params.ip ?? null,
    ],
  );
}

/* ------------------------------------------------------------------ */
/* Master ticket ledger                                                */
/* ------------------------------------------------------------------ */

export interface TicketLedgerFilters {
  agentId?: string | undefined;
  unitId?: string | undefined;
  divisionId?: string | undefined;
  search?: string | undefined;
}

export interface AdminTicketLedgerRow {
  id: string;
  request_number: string;
  ticket_number: string;
  ticket_type: TicketType;
  purchaser_name: string;
  purchaser_mobile: string;
  purchaser_email: string | null;
  counted_persons: number;
  children_below_12: number;
  status: TicketStatus;
  created_at: Date;
  agent_id: string;
  agent_name: string;
  unit_id: string;
  unit_name: string;
  unit_code: string;
  division_id: string;
  division_name: string;
}

/**
 * Builds the shared WHERE clause for the ledger.
 *
 * Both the row query and the totals query run through this, so the summary
 * cards can never describe a different set than the table below them.
 *
 * Every value is a bound parameter — nothing is interpolated. The ids are
 * already UUID-validated by AdminTicketQuerySchema before they reach here.
 */
function ticketLedgerWhere(f: TicketLedgerFilters): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const add = (fragment: (i: number) => string, value: unknown) => {
    params.push(value);
    clauses.push(fragment(params.length));
  };

  /* Filtering on tickets' own denormalised columns rather than joining up
   * through units/divisions: the ids are written at issuance and indexed. */
  if (f.agentId) add((i) => `t.agent_id = $${i}`, f.agentId);
  if (f.unitId) add((i) => `t.unit_id = $${i}`, f.unitId);
  if (f.divisionId) add((i) => `t.division_id = $${i}`, f.divisionId);

  if (f.search) {
    /* % and _ are ILIKE wildcards. Left unescaped, a search for "%" matches
     * every ticket and a search for "_" matches on any single character —
     * confusing rather than dangerous, but wrong. \\ is the escape char. */
    const escaped = f.search.replace(/([\\%_])/g, '\\$1');
    add(
      (i) =>
        `(t.purchaser_name ILIKE $${i} OR t.purchaser_mobile ILIKE $${i}
          OR t.ticket_number ILIKE $${i} OR t.request_number ILIKE $${i})`,
      `%${escaped}%`,
    );
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export async function listTicketsForAdmin(
  filters: TicketLedgerFilters,
  limit: number,
): Promise<AdminTicketLedgerRow[]> {
  const { sql, params } = ticketLedgerWhere(filters);

  const { rows } = await query<AdminTicketLedgerRow>(
    `SELECT t.id, t.request_number, t.ticket_number, t.ticket_type,
            t.purchaser_name, t.purchaser_mobile, t.purchaser_email,
            t.counted_persons, t.children_below_12, t.status, t.created_at,
            t.agent_id, a.name AS agent_name,
            t.unit_id, u.name AS unit_name, u.unit_code,
            t.division_id, d.name AS division_name
       FROM tickets t
       JOIN agents a    ON a.id = t.agent_id
       JOIN units u     ON u.id = t.unit_id
       JOIN divisions d ON d.id = t.division_id
       ${sql}
      ORDER BY t.created_at DESC
      LIMIT $${params.length + 1}`,
    [...params, limit],
  );
  return rows;
}

/**
 * Totals over the ENTIRE filtered set, independent of the row cap.
 *
 * Revoked tickets are counted in `tickets` — an admin auditing what was
 * issued needs to see them — but excluded from seats and children, because
 * nobody is seated or catered for on a cancelled ticket.
 */
export async function summariseTicketsForAdmin(
  filters: TicketLedgerFilters,
): Promise<{ tickets: number; seats: number; children: number }> {
  const { sql, params } = ticketLedgerWhere(filters);

  const { rows } = await query<{
    tickets: number;
    seats: number;
    children: number;
  }>(
    `SELECT COUNT(*)::INT AS tickets,
            COALESCE(SUM(t.counted_persons)
              FILTER (WHERE t.status = 'ACTIVE'), 0)::INT AS seats,
            COALESCE(SUM(t.children_below_12)
              FILTER (WHERE t.status = 'ACTIVE'), 0)::INT AS children
       FROM tickets t
       ${sql}`,
    params,
  );

  return rows[0] ?? { tickets: 0, seats: 0, children: 0 };
}

export interface FilterOptionRows {
  divisions: Array<{ id: string; name: string; code: string }>;
  units: Array<{
    id: string;
    name: string;
    unit_code: string;
    division_id: string;
  }>;
  agents: Array<{
    id: string;
    name: string;
    mobile_number: string;
    unit_id: string;
  }>;
}

/** One round trip for all three dropdowns, rather than three endpoints. */
export async function listFilterOptions(): Promise<FilterOptionRows> {
  const [divisions, units, agents] = await Promise.all([
    query<{ id: string; name: string; code: string }>(
      `SELECT id, name, code FROM divisions WHERE is_active ORDER BY name`,
    ),
    query<{ id: string; name: string; unit_code: string; division_id: string }>(
      `SELECT id, name, unit_code, division_id FROM units
        WHERE is_active ORDER BY name`,
    ),
    query<{ id: string; name: string; mobile_number: string; unit_id: string }>(
      `SELECT id, name, mobile_number, unit_id FROM agents
        WHERE is_active AND approval_status = 'APPROVED' ORDER BY name`,
    ),
  ]);

  return {
    divisions: divisions.rows,
    units: units.rows,
    agents: agents.rows,
  };
}
