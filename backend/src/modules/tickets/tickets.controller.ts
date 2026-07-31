import type { Request, RequestHandler, Response } from 'express';
import {
  IssueTicketSchema,
  ShareTicketEmailSchema,
  type AgentTicketListResponse,
  type AgentTicketSummary,
} from '@pravasi/shared';
import { agentScope } from '../../middleware/auth.js';
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
