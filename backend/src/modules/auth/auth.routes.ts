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

/**
 * Signup and password reset are stricter still. Both create real state from
 * an unauthenticated request, and reset also sends mail — an endpoint that
 * emails a third party on demand needs a tight ceiling.
 */
const signupLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Too many attempts. Try again later.',
    },
  },
});

export const authRoutes: Router = Router();

/* --- Unit Gateway — reinstated unit-first gate (§3.2) ------------- */
// Same rate-limiting posture as gate PINs (loginLimiter): a 4-digit space
// is small, and this endpoint accepts the exact same brute-force profile
// this codebase already lives with for gates — mitigated, not solved, by
// keeping the attempt ceiling tight.
authRoutes.post('/unit-gateway', loginLimiter, controller.unitGateway);

/* --- Agent: single-step login (§3.2) ------------------------------ */
authRoutes.post('/agent-login', loginLimiter, controller.agentLogin);

/* --- Agent: first-time setup (spec §3) --------------------------- */
authRoutes.post('/signup', signupLimiter, controller.agentSignup);
authRoutes.get('/units', controller.publicUnits);

/* --- Agent: password recovery ------------------------------------- *
 * No routes. Email-based self-service reset is retired — agents share
 * email addresses (migration 013), which made it an account-takeover
 * path. Recovery is POST /api/unit-admin/agents/:id/reset-password,
 * performed by the agent's own unit admin. See auth.service.ts.
 */

/* --- Scanner: gate PIN (spec §2, Option A) ----------------------- */
authRoutes.post('/gate-login', loginLimiter, controller.gateLogin);
authRoutes.get('/gates', controller.publicGates);

/* --- Superuser (spec §4) — there is deliberately no signup route -- */
authRoutes.post('/superuser-login', loginLimiter, controller.superuserLogin);

/* --- Unit admin (§2) — decentralised approvals, no signup route --- */
authRoutes.post(
  '/unit-admin-login',
  loginLimiter,
  controller.unitAdminLogin,
);

authRoutes.get('/session', controller.currentSession);
authRoutes.post('/logout', controller.logout);
