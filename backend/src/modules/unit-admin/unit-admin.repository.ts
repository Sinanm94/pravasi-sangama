import { query } from '../../db/index.js';

/**
 * A unit admin's own approvals queue.
 *
 * Deliberately its own module, not folded into modules/admin/ — the backend
 * is feature-sliced (CLAUDE.md §6.4), and "a unit head's approval screen"
 * and "the superuser's global approval screen" are different features that
 * happen to share a table, not one feature with two callers.
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
