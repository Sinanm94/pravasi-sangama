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
 * Gate scanning is open to a bound AGENT or a SCANNER gate session.
 *
 * Deliberately NOT extended to SUPERUSER: an admin has no business consuming
 * a guest code, and every admission must trace to a person or a physical
 * gate. Issuance stays `requireAgent` — a scanner can admit, never issue.
 */
export const requireScanAccess = (req, _res, next) => {
    if (!req.auth)
        return next(unauthorized());
    if (req.auth.role === 'UNIT_PENDING')
        return next(agentNotBound());
    if (req.auth.role !== 'AGENT' && req.auth.role !== 'SCANNER') {
        return next(forbidden('Gate access required'));
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
export function scanActor(req) {
    if (!req.auth)
        throw unauthorized();
    if (req.auth.role === 'AGENT') {
        return {
            kind: 'AGENT',
            agentId: req.auth.agentId,
            unitId: req.auth.unitId,
            divisionId: req.auth.divisionId,
        };
    }
    if (req.auth.role === 'SCANNER') {
        return {
            kind: 'GATE',
            gateId: req.auth.gateId,
            gateCode: req.auth.gateCode,
            gateName: req.auth.gateName,
        };
    }
    throw forbidden('Gate access required');
}
//# sourceMappingURL=auth.js.map