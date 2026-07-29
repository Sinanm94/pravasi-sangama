import type { Request, RequestHandler, Response } from 'express';
import * as service from './analytics.service.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/* ------------------------------------------------------------------ */
/* GET /api/analytics/dashboard                                        */
/* ------------------------------------------------------------------ */

export const dashboard = handle(async (_req, res) => {
  const snapshot = await service.dashboard();

  // Polled every 5s. Any intermediary caching this would show stale gate
  // counts, which is worse than no dashboard at all.
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(snapshot);
});
