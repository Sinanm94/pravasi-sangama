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
