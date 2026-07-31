import type { Request, RequestHandler, Response } from 'express';
import {
  AdminTicketQuerySchema,
  AgentDecisionSchema,
  CreateGateSchema,
  RotateGatePinSchema,
  type AdminFilterOptions,
  type AdminTicketLedgerResponse,
  type AdminTicketRow,
  type AgentDirectoryEntry,
  type AgentDirectoryResponse,
  type GateSummary,
  type PendingAgent,
} from '@pravasi/shared';
import { hashSecret } from '../../lib/crypto.js';
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js';
import * as repo from './admin.repository.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** requireSuperuser has already run; this is the typed read of the claims. */
function superuserId(req: Request): string {
  if (!req.auth || req.auth.role !== 'SUPERUSER') throw unauthorized();
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

  const rows = await repo.listAgentsByStatus(
    status as 'PENDING' | 'APPROVED' | 'REJECTED',
  );

  const agents: PendingAgent[] = rows.map((r) => ({
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
    action:
      input.decision === 'APPROVED' ? 'AGENT_APPROVED' : 'AGENT_REJECTED',
    entityType: 'agent',
    entityId: agentId,
    metadata: { reason: input.reason ?? null },
    ip: req.ip ?? null,
  });

  res.status(200).json({ id: decided.id, status: input.decision });
});

/* ------------------------------------------------------------------ */
/* Agent directory                                                     */
/* ------------------------------------------------------------------ */

export const listAgentDirectory = handle(async (_req, res) => {
  const rows = await repo.listAgentDirectory();

  const agents: AgentDirectoryEntry[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    mobileNumber: r.mobile_number,
    email: r.email,
    unitCode: r.unit_code,
    unitName: r.unit_name,
    divisionName: r.division_name,
    isActive: r.is_active,
    createdAt: r.created_at.toISOString(),
    ticketsIssued: r.tickets_issued,
    ticketsRevoked: r.tickets_revoked,
    seatsIssued: r.seats_issued,
    lastIssuedAt: r.last_issued_at?.toISOString() ?? null,
  }));

  /* Totalled here, not in the browser. The client sees at most 500 rows and
   * would silently under-report the moment that cap is reached. */
  const body: AgentDirectoryResponse = {
    agents,
    totals: {
      agents: agents.length,
      ticketsIssued: agents.reduce((n, a) => n + a.ticketsIssued, 0),
      seatsIssued: agents.reduce((n, a) => n + a.seatsIssued, 0),
    },
  };

  res.status(200).json(body);
});

/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */

export const listGates = handle(async (_req, res) => {
  const rows = await repo.listGates();

  const gates: GateSummary[] = rows.map((r) => ({
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

  let divisionId: string | null = null;
  if (input.division_code) {
    divisionId = await repo.findDivisionIdByCode(input.division_code);
    if (!divisionId) throw badRequest('No division with that code');
  }

  const pinHash = await hashSecret(input.pin);

  let created: { id: string };
  try {
    created = await repo.createGate({
      gateCode: input.gate_code,
      name: input.name,
      divisionId,
      pinHash,
      pinValidOn: input.pin_valid_on ?? null,
    });
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
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

  if (!ok) throw notFound('No such gate');

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
  if (!ok) throw notFound('No such gate');

  await repo.writeAudit({
    superuserId: actor,
    action: isActive ? 'GATE_ACTIVATED' : 'GATE_DEACTIVATED',
    entityType: 'gate',
    entityId: gateId,
    ip: req.ip ?? null,
  });

  res.status(200).json({ id: gateId, isActive });
});

/* ------------------------------------------------------------------ */
/* GET /api/admin/tickets — master ledger                              */
/* ------------------------------------------------------------------ */

export const listTicketLedger = handle(async (req, res) => {
  // Zod validates the ids as UUIDs, so a malformed filter is a 400 rather
  // than a Postgres 22P02 surfacing as an opaque 500.
  const q = AdminTicketQuerySchema.parse(req.query);

  const filters = {
    agentId: q.agent_id,
    unitId: q.unit_id,
    divisionId: q.division_id,
    search: q.search,
  };

  /* Rows and totals in parallel, from the same filter object. The totals are
   * a SQL aggregate over the whole matching set — NOT a sum of `rows`, which
   * is capped and would under-report the moment a filter matches more. */
  const [rows, totals] = await Promise.all([
    repo.listTicketsForAdmin(filters, q.limit),
    repo.summariseTicketsForAdmin(filters),
  ]);

  const tickets: AdminTicketRow[] = rows.map((r) => ({
    id: r.id,
    requestNumber: r.request_number,
    ticketNumber: r.ticket_number,
    ticketType: r.ticket_type,
    purchaserName: r.purchaser_name,
    purchaserMobile: r.purchaser_mobile,
    purchaserEmail: r.purchaser_email,
    countedPersons: r.counted_persons,
    childrenBelow12: r.children_below_12,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    agentId: r.agent_id,
    agentName: r.agent_name,
    unitId: r.unit_id,
    unitName: r.unit_name,
    unitCode: r.unit_code,
    divisionId: r.division_id,
    divisionName: r.division_name,
  }));

  const body: AdminTicketLedgerResponse = {
    tickets,
    totals,
    // The table is showing a slice; the cards are not. Say so.
    truncated: totals.tickets > tickets.length,
    limit: q.limit,
  };

  res.status(200).json(body);
});

/** Option lists for the ledger's dependent dropdowns. */
export const listFilterOptions = handle(async (_req, res) => {
  const rows = await repo.listFilterOptions();

  const body: AdminFilterOptions = {
    divisions: rows.divisions,
    units: rows.units.map((u) => ({
      id: u.id,
      name: u.name,
      unitCode: u.unit_code,
      divisionId: u.division_id,
    })),
    agents: rows.agents.map((a) => ({
      id: a.id,
      name: a.name,
      mobileNumber: a.mobile_number,
      unitId: a.unit_id,
    })),
  };

  res.status(200).json(body);
});
