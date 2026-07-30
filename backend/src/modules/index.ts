import { Router } from 'express';
import { healthcheck } from '../db/index.js';
import { loadSession } from '../middleware/auth.js';
import { authRoutes } from './auth/auth.routes.js';
import { adminRoutes } from './admin/admin.routes.js';
import { ticketRoutes } from './tickets/tickets.routes.js';
import { scanRoutes } from './scanning/scanning.routes.js';
import { analyticsRoutes } from './analytics/analytics.routes.js';

/**
 * Feature routers mount here. Each module owns
 * routes / controller / service / repository in its own folder.
 *
 * TODO as modules land:
 *   apiRouter.use('/divisions',  divisionRoutes);
 *   apiRouter.use('/units',      unitRoutes);
 *   apiRouter.use('/agents',     agentRoutes);
 *   apiRouter.use('/analytics',  analyticsRoutes);
 *   apiRouter.use('/audit',      auditRoutes);
 */
export const apiRouter: Router = Router();

// Attaches req.auth when a cookie is present. Guards are per-route.
apiRouter.use(loadSession);

apiRouter.use('/auth', authRoutes);
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/tickets', ticketRoutes);
apiRouter.use('/scan', scanRoutes);
apiRouter.use('/analytics', analyticsRoutes);

apiRouter.get('/health', async (_req, res) => {
  const db = await healthcheck();
  res.status(db ? 200 : 503).json({
    status: db ? 'ok' : 'degraded',
    db: db ? 'up' : 'down',
    timestamp: new Date().toISOString(),
  });
});
