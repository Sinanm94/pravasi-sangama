import type {
  ClientInteractionKind,
  ClientStatus,
  TicketType,
} from '@pravasi/shared';
import { query } from '../../db/index.js';

/**
 * Premium client records and their interaction timeline (migration 015).
 *
 * Its own module rather than part of modules/admin/ — the backend is
 * feature-sliced (§6.4), and "who have we spoken to and what did they say"
 * is a different feature from approvals, gates and the ticket ledger. It
 * happens to be superuser-only, which is a permission, not a category.
 *
 * NOT scoped per superuser. All three accounts see the same records by
 * design — on event day a colleague has to be able to pick up a client whose
 * usual contact is unreachable. Attribution is preserved per row instead
 * (`created_by`, and `author_*` on each interaction).
 */

export interface ClientRow {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  organisation: string | null;
  intended_tier: TicketType | null;
  status: ClientStatus;
  follow_up_on: string | null;
  ticket_id: string | null;
  ticket_number: string | null;
  created_at: Date;
  updated_at: Date;
  interaction_count: number;
  last_interaction_at: Date | null;
}

export interface ClientInteractionRow {
  id: string;
  kind: ClientInteractionKind;
  body: string;
  author_name: string | null;
  occurred_at: Date;
}

export interface ClientFilters {
  status?: ClientStatus | undefined;
  search?: string | undefined;
}

/**
 * Shared by the row query and the counts so the summary can never describe a
 * different set than the list — same discipline as the ticket ledger.
 */
function clientWhere(f: ClientFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const add = (fragment: (i: number) => string, value: unknown) => {
    params.push(value);
    clauses.push(fragment(params.length));
  };

  if (f.status) add((i) => `c.status = $${i}::client_status`, f.status);

  if (f.search) {
    // % and _ are ILIKE wildcards; escaping them keeps a literal search for
    // "_" from matching everything.
    const escaped = f.search.replace(/([\\%_])/g, '\\$1');
    add(
      (i) =>
        `(c.name ILIKE $${i} OR c.mobile ILIKE $${i}
          OR c.email ILIKE $${i} OR c.organisation ILIKE $${i})`,
      `%${escaped}%`,
    );
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

/**
 * The list.
 *
 * Interaction counts come from a LATERAL rather than a JOIN + GROUP BY: a
 * join would multiply each client row by its interaction count before
 * collapsing it again, and every client column would have to be repeated in
 * GROUP BY. Same pattern as listAgentDirectory.
 *
 * `::INT` on the count is not cosmetic — pg returns COUNT() as BIGINT, which
 * the driver hands back as a STRING to protect precision, and the UI would
 * then sort "10" before "9".
 */
export async function listClients(
  filters: ClientFilters,
  limit: number,
): Promise<ClientRow[]> {
  const { sql, params } = clientWhere(filters);

  const { rows } = await query<ClientRow>(
    `SELECT c.id, c.name, c.mobile, c.email, c.organisation,
            c.intended_tier, c.status,
            to_char(c.follow_up_on, 'YYYY-MM-DD') AS follow_up_on,
            c.ticket_id, t.ticket_number,
            c.created_at, c.updated_at,
            i.interaction_count, i.last_interaction_at
       FROM clients c
       LEFT JOIN tickets t ON t.id = c.ticket_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::INT      AS interaction_count,
                MAX(ci.occurred_at) AS last_interaction_at
           FROM client_interactions ci
          WHERE ci.client_id = c.id
       ) i ON TRUE
       ${sql}
      /* Anything overdue for a chase floats to the top, then anything with a
       * follow-up date at all, then most recently touched. This screen is a
       * worklist before it is a directory. */
      ORDER BY
        (c.follow_up_on IS NOT NULL
          AND c.follow_up_on <= CURRENT_DATE
          AND c.status NOT IN ('TICKETED', 'DECLINED')) DESC,
        c.follow_up_on ASC NULLS LAST,
        c.updated_at DESC
      LIMIT $${params.length + 1}`,
    [...params, limit],
  );
  return rows;
}

export async function summariseClients(
  filters: ClientFilters,
): Promise<{ total: number; awaitingReply: number; overdue: number }> {
  const { sql, params } = clientWhere(filters);

  const { rows } = await query<{
    total: number;
    awaitingreply: number;
    overdue: number;
  }>(
    `SELECT COUNT(*)::INT AS total,
            COUNT(*) FILTER (WHERE c.status = 'AWAITING_REPLY')::INT
              AS awaitingReply,
            COUNT(*) FILTER (
              WHERE c.follow_up_on IS NOT NULL
                AND c.follow_up_on <= CURRENT_DATE
                AND c.status NOT IN ('TICKETED', 'DECLINED')
            )::INT AS overdue
       FROM clients c
       ${sql}`,
    params,
  );

  /* pg lowercases unquoted output names, so `awaitingReply` arrives as
   * `awaitingreply`. Mapped here rather than quoting the alias, which would
   * make the SQL harder to read for the sake of one property. */
  const r = rows[0];
  return {
    total: r?.total ?? 0,
    awaitingReply: r?.awaitingreply ?? 0,
    overdue: r?.overdue ?? 0,
  };
}

export async function findClientById(id: string): Promise<ClientRow | null> {
  const { rows } = await query<ClientRow>(
    `SELECT c.id, c.name, c.mobile, c.email, c.organisation,
            c.intended_tier, c.status,
            to_char(c.follow_up_on, 'YYYY-MM-DD') AS follow_up_on,
            c.ticket_id, t.ticket_number,
            c.created_at, c.updated_at,
            i.interaction_count, i.last_interaction_at
       FROM clients c
       LEFT JOIN tickets t ON t.id = c.ticket_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::INT      AS interaction_count,
                MAX(ci.occurred_at) AS last_interaction_at
           FROM client_interactions ci
          WHERE ci.client_id = c.id
       ) i ON TRUE
      WHERE c.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listInteractions(
  clientId: string,
): Promise<ClientInteractionRow[]> {
  const { rows } = await query<ClientInteractionRow>(
    `SELECT id, kind, body, author_name, occurred_at
       FROM client_interactions
      WHERE client_id = $1
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT 500`,
    [clientId],
  );
  return rows;
}

export async function createClient(params: {
  name: string;
  mobile: string | null;
  email: string | null;
  organisation: string | null;
  intendedTier: TicketType | null;
  status: ClientStatus;
  followUpOn: string | null;
  createdBy: string;
}): Promise<{ id: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO clients
       (name, mobile, email, organisation, intended_tier, status,
        follow_up_on, created_by)
     VALUES ($1, $2, $3, $4, $5::ticket_type, $6::client_status, $7::DATE, $8)
     RETURNING id`,
    [
      params.name,
      params.mobile,
      params.email,
      params.organisation,
      params.intendedTier,
      params.status,
      params.followUpOn,
      params.createdBy,
    ],
  );
  return rows[0]!;
}

/**
 * Patch, not replace.
 *
 * Only keys actually present in the request are written, so two superusers
 * editing different fields of the same client do not clobber each other —
 * a full-row UPDATE would have the second save silently revert the first's
 * change to a field it never touched.
 *
 * `undefined` means "not supplied, leave alone"; `null` means "clear this",
 * which is why the schema distinguishes them.
 */
export async function updateClient(
  id: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const COLUMN_CASTS: Record<string, string> = {
    intended_tier: '::ticket_type',
    status: '::client_status',
    follow_up_on: '::DATE',
    ticket_id: '::uuid',
  };

  const sets: string[] = [];
  const params: unknown[] = [id];

  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}${COLUMN_CASTS[column] ?? ''}`);
  }

  if (sets.length === 0) return true; // nothing to do is not a failure

  const { rowCount } = await query(
    `UPDATE clients SET ${sets.join(', ')} WHERE id = $1`,
    params,
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteClient(id: string): Promise<boolean> {
  // client_interactions cascades — the timeline has no meaning without it.
  const { rowCount } = await query(`DELETE FROM clients WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function addInteraction(params: {
  clientId: string;
  kind: ClientInteractionKind;
  body: string;
  authorId: string;
  authorName: string | null;
  occurredAt: string | null;
}): Promise<{ id: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO client_interactions
       (client_id, kind, body, author_id, author_name, occurred_at)
     VALUES ($1, $2::client_interaction_kind, $3, $4, $5,
             COALESCE($6::TIMESTAMPTZ, NOW()))
     RETURNING id`,
    [
      params.clientId,
      params.kind,
      params.body,
      params.authorId,
      params.authorName,
      params.occurredAt,
    ],
  );
  return rows[0]!;
}

/**
 * The acting superuser's display name, for stamping onto a timeline entry.
 *
 * The JWT carries only `superuserId`, and the timeline has to read "ADMIN01
 * said…" months later — possibly after that account has been deactivated
 * (migration 012 does exactly that to the legacy ones). Capturing the name
 * at write time means the log stays readable regardless of what happens to
 * the account afterwards, which is the same reasoning audit_logs uses for
 * carrying no FK on actor_id.
 *
 * One indexed lookup per interaction write. This is not a hot path — a
 * superuser types a note by hand.
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
