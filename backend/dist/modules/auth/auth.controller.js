import { AgentLoginSchema, AgentSignupSchema, ForgotPasswordSchema, GateLoginSchema, ResetPasswordSchema, SESSION_COOKIE_NAME, SuperuserLoginSchema, UnitLoginSchema, } from '@pravasi/shared';
import { clearSessionCookie, setSessionCookie, verifySession } from '../../lib/jwt.js';
import { unauthorized } from '../../lib/errors.js';
import { sendPasswordResetEmail } from './auth.email.js';
import * as service from './auth.service.js';
const contextOf = (req) => ({
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
});
/** Small async wrapper so throws land in the central error handler. */
const handle = (fn) => (req, res, next) => {
    fn(req, res).catch(next);
};
/* ------------------------------------------------------------------ */
/* POST /api/auth/unit-login — step 1                                  */
/* ------------------------------------------------------------------ */
export const unitLogin = handle(async (req, res) => {
    const input = UnitLoginSchema.parse(req.body);
    const result = await service.unitLogin(input, contextOf(req));
    setSessionCookie(res, result.token, result.ttlMinutes);
    res.status(200).json({
        ...result.session,
        next_step: 'AGENT_LOGIN',
    });
});
/* ------------------------------------------------------------------ */
/* POST /api/auth/agent-login — step 2                                 */
/* ------------------------------------------------------------------ */
export const agentLogin = handle(async (req, res) => {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (!rawToken) {
        throw unauthorized('Authenticate the unit first');
    }
    const claims = verifySession(rawToken);
    // Step 2 is reachable only from a step-1 session. Never accept a mobile
    // number and hand back a full agent token directly.
    if (claims.role !== 'UNIT_PENDING') {
        throw unauthorized('Authenticate the unit first');
    }
    const input = AgentLoginSchema.parse(req.body);
    const result = await service.agentLogin(input, claims, rawToken, contextOf(req));
    // Overwrite the pending cookie with the full-access token.
    setSessionCookie(res, result.token, result.ttlMinutes);
    res.status(200).json(result.session);
});
/* ------------------------------------------------------------------ */
/* POST /api/auth/superuser-login — §3.1, single step                  */
/* ------------------------------------------------------------------ */
export const superuserLogin = handle(async (req, res) => {
    const input = SuperuserLoginSchema.parse(req.body);
    const result = await service.superuserLogin(input, contextOf(req));
    setSessionCookie(res, result.token, result.ttlMinutes);
    res.status(200).json(result.session);
});
/* ------------------------------------------------------------------ */
/* POST /api/auth/signup — agent first-time setup (spec §3)            */
/* ------------------------------------------------------------------ */
export const agentSignup = handle(async (req, res) => {
    const input = AgentSignupSchema.parse(req.body);
    const result = await service.agentSignup(input, contextOf(req));
    // 202, not 201: the account exists but is not yet usable, and no cookie
    // is set. Approval is a separate, human step.
    res.status(202).json(result);
});
/** Public unit picker for the signup form. Codes are not secrets; PINs are. */
export const publicUnits = handle(async (_req, res) => {
    res.status(200).json({ units: await service.listUnitsForSignup() });
});
/* ------------------------------------------------------------------ */
/* Password reset (spec §3)                                            */
/* ------------------------------------------------------------------ */
export const forgotPassword = handle(async (req, res) => {
    const input = ForgotPasswordSchema.parse(req.body);
    const result = await service.requestPasswordReset(input, contextOf(req));
    if (result.token && result.agentEmail) {
        try {
            await sendPasswordResetEmail({
                to: result.agentEmail,
                name: result.agentName ?? 'there',
                token: result.token,
            });
        }
        catch (err) {
            // A delivery failure must not change the response shape — see below.
            console.error('[auth] reset email failed to send', err);
        }
    }
    /* Always 200, always the same body. Telling the caller whether an address
     * exists turns this endpoint into a membership oracle for every email an
     * attacker cares to try. */
    res.status(200).json({
        message: 'If that address has an approved account, a reset link is on its way.',
    });
});
export const resetPassword = handle(async (req, res) => {
    const input = ResetPasswordSchema.parse(req.body);
    await service.resetPassword(input, contextOf(req));
    res.status(200).json({ message: 'Password updated. You can sign in now.' });
});
/* ------------------------------------------------------------------ */
/* POST /api/auth/gate-login — scanner (spec §2, Option A)             */
/* ------------------------------------------------------------------ */
export const gateLogin = handle(async (req, res) => {
    const input = GateLoginSchema.parse(req.body);
    const result = await service.gateLogin(input, contextOf(req));
    setSessionCookie(res, result.token, result.ttlMinutes);
    res.status(200).json(result.session);
});
/** Public gate picker for the scanner login screen. */
export const publicGates = handle(async (_req, res) => {
    res.status(200).json({ gates: await service.listGatesForLogin() });
});
/* ------------------------------------------------------------------ */
/* GET /api/auth/session — who am I                                    */
/* ------------------------------------------------------------------ */
export const currentSession = handle(async (req, res) => {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
    // Not an error — the client asks this on every boot to decide what to
    // render, and "nobody is signed in" is a normal answer.
    if (!rawToken) {
        res.status(200).json({ role: null });
        return;
    }
    let claims;
    try {
        claims = verifySession(rawToken);
    }
    catch {
        // Expired or tampered. Clear it so the client stops resending a dead
        // cookie on every request.
        clearSessionCookie(res);
        res.status(200).json({ role: null });
        return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(await service.describeSession(claims));
});
/* ------------------------------------------------------------------ */
/* POST /api/auth/logout                                               */
/* ------------------------------------------------------------------ */
export const logout = handle(async (req, res) => {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (rawToken) {
        try {
            const claims = verifySession(rawToken);
            if ('sessionId' in claims) {
                await service.logout(claims.sessionId, contextOf(req));
            }
        }
        catch {
            // Already invalid — clearing the cookie is still the right outcome.
        }
    }
    clearSessionCookie(res);
    res.status(204).send();
});
//# sourceMappingURL=auth.controller.js.map