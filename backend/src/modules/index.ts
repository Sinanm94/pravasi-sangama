import { Router } from 'express';
import { healthcheck } from '../db/index.js';
import { loadSession, requireSuperuser } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { isMailConfigured, verifyMailTransport } from '../lib/mailer.js';
import { authRoutes } from './auth/auth.routes.js';
import { adminRoutes } from './admin/admin.routes.js';
import { unitAdminRoutes } from './unit-admin/unit-admin.routes.js';
import { ticketRoutes } from './tickets/tickets.routes.js';
import { clientRoutes } from './clients/clients.routes.js';
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
apiRouter.use('/unit-admin', unitAdminRoutes);
apiRouter.use('/tickets', ticketRoutes);
apiRouter.use('/scan', scanRoutes);
apiRouter.use('/clients', clientRoutes);
apiRouter.use('/analytics', analyticsRoutes);

apiRouter.get('/health', async (_req, res) => {
  const db = await healthcheck();
  res.status(db ? 200 : 503).json({
    status: db ? 'ok' : 'degraded',
    db: db ? 'up' : 'down',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/health/mail — does SMTP actually work from this server?
 *
 * Superuser-only, because it reports the mail configuration. It opens a
 * real connection and authenticates (nodemailer's `verify()`), so it
 * answers the question the ticket-share 500 could not: is the host
 * reachable, and does the login succeed — without having to issue a ticket
 * and hit Send to find out.
 *
 * NEVER returns SMTP_PASS, and reports the user as a boolean rather than a
 * value: this is a diagnostic, and a diagnostic that leaks the credential
 * it is diagnosing is a worse problem than the outage.
 */
apiRouter.get('/health/mail', requireSuperuser, async (_req, res) => {
  if (!isMailConfigured()) {
    res.status(503).json({
      status: 'not_configured',
      missing: [
        ...(env.SMTP_HOST ? [] : ['SMTP_HOST']),
        ...(env.MAIL_FROM ? [] : ['MAIL_FROM']),
      ],
      hint: 'Both SMTP_HOST and MAIL_FROM must be set for email to send.',
    });
    return;
  }

  const result = await verifyMailTransport();

  res.status(result.ok ? 200 : 502).json({
    status: result.ok ? 'ok' : 'failed',
    config: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      from: env.MAIL_FROM,
      authConfigured: Boolean(env.SMTP_USER && env.SMTP_PASS),
    },
    ...(result.ok ? {} : { error: result.error, hint: result.hint }),
  });
});
