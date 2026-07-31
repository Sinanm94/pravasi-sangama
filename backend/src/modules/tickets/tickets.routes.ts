import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { MAX_TICKET_IMAGE_BASE64 } from '@pravasi/shared';
import { requireAgent } from '../../middleware/auth.js';
import * as controller from './tickets.controller.js';

/**
 * A registration desk works fast but not machine-fast. This is a runaway
 * guard, not a throttle on legitimate use.
 */
const issueLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many registrations submitted. Slow down.',
    },
  },
});

export const ticketRoutes: Router = Router();

// requireAgent rejects any non-AGENT session with a 401.

/** The agent's own ledger. Scoped to the token's agentId in the query. */
ticketRoutes.get('/mine', requireAgent, controller.myTickets);

ticketRoutes.post(
  '/issue',
  requireAgent,
  issueLimiter,
  controller.issueTicket,
);

/**
 * Email delivery carries a base64 PNG of the pass, so it needs its own body
 * limit — the global parser in app.ts caps at 256kb and would reject it.
 * app.ts skips this path so this parser is the only one that runs on it.
 */
const imageBodyParser = express.json({
  limit: MAX_TICKET_IMAGE_BASE64 + 4096, // headroom for the JSON envelope
});

const shareLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20, // each request is multi-megabyte; this is a bandwidth guard
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many share requests. Wait a moment.',
    },
  },
});

ticketRoutes.post(
  '/share/email',
  requireAgent,
  shareLimiter,
  imageBodyParser,
  controller.shareByEmail,
);
