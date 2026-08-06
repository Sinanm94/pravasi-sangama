import type { Request, RequestHandler, Response } from 'express';
import {
  AgentLoginSchema,
  AgentSignupSchema,
  GateLoginSchema,
  SESSION_COOKIE_NAME,
  SuperuserLoginSchema,
  UnitAdminLoginSchema,
  UnitGatewaySchema,
} from '@pravasi/shared';
import { clearSessionCookie, setSessionCookie, verifySession } from '../../lib/jwt.js';
import * as service from './auth.service.js';

const contextOf = (req: Request) => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** Small async wrapper so throws land in the central error handler. */
const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/* ------------------------------------------------------------------ */
/* POST /api/auth/agent-login — single step (§3.2)                     */
/* ------------------------------------------------------------------ */

export const agentLogin = handle(async (req, res) => {
  // No unit-session precondition — see the note on service.agentLogin. The
  // unit is derived from the agent's own row, so nothing here reads a
  // caller-supplied unit or an incoming cookie.
  const input = AgentLoginSchema.parse(req.body);
  const result = await service.agentLogin(input, contextOf(req));

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
/* POST /api/auth/unit-admin-login — decentralised approvals (§2)      */
/* ------------------------------------------------------------------ */

export const unitAdminLogin = handle(async (req, res) => {
  const input = UnitAdminLoginSchema.parse(req.body);
  const result = await service.unitAdminLogin(input, contextOf(req));

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
/* POST /api/auth/unit-gateway — the Unit Gateway (§3.2)               */
/* ------------------------------------------------------------------ */

export const unitGateway = handle(async (req, res) => {
  const input = UnitGatewaySchema.parse(req.body);
  const result = await service.verifyUnitGateway(input);

  // No cookie: this isn't a session, just a one-time reveal of which unit
  // to hardcode into the forms behind it.
  res.status(200).json(result);
});

/* ------------------------------------------------------------------ */
/* Password reset — retired for agents; see auth.service.ts            */
/* ------------------------------------------------------------------ */

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
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;

  // Not an error — the client asks this on every boot to decide what to
  // render, and "nobody is signed in" is a normal answer.
  if (!rawToken) {
    res.status(200).json({ role: null });
    return;
  }

  let claims;
  try {
    claims = verifySession(rawToken);
  } catch {
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
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;

  if (rawToken) {
    try {
      const claims = verifySession(rawToken);
      if ('sessionId' in claims) {
        await service.logout(claims.sessionId, contextOf(req));
      }
    } catch {
      // Already invalid — clearing the cookie is still the right outcome.
    }
  }

  clearSessionCookie(res);
  res.status(204).send();
});
