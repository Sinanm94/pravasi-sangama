import { query } from '../../db/index.js';
// Row shape only — a ticket carries the same columns regardless of who is
// allowed to see it. Reusing the type does not fold this module into
// modules/admin/; the query below is entirely separate and scoped.
import type { AdminTicketLedgerRow } from '../admin/admin.repository.js';

/**
 * A unit admin's own approvals queue, and its own ticket ledger.
 *
 * Deliberately its own module, not folded into modules/admin/ — the backend
 * is feature-sliced (CLAUDE.md §6.4), and "a unit head's approval screen"
 * and "the superuser's global approval screen" are different features that
 * happen to share tables, not one feature with two callers.
 */

export interface UnitScopedAgentRow {
  id: string;
  name: string;
  mobile_number: string;
  email: string | null;
  unit_code: string;
  unit_name: string;
  division_name: string;
  created_at: Date;
}

/**
 * Every PENDING and APPROVED agent within one admin's scope.
 *
 * Scope is the UNION of two things, resolved entirely in SQL from `adminId`
 * — the caller's own verified token (unit-admin.controller.ts), never a
 * request parameter, same bottom-up rule as an agent's own unit scope (§2):
 *
 *   1. the admin's own direct posting — `unit_admins.unit_id`
 *   2. every unit handed to it via `supervisor_unit_assignments`
 *      (migration 007) — a zone supervisor covering several units
 *
 * An admin with neither (freshly provisioned, not yet assigned anything)
 * satisfies neither branch and both queries return empty — no separate
 * "unscoped" code path needed here; see unit-admin.controller.ts for the
 * one place that still distinguishes "no scope at all" for a clearer error
 * on a decision attempt.
 *
 * Two queries rather than one with a status filter: the dashboard renders
 * pending and approved completely differently (§ frontend), and returning
 * them pre-split means the client can never conflate a name mix-up between
 * the two into showing an Approve button on an already-decided row.
 */
export async function listAgentsForAdmin(adminId: string): Promise<{
  pending: UnitScopedAgentRow[];
  approved: UnitScopedAgentRow[];
}> {
  const sql = `
    SELECT a.id, a.name, a.mobile_number, a.email,
           u.unit_code, u.name AS unit_name, d.name AS division_name,
           a.created_at
      FROM agents a
      JOIN units u     ON u.id = a.unit_id
      JOIN divisions d ON d.id = u.division_id
     WHERE a.approval_status = $2::approval_status
       AND (
         a.unit_id = (SELECT unit_id FROM unit_admins WHERE id = $1)
         OR a.unit_id IN (
              SELECT unit_id FROM supervisor_unit_assignments
               WHERE admin_id = $1
            )
       )
     ORDER BY a.created_at DESC
     LIMIT 200`;

  const [pending, approved] = await Promise.all([
    query<UnitScopedAgentRow>(sql, [adminId, 'PENDING']),
    query<UnitScopedAgentRow>(sql, [adminId, 'APPROVED']),
  ]);

  return { pending: pending.rows, approved: approved.rows };
}

/**
 * Whether this admin has anything to see at all — own unit posting or any
 * zone assignment. Used only to give a decision attempt a clear "you're not
 * assigned to anything yet" 403 instead of a generic "already decided"
 * conflict; `listAgentsForAdmin` above needs no equivalent check because an
 * unscoped admin's queries naturally return empty on their own.
 */
export async function adminHasScope(adminId: string): Promise<boolean> {
  const { rows } = await query<{ has_scope: boolean }>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM unit_admins
          WHERE id = $1 AND unit_id IS NOT NULL
       )
       OR EXISTS (
         SELECT 1 FROM supervisor_unit_assignments WHERE admin_id = $1
       )
     ) AS has_scope`,
    [adminId],
  );
  return rows[0]?.has_scope ?? false;
}

/* ------------------------------------------------------------------ */
/* Agent invite PINs — the admin's own units only                      */
/* ------------------------------------------------------------------ */

export interface UnitInvitePinRow {
  unit_code: string;
  unit_name: string;
  sector: string | null;
  /** NULL when no readable copy was ever recorded — see migration 011. */
  agent_invite_pin: string | null;
  /** Whether a working PIN exists at all, independent of readability. */
  has_pin: boolean;
}

/**
 * Every unit in this admin's scope, with the invite PIN they hand to their
 * agents (§3.2). A zone supervisor covers many units, so this is a list, not
 * a single value.
 *
 * Same OR-scope predicate as every other query in this module — an admin
 * cannot read a PIN for a unit outside their own direct posting or zone
 * assignments, enforced in SQL rather than filtered afterwards.
 *
 * `has_pin` is derived from the HASH, not from the readable copy, because
 * the hash is what actually verifies at the gateway. That separation is what
 * lets the dashboard distinguish "no PIN configured for this unit at all"
 * from "there is a working PIN but nobody recorded a readable copy" — two
 * different problems with two different fixes.
 */
export async function listInvitePinsForAdmin(
  adminId: string,
): Promise<UnitInvitePinRow[]> {
  const { rows } = await query<UnitInvitePinRow>(
    `SELECT u.unit_code,
            u.name AS unit_name,
            u.sector,
            u.agent_invite_pin,
            (u.agent_invite_pin_hash IS NOT NULL) AS has_pin
       FROM units u
      WHERE u.is_active
        AND (
          u.id = (SELECT unit_id FROM unit_admins WHERE id = $1)
          OR u.id IN (
               SELECT unit_id FROM supervisor_unit_assignments
                WHERE admin_id = $1
             )
        )
      ORDER BY u.sector NULLS LAST, u.name`,
    [adminId],
  );
  return rows;
}

/* ------------------------------------------------------------------ */
/* Ticket ledger — scoped to the admin's own units                     */
/* ------------------------------------------------------------------ */

export interface UnitAdminTicketFilters {
  agentId?: string | undefined;
  search?: string | undefined;
}

/**
 * The scope predicate — identical shape to `decideAgent`'s in
 * admin.repository.ts, and it MUST stay that way: this is the same
 * "direct unit_id OR a supervisor_unit_assignments row" union, just applied
 * to `tickets.unit_id` instead of `agents.unit_id`. It is always clause[0]
 * and it is never optional — unlike `agentId`/`search` below, there is no
 * code path that calls this without it. A caller cannot broaden the query
 * by omitting a filter, because the one filter that matters is not a filter
 * at all, it's baked into every row this function can ever return.
 */
function unitAdminTicketWhere(
  adminId: string,
  filters: UnitAdminTicketFilters,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [adminId];
  const clauses: string[] = [
    `(t.unit_id = (SELECT unit_id FROM unit_admins WHERE id = $1)
       OR t.unit_id IN (
            SELECT unit_id FROM supervisor_unit_assignments WHERE admin_id = $1
          ))`,
  ];

  const add = (fragment: (i: number) => string, value: unknown) => {
    params.push(value);
    clauses.push(fragment(params.length));
  };

  if (filters.agentId) add((i) => `t.agent_id = $${i}`, filters.agentId);

  if (filters.search) {
    // Same ILIKE-escaping as admin.repository.ts's ticketLedgerWhere — % and
    // _ are wildcards to Postgres and must not be taken from user input raw.
    const escaped = filters.search.replace(/([\\%_])/g, '\\$1');
    add(
      (i) =>
        `(t.purchaser_name ILIKE $${i} OR t.purchaser_mobile ILIKE $${i}
          OR t.ticket_number ILIKE $${i} OR t.request_number ILIKE $${i})`,
      `%${escaped}%`,
    );
  }

  return { sql: `WHERE ${clauses.join(' AND ')}`, params };
}

export async function listTicketsForAdmin(
  adminId: string,
  filters: UnitAdminTicketFilters,
  limit: number,
): Promise<AdminTicketLedgerRow[]> {
  const { sql, params } = unitAdminTicketWhere(adminId, filters);

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
 * Totals over the entire scoped+filtered set, independent of the row cap —
 * same reasoning as admin.repository.ts's summariseTicketsForAdmin: the row
 * list is capped and would under-report the moment scope + filters match
 * more than `limit`.
 */
export async function summariseTicketsForAdmin(
  adminId: string,
  filters: UnitAdminTicketFilters,
): Promise<{ tickets: number; seats: number; children: number }> {
  const { sql, params } = unitAdminTicketWhere(adminId, filters);

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

/* ------------------------------------------------------------------ */
/* Agent password rotation — the admin's own agents only               */
/* ------------------------------------------------------------------ */

/**
 * Sets a new password hash for one agent, but ONLY if that agent sits inside
 * this admin's scope.
 *
 * The scope check is the same OR-predicate as `decideAgent` and every other
 * query in this module, and it lives in the UPDATE's WHERE clause rather
 * than in a preceding SELECT: an agent outside the caller's units matches
 * zero rows at the database level, so there is no window between "may I?"
 * and "do it", and no app-level branch a reviewer could miss.
 *
 * Returns null for both "no such agent" and "not yours", which the caller
 * must not distinguish — a unit head has no business learning that an agent
 * id outside their scope exists.
 */
export async function resetAgentPassword(params: {
  adminId: string;
  agentId: string;
  passwordHash: string;
}): Promise<{ id: string; name: string; mobile_number: string } | null> {
  const { rows } = await query<{
    id: string;
    name: string;
    mobile_number: string;
  }>(
    `UPDATE agents
        SET pin_hash = $3
      WHERE id = $2
        AND (
          unit_id = (SELECT unit_id FROM unit_admins WHERE id = $1)
          OR unit_id IN (
               SELECT unit_id FROM supervisor_unit_assignments
                WHERE admin_id = $1
             )
        )
    RETURNING id, name, mobile_number`,
    [params.adminId, params.agentId, params.passwordHash],
  );
  return rows[0] ?? null;
}
