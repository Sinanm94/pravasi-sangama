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
  mobile_number: string;
  name: string;
  pin_hash: string | null;
  is_active: boolean;
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
    `SELECT id, unit_id, mobile_number, name, pin_hash, is_active
       FROM agents
      WHERE mobile_number = $1`,
    [mobile],
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

export async function findSuperuserByUsername(
  username: string,
): Promise<SuperuserRow | null> {
  const { rows } = await query<SuperuserRow>(
    `SELECT id, username, password_hash, name, is_active
       FROM superusers
      WHERE username = $1`,
    [username],
  );
  return rows[0] ?? null;
}

export async function touchSuperuserLogin(id: string): Promise<void> {
  await query(`UPDATE superusers SET last_login_at = NOW() WHERE id = $1`, [id]);
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
