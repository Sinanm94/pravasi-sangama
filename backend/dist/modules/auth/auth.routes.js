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
export const authRoutes = Router();
/* --- Agent: two-step login (§3.2) -------------------------------- */
authRoutes.post('/unit-login', loginLimiter, controller.unitLogin);
authRoutes.post('/agent-login', loginLimiter, controller.agentLogin);
/* --- Agent: first-time setup (spec §3) --------------------------- */
authRoutes.post('/signup', signupLimiter, controller.agentSignup);
authRoutes.get('/units', controller.publicUnits);
/* --- Agent: forgot password (spec §3) ---------------------------- */
authRoutes.post('/forgot-password', signupLimiter, controller.forgotPassword);
authRoutes.post('/reset-password', signupLimiter, controller.resetPassword);
/* --- Scanner: gate PIN (spec §2, Option A) ----------------------- */
authRoutes.post('/gate-login', loginLimiter, controller.gateLogin);
authRoutes.get('/gates', controller.publicGates);
/* --- Superuser (spec §4) — there is deliberately no signup route -- */
authRoutes.post('/superuser-login', loginLimiter, controller.superuserLogin);
authRoutes.get('/session', controller.currentSession);
authRoutes.post('/logout', controller.logout);
//# sourceMappingURL=auth.routes.js.map