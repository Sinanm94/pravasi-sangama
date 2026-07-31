import type { PoolClient } from 'pg';
import { query } from '../../db/index.js';

export interface UnitRow {
  id: string;
  division_id: string;
  unit_code: string;
  name: string;
  sector: string | null;
  access_code_hash: string;
  is_active: boolean;
  division_name: string;
  division_code: string;
}

export interface AgentRow {
  id: string;
  unit_id: string;
  /** Joined from units — the agent's own posting is the source of truth. */
  division_id: string;
  mobile_number: string;
  name: string;
  pin_hash: string | null;
  is_active: boolean;
  email: string | null;
  approval_status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface SessionRow {
  id: string;
  unit_id: string;
  agent_id: string | null;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/**
 * Unit codes are unique per division, not globally, so this can legitimately
 * return more than one row. The caller decides whether that is ambiguous.
 */
export async function findUnitsByCode(
  unitCode: string,
  divisionCode?: string,
): Promise<UnitRow[]> {
  const { rows } = await query<UnitRow>(
    `SELECT u.id, u.division_id, u.unit_code, u.name, u.sector,
            u.access_code_hash, u.is_active,
            d.name AS division_name, d.code AS division_code
       FROM units u
       JOIN divisions d ON d.id = u.division_id
      WHERE u.unit_code = $1
        AND ($2::TEXT IS NULL OR d.code = $2)`,
    [unitCode, divisionCode ?? null],
  );
  return rows;
}

export async function findAgentByMobile(
  mobile: string,
): Promise<AgentRow | null> {
  const { rows } = await query<AgentRow>(
    `SELECT id, unit_id, mobile_number, name, pin_hash, is_active,
            email, approval_status
       FROM agents
      WHERE mobile_number = $1`,
    [mobile],
  );
  return rows[0] ?? null;
}

/** Spec §3: agents may sign in with their mobile OR their email. */
export async function findAgentByMobileOrEmail(
  identifier: string,
): Promise<AgentRow | null> {
  const { rows } = await query<AgentRow>(
    `SELECT a.id, a.unit_id, u.division_id, a.mobile_number, a.name,
            a.pin_hash, a.is_active, a.email, a.approval_status
       FROM agents a
       JOIN units u ON u.id = a.unit_id
      WHERE a.mobile_number = $1 OR LOWER(a.email) = LOWER($1)
      LIMIT 1`,
    [identifier],
  );
  return rows[0] ?? null;
}

export interface SuperuserRow {
  id: string;
  username: string;
  password_hash: string;
  name: string;
  is_active: boolean;
}

/**
 * The login form's field is `username`, but this matches EITHER the short
 * username (`admin1`) or the full seeded email (`admin1@pravasisangama.com`)
 * against whatever string comes in — spec §4 originally identified
 * superusers by email, and this keeps that still working for anyone who
 * types the full address out of habit, at zero extra cost (one indexed OR,
 * both sides already backed by a unique index).
 */
export async function findSuperuserByUsername(
  usernameOrEmail: string,
): Promise<SuperuserRow | null> {
  const { rows } = await query<SuperuserRow>(
    `SELECT id, username, password_hash, name, is_active
       FROM superusers
      WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)
      LIMIT 1`,
    [usernameOrEmail],
  );
  return rows[0] ?? null;
}

export async function touchSuperuserLogin(id: string): Promise<void> {
  await query(`UPDATE superusers SET last_login_at = NOW() WHERE id = $1`, [id]);
}

/**
 * A session created and bound to its agent in one insert.
 *
 * The two-step flow created a row at step 1 with agent_id NULL and bound it
 * at step 2. Direct agent login has no unbound phase, so both columns are set
 * together — which is also what unit_sessions_binding_consistent requires.
 */
export async function createAgentSession(params: {
  id: string;
  unitId: string;
  agentId: string;
  tokenHash: string;
  expiresAt: Date;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO unit_sessions
       (id, unit_id, agent_id, agent_bound_at, token_hash, expires_at,
        ip_address, user_agent)
     VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)`,
    [
      params.id,
      params.unitId,
      params.agentId,
      params.tokenHash,
      params.expiresAt,
      params.ip ?? null,
      params.userAgent ?? null,
    ],
  );
}

export async function createUnitSession(params: {
  id: string;
  unitId: string;
  tokenHash: string;
  expiresAt: Date;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO unit_sessions
       (id, unit_id, agent_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, NULL, $3, $4, $5, $6)`,
    [
      params.id,
      params.unitId,
      params.tokenHash,
      params.expiresAt,
      params.ip ?? null,
      params.userAgent ?? null,
    ],
  );
}

export async function findLiveSession(
  sessionId: string,
): Promise<SessionRow | null> {
  const { rows } = await query<SessionRow>(
    `SELECT id, unit_id, agent_id, token_hash, expires_at, revoked_at
       FROM unit_sessions
      WHERE id = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()`,
    [sessionId],
  );
  return rows[0] ?? null;
}

/**
 * Binds the agent and rotates the stored token hash in one statement.
 *
 * The `agent_id IS NULL` predicate is the concurrency guard: two step-2
 * requests racing on the same pending session means exactly one UPDATE
 * matches, and the loser gets zero rows back rather than silently
 * overwriting the winner's binding.
 */
export async function bindAgentToSession(params: {
  sessionId: string;
  agentId: string;
  tokenHash: string;
  expiresAt: Date;
  client?: PoolClient;
}): Promise<SessionRow | null> {
  const sql = `
    UPDATE unit_sessions
       SET agent_id       = $2,
           agent_bound_at = NOW(),
           token_hash     = $3,
           expires_at     = $4
     WHERE id = $1
       AND agent_id IS NULL
       AND revoked_at IS NULL
       AND expires_at > NOW()
    RETURNING id, unit_id, agent_id, token_hash, expires_at, revoked_at`;

  const params_ = [
    params.sessionId,
    params.agentId,
    params.tokenHash,
    params.expiresAt,
  ];

  const { rows } = params.client
    ? await params.client.query<SessionRow>(sql, params_)
    : await query<SessionRow>(sql, params_);

  return rows[0] ?? null;
}

export interface SessionContextRow {
  unit_id: string;
  unit_code: string;
  unit_name: string;
  unit_sector: string | null;
  division_id: string;
  division_name: string;
  division_code: string;
  agent_id: string | null;
  agent_name: string | null;
  agent_mobile: string | null;
}

/**
 * Everything the client needs to render an agent's context bar, in one read.
 * Called on session hydration, not on any hot path.
 */
export async function loadSessionContext(
  sessionId: string,
): Promise<SessionContextRow | null> {
  const { rows } = await query<SessionContextRow>(
    `SELECT u.id            AS unit_id,
            u.unit_code,
            u.name          AS unit_name,
            u.sector        AS unit_sector,
            d.id            AS division_id,
            d.name          AS division_name,
            d.code          AS division_code,
            a.id            AS agent_id,
            a.name          AS agent_name,
            a.mobile_number AS agent_mobile
       FROM unit_sessions s
       JOIN units     u ON u.id = s.unit_id
       JOIN divisions d ON d.id = u.division_id
       LEFT JOIN agents a ON a.id = s.agent_id
      WHERE s.id = $1`,
    [sessionId],
  );

  return rows[0] ?? null;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE unit_sessions
        SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
}

/* ================================================================== */
/* Agent self-registration (spec §3)                                   */
/* ================================================================== */

export interface UnitLookupRow {
  id: string;
  division_id: string;
  unit_code: string;
  name: string;
}

export async function findUnitIdByCode(
  unitCode: string,
): Promise<UnitLookupRow | null> {
  const { rows } = await query<UnitLookupRow>(
    `SELECT id, division_id, unit_code, name
       FROM units
      WHERE unit_code = $1 AND is_active
      ORDER BY created_at
      LIMIT 1`,
    [unitCode],
  );
  return rows[0] ?? null;
}

export async function listPublicUnits(): Promise<
  Array<{
    unit_code: string;
    name: string;
    sector: string | null;
    division_name: string;
  }>
> {
  const { rows } = await query<{
    unit_code: string;
    name: string;
    sector: string | null;
    division_name: string;
  }>(
    `SELECT u.unit_code, u.name, u.sector, d.name AS division_name
       FROM units u
       JOIN divisions d ON d.id = u.division_id
      WHERE u.is_active AND d.is_active
      ORDER BY d.name, u.name`,
  );
  return rows;
}

/**
 * Creates a PENDING agent. Uniqueness on mobile and email is left to the
 * indexes rather than a pre-check, so two simultaneous signups on the same
 * number cannot both succeed.
 */
export async function createSelfRegisteredAgent(params: {
  unitId: string;
  mobileNumber: string;
  name: string;
  email: string;
  passwordHash: string;
}): Promise<{ id: string }> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO agents
       (unit_id, mobile_number, name, email, pin_hash,
        self_registered, approval_status, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE, 'PENDING', TRUE)
     RETURNING id`,
    [
      params.unitId,
      params.mobileNumber,
      params.name,
      params.email,
      params.passwordHash,
    ],
  );
  return rows[0]!;
}

export async function findAgentByEmail(
  email: string,
): Promise<AgentRow | null> {
  const { rows } = await query<AgentRow>(
    `SELECT id, unit_id, mobile_number, name, pin_hash, is_active,
            email, approval_status
       FROM agents
      WHERE LOWER(email) = LOWER($1)`,
    [email],
  );
  return rows[0] ?? null;
}

/* ================================================================== */
/* Password reset                                                      */
/* ================================================================== */

export async function createPasswordResetToken(params: {
  agentId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  // One live token per agent — requesting a new link kills the previous one.
  await query(
    `UPDATE password_reset_tokens
        SET consumed_at = NOW()
      WHERE agent_id = $1 AND consumed_at IS NULL`,
    [params.agentId],
  );

  await query(
    `INSERT INTO password_reset_tokens (agent_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [params.agentId, params.tokenHash, params.expiresAt],
  );
}

/**
 * Consumes the token and sets the new password in one statement. The
 * `consumed_at IS NULL` predicate is the guard: a link double-clicked, or
 * replayed out of a forwarded email, matches zero rows the second time.
 */
export async function consumeResetToken(params: {
  tokenHash: string;
  passwordHash: string;
}): Promise<{ agent_id: string } | null> {
  const { rows } = await query<{ agent_id: string }>(
    `WITH claimed AS (
       UPDATE password_reset_tokens
          SET consumed_at = NOW()
        WHERE token_hash = $1
          AND consumed_at IS NULL
          AND expires_at > NOW()
       RETURNING agent_id
     )
     UPDATE agents a
        SET pin_hash = $2
       FROM claimed c
      WHERE a.id = c.agent_id
     RETURNING a.id AS agent_id`,
    [params.tokenHash, params.passwordHash],
  );
  return rows[0] ?? null;
}

/* ================================================================== */
/* Gates (spec §2, Option A)                                           */
/* ================================================================== */

export interface GateRow {
  id: string;
  division_id: string | null;
  gate_code: string;
  name: string;
  pin_hash: string;
  pin_valid_on: string | null;
  is_active: boolean;
}

export async function findGateByCode(
  gateCode: string,
): Promise<GateRow | null> {
  const { rows } = await query<GateRow>(
    `SELECT id, division_id, gate_code, name, pin_hash,
            to_char(pin_valid_on, 'YYYY-MM-DD') AS pin_valid_on, is_active
       FROM gates
      WHERE gate_code = $1`,
    [gateCode],
  );
  return rows[0] ?? null;
}

export async function listPublicGates(): Promise<
  Array<{ gate_code: string; name: string }>
> {
  const { rows } = await query<{ gate_code: string; name: string }>(
    `SELECT gate_code, name FROM gates WHERE is_active ORDER BY name`,
  );
  return rows;
}

export async function createGateSession(params: {
  id: string;
  gateId: string;
  tokenHash: string;
  expiresAt: Date;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO gate_sessions
       (id, gate_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.id,
      params.gateId,
      params.tokenHash,
      params.expiresAt,
      params.ip ?? null,
      params.userAgent ?? null,
    ],
  );
}

/** Also re-checks `gates.is_active`, so deactivating a gate kills its
 *  sessions on the next request rather than at token expiry. */
export async function findLiveGateSession(
  sessionId: string,
): Promise<{ id: string; gate_id: string; token_hash: string } | null> {
  const { rows } = await query<{
    id: string;
    gate_id: string;
    token_hash: string;
  }>(
    `SELECT s.id, s.gate_id, s.token_hash
       FROM gate_sessions s
       JOIN gates g ON g.id = s.gate_id
      WHERE s.id = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND g.is_active`,
    [sessionId],
  );
  return rows[0] ?? null;
}

export async function revokeGateSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE gate_sessions SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
}

export async function writeAudit(params: {
  actorRole: 'SUPERUSER' | 'AGENT' | null;
  actorId: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (actor_role, actor_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.actorRole,
      params.actorId,
      params.action,
      params.entityType ?? null,
      params.entityId ?? null,
      JSON.stringify(params.metadata ?? {}),
      params.ip ?? null,
    ],
  );
}
