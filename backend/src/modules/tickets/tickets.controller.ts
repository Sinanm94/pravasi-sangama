import type { Request, RequestHandler, Response } from 'express';
import {
  IssueTicketSchema,
  ShareTicketEmailSchema,
  qrCodePlanFor,
  type AgentTicketListResponse,
  type AgentTicketSummary,
} from '@pravasi/shared';
import { agentScope } from '../../middleware/auth.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { generateQrPayload, hashQrPayload } from '../../lib/identifiers.js';
// The reissue transaction lives in the admin module and is shared, not
// reimplemented — it carries the rules that make a reprint safe.
import * as adminRepo from '../admin/admin.repository.js';
import * as repo from './tickets.repository.js';
import * as service from './tickets.service.js';
import * as shareService from './tickets.share.service.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/* ------------------------------------------------------------------ */
/* POST /api/tickets/issue                                             */
/* ------------------------------------------------------------------ */

export const issueTicket = handle(async (req, res) => {
  // Throws if the session is not a fully-bound AGENT. requireAgent has
  // already run; this is the typed read of the same claims.
  const scope = agentScope(req);

  // .strict() — an unknown key such as counted_persons is a validation
  // error, not silently dropped input.
  const input = IssueTicketSchema.parse(req.body);

  const result = await service.issueTicket(input, scope, { ip: req.ip ?? null });

  // 201 with the raw QR payloads. This is the ONLY time they exist outside
  // the printed ticket — the database holds hashes only.
  res.status(201).json(result);
});

/* ------------------------------------------------------------------ */
/* POST /api/tickets/share/email                                       */
/* ------------------------------------------------------------------ */

export const shareByEmail = handle(async (req, res) => {
  const scope = agentScope(req);
  const input = ShareTicketEmailSchema.parse(req.body);

  const result = await shareService.shareTicketByEmail(input, scope);

  res.status(200).json(result);
});

/* ------------------------------------------------------------------ */
/* GET /api/tickets/mine — the agent's own ledger                      */
/* ------------------------------------------------------------------ */

export const myTickets = handle(async (req, res) => {
  // Scope comes from the verified token. An agent cannot widen this by
  // passing an agent_id — there is no parameter to pass.
  const scope = agentScope(req);
  const rows = await repo.listTicketsByAgent(scope.agentId);

  const tickets: AgentTicketSummary[] = rows.map((r) => ({
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
  }));

  /* Revoked tickets stay in the list — the agent needs to see what they
   * issued — but they are excluded from the headcounts, because nobody is
   * catering for a seat that was cancelled. */
  const active = tickets.filter((t) => t.status === 'ACTIVE');

  const body: AgentTicketListResponse = {
    tickets,
    totals: {
      tickets: tickets.length,
      seats: active.reduce((n, t) => n + t.countedPersons, 0),
      children: active.reduce((n, t) => n + t.childrenBelow12, 0),
    },
  };

  res.status(200).json(body);
});

/* ------------------------------------------------------------------ */
/* POST /api/tickets/:id/reissue — an agent reprints their OWN ticket  */
/* ------------------------------------------------------------------ */

/**
 * Same operation as the superuser reprint, scoped to the caller's own
 * tickets: `findTicketForAgent` filters on `agent_id` from the verified
 * token, so a ticket issued by anyone else matches zero rows and is
 * indistinguishable from one that does not exist.
 *
 * The reissue transaction itself is `admin.repository.reissueTicketCodes` —
 * shared rather than reimplemented. It carries the rules that make a reprint
 * safe (revoke the old codes, refuse if any guest already entered, refuse a
 * revoked ticket), and a second copy would eventually drift from them.
 */
export const reissueMyTicket = handle(async (req, res) => {
  const scope = agentScope(req);
  const ticketId = String(req.params.id);

  const ticket = await repo.findTicketForAgent(ticketId, scope.agentId);
  if (!ticket) throw notFound('No such ticket');

  if (ticket.status === 'REVOKED') {
    throw conflict('That ticket is revoked and cannot be reprinted.');
  }

  const plan = qrCodePlanFor(ticket.ticket_type);
  const generated = plan.map((slot) => {
    const payload = generateQrPayload();
    return {
      payload,
      hash: hashQrPayload(payload),
      kind: slot.kind,
      guestIndex: slot.guestIndex,
    };
  });

  const outcome = await adminRepo.reissueTicketCodes(
    ticketId,
    generated.map(({ hash, kind, guestIndex }) => ({ hash, kind, guestIndex })),
  );

  if (!outcome.ok) {
    if (outcome.failure === 'NOT_FOUND') throw notFound('No such ticket');

    if (outcome.failure === 'MIGRATION_REQUIRED') {
      throw new AppError(
        503,
        'MIGRATION_REQUIRED',
        'Reprint needs database migration 014. Ask an administrator to run ' +
          'it. No ticket was changed.',
      );
    }

    if (outcome.failure === 'ALREADY_ENTERED') {
      const n = outcome.scannedCount ?? 0;
      throw conflict(
        `${n} guest${n === 1 ? ' has' : 's have'} already entered on this ` +
          `ticket. Reprinting would issue fresh codes for every seat and let ` +
          `them enter again, so it is blocked.`,
      );
    }

    throw conflict('That ticket is revoked and cannot be reprinted.');
  }

  await adminRepo.writeAudit({
    superuserId: scope.agentId,
    actorRole: 'AGENT',
    action: 'TICKET_REISSUED',
    entityType: 'ticket',
    entityId: ticketId,
    metadata: {
      ticket_number: ticket.ticket_number,
      codes_issued: generated.length,
      codes_revoked: outcome.revokedCount ?? 0,
    },
    ip: req.ip ?? null,
  });

  res.status(200).json({
    ticketId,
    qrCodes: generated.map((g, i) => ({
      id: `${ticketId}-${i}`,
      kind: g.kind,
      guest_index: g.guestIndex,
      payload: g.payload,
    })),
    revokedCount: outcome.revokedCount ?? 0,
  });
});
