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
    `UPDATE agents
        SET approval_status  = $2,
            approved_at      = NOW(),
            approved_by      = $3,
            rejected_reason  = $4,
            -- A rejected account must not be able to authenticate at all.
            is_active        = ($2 = 'APPROVED')
      WHERE id = $1
        AND approval_status = 'PENDING'
     RETURNING id, name, email`,
    [params.agentId, params.decision, params.superuserId, params.reason ?? null],
  );
  return rows[0] ?? null;
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
