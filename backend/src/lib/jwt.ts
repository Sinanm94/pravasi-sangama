import jwt from 'jsonwebtoken';
import type { SessionClaims } from '@pravasi/shared';
import { SESSION_COOKIE_NAME } from '@pravasi/shared';
import type { Response } from 'express';
import { env, isProduction } from '../config/env.js';
import { unauthorized } from './errors.js';

export function signSession(claims: SessionClaims, ttlMinutes: number): string {
  return jwt.sign(claims, env.JWT_SECRET, {
    issuer: env.JWT_ISSUER,
    expiresIn: ttlMinutes * 60,
  });
}

export function verifySession(token: string): SessionClaims {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
    }) as SessionClaims;
  } catch {
    throw unauthorized('Session is invalid or has expired');
  }
}

/**
 * SameSite=None is only honoured on a Secure cookie. Browsers treat
 * localhost as a secure context, so this works over plain http in dev.
 */
const cookieOptions = {
  httpOnly: true as const, // never localStorage — these are shared phones
  secure: isProduction || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  path: '/' as const,
  /**
   * Unset in dev and on a single-hostname deployment, giving a host-only
   * cookie. Set to the shared parent (`.pravasisangama.com`) when the web
   * tier and API are split across `app.` / `api.` subdomains — otherwise the
   * cookie is bound to `api.` and `middleware.ts` on `app.` never sees it.
   *
   * `domain: undefined` is how Express omits the attribute entirely, so the
   * unset case stays host-only rather than becoming a literal "undefined".
   */
  domain: env.COOKIE_DOMAIN,
};

export function setSessionCookie(
  res: Response,
  token: string,
  ttlMinutes: number,
): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    ...cookieOptions,
    maxAge: ttlMinutes * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  // Must match the set options exactly or the browser keeps the cookie.
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
}

export { SESSION_COOKIE_NAME };
