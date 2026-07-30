import { AgentDecisionSchema, CreateGateSchema, RotateGatePinSchema, } from '@pravasi/shared';
import { hashSecret } from '../../lib/crypto.js';
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js';
import * as repo from './admin.repository.js';
const handle = (fn) => (req, res, next) => {
    fn(req, res).catch(next);
};
/** requireSuperuser has already run; this is the typed read of the claims. */
function superuserId(req) {
    if (!req.auth || req.auth.role !== 'SUPERUSER')
        throw unauthorized();
    return req.auth.superuserId;
}
const UNIQUE_VIOLATION = '23505';
/* ------------------------------------------------------------------ */
/* Agent approvals                                                     */
/* ------------------------------------------------------------------ */
export const listAgents = handle(async (req, res) => {
    const status = String(req.query.status ?? 'PENDING').toUpperCase();
    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
        throw badRequest('status must be PENDING, APPROVED or REJECTED');
    }
    const rows = await repo.listAgentsByStatus(status);
    const agents = rows.map((r) => ({
        id: r.id,
        name: r.name,
        mobileNumber: r.mobile_number,
        email: r.email,
        unitCode: r.unit_code,
        unitName: r.unit_name,
        divisionName: r.division_name,
        createdAt: r.created_at.toISOString(),
    }));
    res.status(200).json({ agents });
});
export const decideAgent = handle(async (req, res) => {
    const actor = superuserId(req);
    const input = AgentDecisionSchema.parse(req.body);
    const agentId = String(req.params.id);
    const decided = await repo.decideAgent({
        agentId,
        decision: input.decision,
        superuserId: actor,
        reason: input.reason ?? null,
    });
    // Zero rows means it was not PENDING — already decided, or no such agent.
    if (!decided) {
        throw conflict('That registration has already been decided.');
    }
    await repo.writeAudit({
        superuserId: actor,
        action: input.decision === 'APPROVED' ? 'AGENT_APPROVED' : 'AGENT_REJECTED',
        entityType: 'agent',
        entityId: agentId,
        metadata: { reason: input.reason ?? null },
        ip: req.ip ?? null,
    });
    res.status(200).json({ id: decided.id, status: input.decision });
});
/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */
export const listGates = handle(async (_req, res) => {
    const rows = await repo.listGates();
    const gates = rows.map((r) => ({
        id: r.id,
        gateCode: r.gate_code,
        name: r.name,
        divisionName: r.division_name,
        isActive: r.is_active,
        pinRotatedAt: r.pin_rotated_at.toISOString(),
        pinValidOn: r.pin_valid_on,
    }));
    res.status(200).json({ gates });
});
export const createGate = handle(async (req, res) => {
    const actor = superuserId(req);
    const input = CreateGateSchema.parse(req.body);
    let divisionId = null;
    if (input.division_code) {
        divisionId = await repo.findDivisionIdByCode(input.division_code);
        if (!divisionId)
            throw badRequest('No division with that code');
    }
    const pinHash = await hashSecret(input.pin);
    let created;
    try {
        created = await repo.createGate({
            gateCode: input.gate_code,
            name: input.name,
            divisionId,
            pinHash,
            pinValidOn: input.pin_valid_on ?? null,
        });
    }
    catch (err) {
        if (err.code === UNIQUE_VIOLATION) {
            throw conflict('A gate with that code already exists');
        }
        throw err;
    }
    await repo.writeAudit({
        superuserId: actor,
        action: 'GATE_CREATED',
        entityType: 'gate',
        entityId: created.id,
        metadata: { gate_code: input.gate_code, name: input.name },
        ip: req.ip ?? null,
    });
    // The PIN is never echoed back. It was supplied by the caller, and the
    // only stored form is the bcrypt hash.
    res.status(201).json({ id: created.id, gateCode: input.gate_code });
});
export const rotateGatePin = handle(async (req, res) => {
    const actor = superuserId(req);
    const input = RotateGatePinSchema.parse(req.body);
    const gateId = String(req.params.id);
    const ok = await repo.rotateGatePin({
        gateId,
        pinHash: await hashSecret(input.pin),
        pinValidOn: input.pin_valid_on ?? null,
    });
    if (!ok)
        throw notFound('No such gate');
    await repo.writeAudit({
        superuserId: actor,
        action: 'GATE_PIN_ROTATED',
        entityType: 'gate',
        entityId: gateId,
        metadata: { pin_valid_on: input.pin_valid_on ?? null },
        ip: req.ip ?? null,
    });
    res.status(200).json({ id: gateId, sessionsRevoked: true });
});
export const setGateActive = handle(async (req, res) => {
    const actor = superuserId(req);
    const gateId = String(req.params.id);
    const isActive = req.body?.is_active === true;
    const ok = await repo.setGateActive(gateId, isActive);
    if (!ok)
        throw notFound('No such gate');
    await repo.writeAudit({
        superuserId: actor,
        action: isActive ? 'GATE_ACTIVATED' : 'GATE_DEACTIVATED',
        entityType: 'gate',
        entityId: gateId,
        ip: req.ip ?? null,
    });
    res.status(200).json({ id: gateId, isActive });
});
//# sourceMappingURL=admin.controller.js.map