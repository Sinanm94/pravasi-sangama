import type { ActivityPriority } from '@pravasi/shared';
import { query } from '../../db/index.js';

/**
 * The organiser's own task list (migration 018).
 *
 * Its own module rather than part of modules/admin/ — the backend is
 * feature-sliced (§6.4), and "what do I still have to do" is a different
 * feature from approvals, gates and ledgers. Superuser-only is a
 * permission, not a category.
 *
 * NOT scoped per superuser: all three see every task, with the owner shown
 * on the row. Same decision, and the same reason, as `clients` (015) — on
 * event day a colleague has to be able to pick up work whose owner is
 * unreachable.
 */

export interface ActivityRow {
  id: string;
  title: string;
  notes: string | null;
  priority: ActivityPriority;
  due_on: string | null;
  done_at: Date | null;
  created_by_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ActivityFilters {
  state?: 'open' | 'done' | undefined;
  assignedTo?: string | undefined;
  search?: string | undefined;
}

/** Shared by the rows query and the counts, so they can never disagree. */
function activityWhere(f: ActivityFilters): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const add = (fragment: (i: number) => string, value: unknown) => {
    params.push(value);
    clauses.push(fragment(params.length));
  };

  /* done_at IS NULL is the whole definition of "open" — there is no second
   * boolean that could contradict it (see migration 018's header). */
  if (f.state === 'open') clauses.push('a.done_at IS NULL');
  if (f.state === 'done') clauses.push('a.done_at IS NOT NULL');

  if (f.assignedTo) add((i) => `a.assigned_to = $${i}::uuid`, f.assignedTo);

  if (f.search) {
    // % and _ are ILIKE wildcards; escaped so a literal search for "_"
    // does not match everything.
    const escaped = f.search.replace(/([\\%_])/g, '\\$1');
    add(
      (i) => `(a.title ILIKE $${i} OR a.notes ILIKE $${i})`,
      `%${escaped}%`,
    );
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export async function listActivities(
  filters: ActivityFilters,
  limit: number,
): Promise<ActivityRow[]> {
  const { sql, params } = activityWhere(filters);

  const { rows } = await query<ActivityRow>(
    `SELECT a.id, a.title, a.notes, a.priority,
            to_char(a.due_on, 'YYYY-MM-DD') AS due_on,
            a.done_at, a.created_by_name,
            a.assigned_to, a.assigned_to_name,
            a.created_at, a.updated_at
       FROM activities a
       ${sql}
      /* Open work first, then the most urgent by date, then priority, and
       * only then recency. This screen is a worklist: the top of it must be
       * what to do next, not what was typed last. */
      ORDER BY (a.done_at IS NULL) DESC,
               a.due_on ASC NULLS LAST,
               CASE a.priority
                 WHEN 'HIGH' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2
               END ASC,
               a.created_at DESC
      LIMIT $${params.length + 1}`,
    [...params, limit],
  );
  return rows;
}

export async function summariseActivities(
  filters: ActivityFilters,
): Promise<{ total: number; open: number; overdue: number; done: number }> {
  const { sql, params } = activityWhere(filters);

  const { rows } = await query<{
    total: number;
    open: number;
    overdue: number;
    done: number;
  }>(
    `SELECT COUNT(*)::INT AS total,
            COUNT(*) FILTER (WHERE a.done_at IS NULL)::INT AS open,
            COUNT(*) FILTER (
              WHERE a.done_at IS NULL
                AND a.due_on IS NOT NULL
                AND a.due_on <= CURRENT_DATE
            )::INT AS overdue,
            COUNT(*) FILTER (WHERE a.done_at IS NOT NULL)::INT AS done
       FROM activities a
       ${sql}`,
    params,
  );

  const r = rows[0];
  return {
    total: r?.total ?? 0,
    open: r?.open ?? 0,
    overdue: r?.overdue ?? 0,
    done: r?.done ?? 0,
  };
}

export async function findActivityById(
  id: string,
): Promise<ActivityRow | null> {
  const { rows } = await query<ActivityRow>(
    `SELECT a.id, a.title, a.notes, a.priority,
            to_char(a.due_on, 'YYYY-MM-DD') AS due_on,
            a.done_at, a.created_by_name,
            a.assigned_to, a.assigned_to_name,
            a.created_at, a.updated_at
       FROM activities a
      WHERE a.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createActivity(params: {
  title: string;
  notes: string | null;
  priority: ActivityPriority;
  dueOn: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  createdBy: string;
  createdByName: string | null;
}): Promise<{ id: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO activities
       (title, notes, priority, due_on, assigned_to, assigned_to_name,
        created_by, created_by_name)
     VALUES ($1, $2, $3::activity_priority, $4::DATE, $5::uuid, $6, $7, $8)
     RETURNING id`,
    [
      params.title,
      params.notes,
      params.priority,
      params.dueOn,
      params.assignedTo,
      params.assignedToName,
      params.createdBy,
      params.createdByName,
    ],
  );
  return rows[0]!;
}

/**
 * Patch, not replace — only keys actually supplied are written, so two
 * superusers editing different fields cannot clobber each other. Same rule
 * as `clients.updateClient`.
 *
 * `done` arrives as a boolean and is translated to a timestamp HERE, on the
 * server: the client says "tick this off", the server decides when that
 * was. Accepting a client-supplied `done_at` would import whatever a shared
 * phone's clock happens to say.
 */
export async function updateActivity(
  id: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const COLUMN_CASTS: Record<string, string> = {
    priority: '::activity_priority',
    due_on: '::DATE',
    assigned_to: '::uuid',
  };

  const sets: string[] = [];
  const params: unknown[] = [id];

  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    if (column === 'done') {
      // NOW() rather than a parameter — the server's clock is the authority.
      sets.push(value === true ? 'done_at = NOW()' : 'done_at = NULL');
      continue;
    }

    params.push(value);
    sets.push(`${column} = $${params.length}${COLUMN_CASTS[column] ?? ''}`);
  }

  if (sets.length === 0) return true; // nothing to do is not a failure

  const { rowCount } = await query(
    `UPDATE activities SET ${sets.join(', ')} WHERE id = $1`,
    params,
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteActivity(id: string): Promise<boolean> {
  const { rowCount } = await query(`DELETE FROM activities WHERE id = $1`, [
    id,
  ]);
  return (rowCount ?? 0) > 0;
}

/** Every superuser, for the "assign to" picker. */
export async function listSuperusers(): Promise<
  Array<{ id: string; label: string }>
> {
  const { rows } = await query<{ id: string; label: string }>(
    `SELECT id, COALESCE(NULLIF(TRIM(name), ''), username) AS label
       FROM superusers
      WHERE is_active
      ORDER BY label ASC`,
  );
  return rows;
}

/**
 * A superuser's display name, stamped onto rows at write time.
 *
 * Same reasoning as `clients.superuserDisplayName` and `audit_logs`: this
 * list is read months later, possibly after the account was deactivated,
 * and "assigned to someone" is worth much less than "assigned to ADMIN02".
 */
export async function superuserDisplayName(
  superuserId: string,
): Promise<string | null> {
  const { rows } = await query<{ label: string }>(
    `SELECT COALESCE(NULLIF(TRIM(name), ''), username) AS label
       FROM superusers WHERE id = $1`,
    [superuserId],
  );
  return rows[0]?.label ?? null;
}
