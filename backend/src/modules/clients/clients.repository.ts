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
  unit_id: string | null;
  unit_code: string | null;
  unit_name: string | null;
  sector: string | null;
  referred_by: string | null;
  is_member: boolean | null;
  source: string;
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
  unitId?: string | undefined;
  sector?: string | undefined;
  referredBy?: string | undefined;
  isMember?: boolean | undefined;
  source?: string | undefined;
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

  if (f.unitId) add((i) => `c.unit_id = $${i}::uuid`, f.unitId);

  /* Matches the same COALESCE the SELECT returns, so the filter can never
   * disagree with what the row displays. Compared case-insensitively and
   * trimmed because `units.sector` is free text with no CHECK (Known debt
   * 7) and the imported values are typed by hand. */
  if (f.sector)
    add(
      (i) =>
        `upper(trim(COALESCE(u.sector, c.sector))) = upper(trim($${i}))`,
      f.sector,
    );

  /* Matched case- and whitespace-insensitively, and indexed the same way
   * (019): these names are typed by hand off a WhatsApp list, so "Sabir"
   * and "sabir " are the same volunteer. */
  if (f.referredBy)
    add(
      (i) => `lower(trim(c.referred_by)) = lower(trim($${i}))`,
      f.referredBy,
    );

  if (f.isMember !== undefined)
    add((i) => `c.is_member = $${i}::boolean`, f.isMember);

  if (f.source) add((i) => `c.source = $${i}`, f.source);

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
            c.unit_id, u.unit_code, u.name AS unit_name,
            /* The UNIT is authoritative whenever one is set; c.sector is
             * the fallback for a client that has no unit (020). This is
             * what keeps the two from drifting into disagreement. */
            COALESCE(u.sector, c.sector) AS sector,
            c.referred_by, c.is_member, c.source,
            c.created_at, c.updated_at,
            i.interaction_count, i.last_interaction_at
       FROM clients c
       LEFT JOIN tickets t ON t.id = c.ticket_id
       LEFT JOIN units   u ON u.id = c.unit_id
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
       LEFT JOIN units u ON u.id = c.unit_id
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
            c.unit_id, u.unit_code, u.name AS unit_name,
            /* The UNIT is authoritative whenever one is set; c.sector is
             * the fallback for a client that has no unit (020). This is
             * what keeps the two from drifting into disagreement. */
            COALESCE(u.sector, c.sector) AS sector,
            c.referred_by, c.is_member, c.source,
            c.created_at, c.updated_at,
            i.interaction_count, i.last_interaction_at
       FROM clients c
       LEFT JOIN tickets t ON t.id = c.ticket_id
       LEFT JOIN units   u ON u.id = c.unit_id
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
  unitId: string | null;
  referredBy: string | null;
  isMember: boolean | null;
  sector: string | null;
  source: string;
  createdBy: string;
}): Promise<{ id: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO clients
       (name, mobile, email, organisation, intended_tier, status,
        follow_up_on, unit_id, referred_by, is_member, sector, source,
        created_by)
     VALUES ($1, $2, $3, $4, $5::ticket_type, $6::client_status, $7::DATE,
             $8::uuid, $9, $10::boolean, $11, $12, $13)
     RETURNING id`,
    [
      params.name,
      params.mobile,
      params.email,
      params.organisation,
      params.intendedTier,
      params.status,
      params.followUpOn,
      params.unitId,
      params.referredBy,
      params.isMember,
      params.sector,
      params.source,
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
    unit_id: '::uuid',
    is_member: '::boolean',
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

/**
 * Every sector that actually has clients, for the filter dropdown.
 *
 * Derived from the DATA rather than a fixed list, exactly as the ticket
 * ledger derives its sector filter (Known debt 7): the imported list
 * includes groupings like 'Sponsors' that are not event sectors at all, and
 * a hardcoded list would silently hide them.
 */
/**
 * Sectors with no unit of their own that must be selectable even before any
 * client has ever been filed under them (§ Clients, migrations 019/022).
 *
 * SPONSORS only shows up today because the imported roster already has a
 * client on it — the same MUROOJ-before-any-client gap `listClientSectors`
 * closes for real sectors below would otherwise reopen for these two,
 * since neither has a `units` row of its own to be derived from (Riyadh
 * Zone's `units.sector` is a single 'RIYADH ZONE' string, which cannot
 * simultaneously equal both of these). Hardcoded rather than another table
 * because this is a fixed, named, rarely-changing set — the same judgement
 * call as SEATS_PER_TIER, not a case for a new schema.
 */
const ALWAYS_OFFERED_SECTORS = [
  'SPONSORS',
  'SPONSORS-RIYADH ZONE',
  'DAYEE-RIYADH ZONE',
] as const;

export async function listClientSectors(): Promise<string[]> {
  const { rows } = await query<{ sector: string }>(
    /* UNION of the sectors that EXIST (units), the sectors clients are
     * actually filed under, and the fixed always-offered set above.
     *
     * Deriving from units/clients alone was a bug: a sector with no client
     * yet — MUROOJ, for one — simply had no dropdown entry, so nobody
     * could file the first client into it. The units half makes every
     * real sector selectable from day one; the always-offered half does
     * the same for the sectors that intentionally have no unit (or share
     * one unit) and so are invisible to both other halves. */
    `SELECT DISTINCT sector FROM (
       SELECT upper(trim(u.sector)) AS sector
         FROM units u
        WHERE u.sector IS NOT NULL AND trim(u.sector) <> ''
       UNION
       SELECT upper(trim(c.sector)) AS sector
         FROM clients c
        WHERE c.sector IS NOT NULL AND trim(c.sector) <> ''
       UNION
       SELECT unnest($1::text[]) AS sector
     ) AS all_sectors
      ORDER BY sector ASC`,
    [ALWAYS_OFFERED_SECTORS],
  );
  return rows.map((r) => r.sector);
}

/** Distinct contact owners, for the same reason. */
export async function listClientOwners(): Promise<string[]> {
  const { rows } = await query<{ owner: string }>(
    `SELECT DISTINCT trim(referred_by) AS owner
       FROM clients
      WHERE referred_by IS NOT NULL AND trim(referred_by) <> ''
      ORDER BY owner ASC`,
  );
  return rows.map((r) => r.owner);
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

export interface ClientAnalyticsRow {
  bucket: string;
  total: number;
  prospect: number;
  awaiting: number;
  confirmed: number;
  ticketed: number;
  declined: number;
}

/**
 * Pipeline counts grouped by sector, owner or tier.
 *
 * Takes the SAME filters as the list and runs them through the SAME
 * `clientWhere()` builder, so a chart can never describe a different set of
 * rows than the table beside it.
 *
 * `groupBy` is NOT interpolated from user input: the caller passes one of
 * three fixed keys which this maps to a checked SQL expression. A
 * client-supplied string in GROUP BY would be an injection hole, and a
 * whitelist is the only safe way to vary a column name.
 */
export async function analyseClients(
  filters: ClientFilters,
  groupBy: 'sector' | 'owner' | 'tier',
): Promise<ClientAnalyticsRow[]> {
  const { sql, params } = clientWhere(filters);

  const EXPRESSIONS = {
    sector: `upper(trim(COALESCE(u.sector, c.sector)))`,
    owner: `trim(c.referred_by)`,
    tier: `c.intended_tier::text`,
  } as const;

  const expr = EXPRESSIONS[groupBy];

  const { rows } = await query<ClientAnalyticsRow>(
    `SELECT COALESCE(NULLIF(${expr}, ''), 'Unassigned') AS bucket,
            COUNT(*)::INT AS total,
            COUNT(*) FILTER (WHERE c.status = 'PROSPECT')::INT       AS prospect,
            COUNT(*) FILTER (WHERE c.status = 'AWAITING_REPLY')::INT AS awaiting,
            COUNT(*) FILTER (WHERE c.status = 'CONFIRMED')::INT      AS confirmed,
            COUNT(*) FILTER (WHERE c.status = 'TICKETED')::INT       AS ticketed,
            COUNT(*) FILTER (WHERE c.status = 'DECLINED')::INT       AS declined
       FROM clients c
       LEFT JOIN units u ON u.id = c.unit_id
       ${sql}
      GROUP BY 1
      /* Biggest first: the question is "where is the volume", and an
       * alphabetical axis buries that. */
      ORDER BY total DESC, bucket ASC`,
    params,
  );
  return rows;
}

export interface ClientPipelineRow {
  status: string;
  count: number;
}

/** Overall pipeline shape, for the stage KPI row. */
export async function clientPipeline(
  filters: ClientFilters,
): Promise<ClientPipelineRow[]> {
  const { sql, params } = clientWhere(filters);

  const { rows } = await query<ClientPipelineRow>(
    `SELECT c.status::text AS status, COUNT(*)::INT AS count
       FROM clients c
       LEFT JOIN units u ON u.id = c.unit_id
       ${sql}
      GROUP BY c.status`,
    params,
  );
  return rows;
}

/**
 * Membership split, which drives the ASK rather than being a label: a
 * member is being invited back, a non-member is being sold to.
 *
 * THREE buckets, not two — NULL ("not yet known") is a real state, and
 * folding it into "not a member" would overstate how much is actually
 * known about the roster.
 */
export async function clientMembership(
  filters: ClientFilters,
): Promise<{ member: number; nonMember: number; unknown: number }> {
  const { sql, params } = clientWhere(filters);

  const { rows } = await query<{
    member: number;
    nonmember: number;
    unknown: number;
  }>(
    `SELECT COUNT(*) FILTER (WHERE c.is_member IS TRUE)::INT  AS member,
            COUNT(*) FILTER (WHERE c.is_member IS FALSE)::INT AS nonMember,
            COUNT(*) FILTER (WHERE c.is_member IS NULL)::INT  AS unknown
       FROM clients c
       LEFT JOIN units u ON u.id = c.unit_id
       ${sql}`,
    params,
  );

  const r = rows[0];
  return {
    member: r?.member ?? 0,
    nonMember: r?.nonmember ?? 0,
    unknown: r?.unknown ?? 0,
  };
}
