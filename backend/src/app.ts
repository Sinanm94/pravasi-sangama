import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { apiRouter } from './modules/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind nginx/ingress — needed for real client IPs
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true, // JWTs ride in httpOnly cookies
    }),
  );
  /**
   * 256kb everywhere — except the ticket-image share route, which carries a
   * multi-megabyte base64 PNG and installs its own parser in tickets.routes.
   * Raising this globally would let any endpoint accept megabytes.
   */
  const jsonParser = express.json({ limit: '256kb' });
  app.use((req, res, next) => {
    if (req.path === '/api/tickets/share/email') return next();
    return jsonParser(req, res, next);
  });

  app.use(cookieParser());

  // Blunt global ceiling. Auth and scan endpoints get their own tighter
  // limits at the module level — a gate scanner legitimately fires fast,
  // a login endpoint does not.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
