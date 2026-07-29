import type { Request, RequestHandler, Response } from 'express';
import { IssueTicketSchema, ShareTicketEmailSchema } from '@pravasi/shared';
import { agentScope } from '../../middleware/auth.js';
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
