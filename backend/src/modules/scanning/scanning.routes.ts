import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAgent } from '../../middleware/auth.js';
import * as controller from './scanning.controller.js';

/**
 * Deliberately loose. A gate legitimately fires several scans per second, and
 * a whole venue can sit behind one NAT — a tight per-IP limit here would
 * throttle the gate itself. This is a runaway guard only; abuse is caught by
 * the per-agent audit trail in scan_logs, not by rate limiting.
 */
const scanLimiter = rateLimit({
  windowMs: 60_000,
  limit: 1200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Scan rate limit exceeded.',
    },
  },
});

export const scanRoutes: Router = Router();

scanRoutes.post('/verify', requireAgent, scanLimiter, controller.verifyScan);

/**
 * Batch drain. A device returning from a long outage sends up to 200 scans
 * per request, so this is limited by request count, not by scan count.
 */
const syncLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

scanRoutes.post('/bulk-sync', requireAgent, syncLimiter, controller.bulkSync);
