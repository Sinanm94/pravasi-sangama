import type { Request, RequestHandler, Response } from 'express';
import {
  AgentDecisionSchema,
  type PendingAgent,
  type UnitAdminAgentListResponse,
} from '@pravasi/shared';
import { unitAdminScope } from '../../middleware/auth.js';
import { conflict, forbidden } from '../../lib/errors.js';
// Reusing the superuser module's decideAgent and writeAudit rather than
// duplicating the race-safe UPDATE (§10.2's "the row is the lock" pattern
// applies here too) and the audit_logs insert. Both already accept an actor
// role and an optional unit restriction — see admin.repository.ts.
import * as adminRepo from '../admin/admin.repository.js';
import * as repo from './unit-admin.repository.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/**
 * Confirms the caller has *some* scope — a direct unit posting or a zone
 * assignment (migration 007) — or throws a clear 403.
 *
 * Returning an empty list for an unscoped account is fine for the GET below
 * — "nothing to show" is a legitimate state. It is NOT fine for a decision:
 * silently no-op-ing an approve/reject the volunteer just tapped would look
 * like a bug, not like a permissions message. Fail loudly instead.
 */
async function requireAnyScope(adminId: string): Promise<void> {
  const scoped = await repo.adminHasScope(adminId);
  if (!scoped) {
    throw forbidden(
      'Your account is not yet assigned to a unit. Contact the event administrator.',
    );
  }
}

const toPendingAgent = (r: repo.UnitScopedAgentRow): PendingAgent => ({
  id: r.id,
  name: r.name,
  mobileNumber: r.mobile_number,
  email: r.email,
  unitCode: r.unit_code,
  unitName: r.unit_name,
  divisionName: r.division_name,
  createdAt: r.created_at.toISOString(),
});

/* ------------------------------------------------------------------ */
/* GET /api/unit-admin/agents                                          */
/* ------------------------------------------------------------------ */

export const listAgents = handle(async (req, res) => {
  const claims = unitAdminScope(req);

  // No unscoped short-circuit needed: listAgentsForAdmin resolves the full
  // union (own unit + zone assignments) in SQL, and an admin with neither
  // simply gets two empty arrays back — a real, expected state (§ migration
  // 005/007), not an error. The dashboard renders its own "no unit assigned"
  // message from an empty response.
  const rows = await repo.listAgentsForAdmin(claims.unitAdminId);

  const body: UnitAdminAgentListResponse = {
    pending: rows.pending.map(toPendingAgent),
    approved: rows.approved.map(toPendingAgent),
  };

  res.status(200).json(body);
});

/* ------------------------------------------------------------------ */
/* POST /api/unit-admin/agents/:id/decision                            */
/* ------------------------------------------------------------------ */

export const decideAgent = handle(async (req, res) => {
  const claims = unitAdminScope(req);
  await requireAnyScope(claims.unitAdminId);
  const input = AgentDecisionSchema.parse(req.body);
  const agentId = String(req.params.id);

  const decided = await adminRepo.decideAgent({
    agentId,
    decision: input.decision,
    approvedBy: claims.unitAdminId,
    approvedByRole: 'UNIT_ADMIN',
    reason: input.reason ?? null,
    // The scope boundary: this predicate is added to the UPDATE's WHERE
    // clause (own unit OR a zone assignment), so an agent outside both
    // matches zero rows at the SQL level — not filtered out after the fact
    // by application code.
    restrictToAdminId: claims.unitAdminId,
  });

  // Zero rows means either already decided, or (silently, on purpose) that
  // the agent falls outside this admin's scope. Same response either way: a
  // unit head has no legitimate reason to learn that an id outside their
  // scope exists at all.
  if (!decided) {
    throw conflict('That registration has already been decided.');
  }

  await adminRepo.writeAudit({
    superuserId: claims.unitAdminId,
    actorRole: 'UNIT_ADMIN',
    action:
      input.decision === 'APPROVED' ? 'AGENT_APPROVED' : 'AGENT_REJECTED',
    entityType: 'agent',
    entityId: agentId,
    metadata: { reason: input.reason ?? null, unit_id: decided.unit_id },
    ip: req.ip ?? null,
  });

  res.status(200).json({ id: decided.id, status: input.decision });
});
