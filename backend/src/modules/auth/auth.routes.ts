import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from './auth.controller.js';

/**
 * Login endpoints get a far tighter limit than the global ceiling. A gate
 * scanner legitimately fires fast; a login form does not.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Too many login attempts. Try again shortly.',
    },
  },
});

export const authRoutes: Router = Router();

authRoutes.post('/unit-login', loginLimiter, controller.unitLogin);
authRoutes.post('/agent-login', loginLimiter, controller.agentLogin);
authRoutes.post('/superuser-login', loginLimiter, controller.superuserLogin);
authRoutes.get('/session', controller.currentSession);
authRoutes.post('/logout', controller.logout);
