import type { Request, RequestHandler, Response } from 'express';
import {
  AdminTicketExportQuerySchema,
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
    approvedBy: actor,
    approvedByRole: 'SUPERUSER',
    reason: input.reason ?? null,
    // No restrictToAdminId — §2's "ultimate authority": a superuser overrides
    // any unit.
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

function toAdminTicketRow(r: repo.AdminTicketLedgerRow): AdminTicketRow {
  return {
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
    unitSector: r.unit_sector,
    divisionId: r.division_id,
    divisionName: r.division_name,
  };
}

export const listTicketLedger = handle(async (req, res) => {
  // Zod validates the ids as UUIDs, so a malformed filter is a 400 rather
  // than a Postgres 22P02 surfacing as an opaque 500.
  const q = AdminTicketQuerySchema.parse(req.query);

  const filters = {
    agentId: q.agent_id,
    unitId: q.unit_id,
    divisionId: q.division_id,
    sector: q.sector,
    search: q.search,
    status: q.status,
  };

  /* Rows and totals in parallel, from the same filter object. The totals are
   * a SQL aggregate over the whole matching set — NOT a sum of `rows`, which
   * is capped and would under-report the moment a filter matches more. */
  const [rows, totals] = await Promise.all([
    repo.listTicketsForAdmin(filters, q.limit),
    repo.summariseTicketsForAdmin(filters),
  ]);

  const tickets: AdminTicketRow[] = rows.map(toAdminTicketRow);

  const body: AdminTicketLedgerResponse = {
    tickets,
    totals,
    // The table is showing a slice; the cards are not. Say so.
    truncated: totals.tickets > tickets.length,
    limit: q.limit,
  };

  res.status(200).json(body);
});

/* ------------------------------------------------------------------ */
/* GET /api/admin/tickets/export — full CSV of the filtered set        */
/* ------------------------------------------------------------------ */

/**
 * Not a page size — a backstop against a runaway query. This event will
 * never plausibly produce anywhere near this many tickets; the cap exists so
 * an empty filter set can't turn "download everything" into an unbounded
 * scan, not to leave real data out of the file.
 */
const EXPORT_ROW_LIMIT = 100_000;

const CSV_COLUMNS: Array<{
  header: string;
  value: (t: AdminTicketRow) => string | number;
}> = [
  { header: 'Ticket ID', value: (t) => t.ticketNumber },
  { header: 'Request Number', value: (t) => t.requestNumber },
  { header: 'Ticket Type', value: (t) => t.ticketType },
  { header: 'Buyer Name', value: (t) => t.purchaserName },
  { header: 'Buyer Mobile', value: (t) => t.purchaserMobile },
  { header: 'Buyer Email', value: (t) => t.purchaserEmail ?? '' },
  { header: 'Seats (Adults)', value: (t) => t.countedPersons },
  { header: 'Children Below 12', value: (t) => t.childrenBelow12 },
  { header: 'Status', value: (t) => t.status },
  { header: 'Agent', value: (t) => t.agentName },
  { header: 'Unit', value: (t) => t.unitName },
  { header: 'Unit Code', value: (t) => t.unitCode },
  { header: 'Sector', value: (t) => t.unitSector ?? '' },
  { header: 'Division', value: (t) => t.divisionName },
  { header: 'Issued At (UTC)', value: (t) => t.createdAt },
];

/** RFC 4180: a field touching a comma, quote or newline is quoted, and an
 *  internal quote is escaped by doubling it — not backslash-escaped, which
 *  is a CSV myth that corrupts the file for spreadsheet readers expecting
 *  the RFC form. */
function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(tickets: AdminTicketRow[]): string {
  const header = CSV_COLUMNS.map((c) => csvEscape(c.header)).join(',');
  const rows = tickets.map((t) =>
    CSV_COLUMNS.map((c) => csvEscape(c.value(t))).join(','),
  );
  // CRLF is RFC 4180's line ending and what Excel expects; a bare \n opens
  // fine in most tools but is technically non-conformant.
  return [header, ...rows].join('\r\n');
}

export const exportTicketLedger = handle(async (req, res) => {
  // Same filters as the ledger, minus `limit` — the export has its own fixed
  // cap (EXPORT_ROW_LIMIT), not a client-suppliable page size.
  const q = AdminTicketExportQuerySchema.parse(req.query);

  const filters = {
    agentId: q.agent_id,
    unitId: q.unit_id,
    divisionId: q.division_id,
    sector: q.sector,
    search: q.search,
    status: q.status,
  };

  const rows = await repo.listTicketsForAdmin(filters, EXPORT_ROW_LIMIT);
  const csv = toCsv(rows.map(toAdminTicketRow));

  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="pravasi-tickets-report.csv"',
  });
  // A UTF-8 BOM: Excel on Windows otherwise guesses ANSI and mangles any
  // purchaser name outside the Latin-1 range. Three bytes, no downside for
  // any other CSV reader — they all treat a leading BOM as a no-op. Built via
  // fromCharCode rather than a literal character in source, so it can't get
  // silently stripped or mangled by an editor/diff tool.
  res.status(200).send(String.fromCharCode(0xfeff) + csv);
});

/** Option lists for the ledger's dependent dropdowns. */
export const listFilterOptions = handle(async (_req, res) => {
  const rows = await repo.listFilterOptions();

  const body: AdminFilterOptions = {
    divisions: rows.divisions,
    sectors: rows.sectors,
    units: rows.units.map((u) => ({
      id: u.id,
      name: u.name,
      unitCode: u.unit_code,
      divisionId: u.division_id,
      sector: u.sector,
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
