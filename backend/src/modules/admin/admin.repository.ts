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
 * `approval_status = 'PENDING'` is the guard: two approvers acting on the
 * same row means exactly one UPDATE matches, so an approval cannot silently
 * overwrite a rejection made a second earlier.
 *
 * `restrictToAdminId` is how a UNIT_ADMIN's scope is enforced — as a SQL
 * predicate, not an app-level "if" a reviewer could miss. It is the admin's
 * own id, not a unit id: a unit_admin's scope is now the UNION of its own
 * `unit_admins.unit_id` (may be NULL) and every `unit_id` it has been handed
 * via `supervisor_unit_assignments` (a zone supervisor covering several
 * units — see migration 007). Resolving that inside the same UPDATE, rather
 * than precomputing a unit id list in the app, keeps the scope check
 * atomic with the decision — no separate lookup that could go stale between
 * "what units do I cover" and "commit the approval". Passing an admin id
 * that ends up covering zero matching units behaves exactly like a row that
 * was already decided; the controller cannot tell the two apart, which is
 * correct — neither is any of that caller's business. A superuser call
 * leaves this undefined and is unrestricted, per §2's "ultimate authority".
 */
export async function decideAgent(params: {
  agentId: string;
  decision: 'APPROVED' | 'REJECTED';
  approvedBy: string;
  approvedByRole: 'SUPERUSER' | 'UNIT_ADMIN';
  reason?: string | null;
  restrictToAdminId?: string;
}): Promise<{
  id: string;
  name: string;
  email: string | null;
  unit_id: string;
} | null> {
  const { rows } = await query<{
    id: string;
    name: string;
    email: string | null;
    unit_id: string;
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
        SET approval_status   = $2::approval_status,
            approved_at       = NOW(),
            approved_by       = $3,
            approved_by_role  = $6::actor_role,
            rejected_reason   = $4,
            -- A rejected account must not be able to authenticate at all.
            is_active        = ($2::approval_status = 'APPROVED')
      WHERE id = $1
        AND approval_status = 'PENDING'
        -- NULL means "no restriction" (a superuser). A UNIT_ADMIN call always
        -- supplies its own admin id here, never NULL — see
        -- unit-admin.controller. The OR covers a direct unit posting and a
        -- zone assignment identically; the caller does not know or care
        -- which one matched.
        AND (
          $5::uuid IS NULL
          OR unit_id = (SELECT unit_id FROM unit_admins WHERE id = $5::uuid)
          OR unit_id IN (
               SELECT unit_id FROM supervisor_unit_assignments
                WHERE admin_id = $5::uuid
             )
        )
     RETURNING id, name, email, unit_id`,
    [
      params.agentId,
      params.decision,
      params.approvedBy,
      params.reason ?? null,
      params.restrictToAdminId ?? null,
      params.approvedByRole,
    ],
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
  /** Defaults to SUPERUSER — every existing call site in this file is one. */
  actorRole?: 'SUPERUSER' | 'UNIT_ADMIN';
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (actor_role, actor_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES ($7::actor_role, $1, $2, $3, $4, $5, $6)`,
    [
      params.superuserId,
      params.action,
      params.entityType,
      params.entityId,
      JSON.stringify(params.metadata ?? {}),
      params.ip ?? null,
      params.actorRole ?? 'SUPERUSER',
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
  sector?: string | undefined;
  search?: string | undefined;
  status?: TicketStatus | undefined;
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
  /** The unit's parent sector (migration 010). Null outside the real roster. */
  unit_sector: string | null;
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
  if (f.status) add((i) => `t.status = $${i}::ticket_status`, f.status);

  /* Sector lives on `units`, not on `tickets` — unlike every other filter
   * here, which reads a column tickets denormalises at issuance.
   *
   * A subquery rather than a JOIN on purpose: summariseTicketsForAdmin()
   * selects `FROM tickets t` with no joins at all, and this builder is
   * shared by both queries precisely so the summary cards can never describe
   * a different set than the table. Adding a JOIN here would mean adding one
   * there too and keeping them in step forever; `unit_id IN (...)` needs
   * nothing from the outer query and stays correct in both. It is also
   * index-friendly — idx_units_sector (migration 010) feeds idx on
   * tickets.unit_id. */
  if (f.sector) {
    add(
      (i) => `t.unit_id IN (SELECT id FROM units WHERE sector = $${i})`,
      f.sector,
    );
  }

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
            t.unit_id, u.name AS unit_name, u.unit_code, u.sector AS unit_sector,
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
    sector: string | null;
  }>;
  agents: Array<{
    id: string;
    name: string;
    mobile_number: string;
    unit_id: string;
  }>;
  /**
   * Distinct sector names actually present on active units — derived, never
   * a hardcoded list. A sector that loses all its units disappears from the
   * filter on its own rather than offering a choice that matches nothing.
   */
  sectors: string[];
}

/** One round trip for every dropdown, rather than an endpoint each. */
export async function listFilterOptions(): Promise<FilterOptionRows> {
  const [divisions, units, agents, sectors] = await Promise.all([
    query<{ id: string; name: string; code: string }>(
      `SELECT id, name, code FROM divisions WHERE is_active ORDER BY name`,
    ),
    query<{
      id: string;
      name: string;
      unit_code: string;
      division_id: string;
      sector: string | null;
    }>(
      `SELECT id, name, unit_code, division_id, sector FROM units
        WHERE is_active ORDER BY name`,
    ),
    query<{ id: string; name: string; mobile_number: string; unit_id: string }>(
      `SELECT id, name, mobile_number, unit_id FROM agents
        WHERE is_active AND approval_status = 'APPROVED' ORDER BY name`,
    ),
    query<{ sector: string }>(
      `SELECT DISTINCT sector FROM units
        WHERE is_active AND sector IS NOT NULL AND TRIM(sector) <> ''
        ORDER BY sector`,
    ),
  ]);

  return {
    divisions: divisions.rows,
    units: units.rows,
    sectors: sectors.rows.map((r) => r.sector),
    agents: agents.rows,
  };
}

/* ------------------------------------------------------------------ */
/* Agent account control — the superuser fallback (§3.4)               */
/* ------------------------------------------------------------------ */

/**
 * Sets a new password hash for ANY agent. Unrestricted by design — this is
 * the superuser equivalent of the unit-admin reset, and with the Unit Admin
 * tier switched off it is the only recovery path an agent has.
 *
 * No scope predicate, deliberately: §2's "ultimate authority". Compare
 * unit-admin.repository.ts's `resetAgentPassword`, which carries the
 * OR-scope because that caller is bounded to its own units.
 */
export async function resetAnyAgentPassword(params: {
  agentId: string;
  passwordHash: string;
}): Promise<{ id: string; name: string; mobile_number: string } | null> {
  const { rows } = await query<{
    id: string;
    name: string;
    mobile_number: string;
  }>(
    `UPDATE agents
        SET pin_hash = $2
      WHERE id = $1
    RETURNING id, name, mobile_number`,
    [params.agentId, params.passwordHash],
  );
  return rows[0] ?? null;
}

/**
 * Switch an agent's account on or off.
 *
 * This exists because auto-approval (§3.4) closed the only route that used
 * to set `is_active = FALSE`: `decideAgent` matches `approval_status =
 * 'PENDING'`, and an auto-approved agent is never PENDING, so a rogue or
 * mistaken registration had NO in-app remedy at all. Deactivating is the
 * remedy — the row and its ticket history stay, but the account can no
 * longer authenticate (`agentLogin` refuses `!is_active`).
 */
export async function setAgentActive(
  agentId: string,
  isActive: boolean,
): Promise<{ id: string; name: string; is_active: boolean } | null> {
  const { rows } = await query<{
    id: string;
    name: string;
    is_active: boolean;
  }>(
    `UPDATE agents SET is_active = $2 WHERE id = $1
     RETURNING id, name, is_active`,
    [agentId, isActive],
  );
  return rows[0] ?? null;
}
