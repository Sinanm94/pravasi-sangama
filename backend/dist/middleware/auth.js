import { SESSION_COOKIE_NAME } from '@pravasi/shared';
import { verifySession } from '../lib/jwt.js';
import { agentNotBound, forbidden, unauthorized } from '../lib/errors.js';
/** Reads and verifies the cookie, if present. Never rejects on its own. */
export const loadSession = (req, _res, next) => {
    const raw = req.cookies?.[SESSION_COOKIE_NAME];
    if (raw) {
        req.auth = verifySession(raw);
        req.rawToken = raw;
    }
    next();
};
/**
 * Full agent access. A UNIT_PENDING session is explicitly distinguished from
 * no session at all — the client needs to know to show step 2, not step 1.
 */
export const requireAgent = (req, _res, next) => {
    if (!req.auth)
        return next(unauthorized());
    if (req.auth.role === 'UNIT_PENDING')
        return next(agentNotBound());
    if (req.auth.role !== 'AGENT')
        return next(forbidden('Agent access required'));
    next();
};
export const requireSuperuser = (req, _res, next) => {
    if (!req.auth)
        return next(unauthorized());
    if (req.auth.role !== 'SUPERUSER') {
        return next(forbidden('Superuser access required'));
    }
    next();
};
/**
 * Authorization is always evaluated from the token's own unitId, never from
 * a client-supplied one. Use this to read the scope on any write path.
 */
export function agentScope(req) {
    if (!req.auth || req.auth.role !== 'AGENT') {
        throw unauthorized();
    }
    return req.auth;
}
//# sourceMappingURL=auth.js.map