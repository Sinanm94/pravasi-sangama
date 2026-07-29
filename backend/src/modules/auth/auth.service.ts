import type {
  AgentLoginInput,
  SessionClaims,
  SessionResponse,
  SuperuserClaims,
  SuperuserLoginInput,
  UnitLoginInput,
  UnitPendingClaims,
  AgentClaims,
} from '@pravasi/shared';
import { env } from '../../config/env.js';
import {
  hashToken,
  newId,
  verifyAgainstDummy,
  verifySecret,
} from '../../lib/crypto.js';
import { signSession } from '../../lib/jwt.js';
import { AppError, conflict, forbidden, unauthorized } from '../../lib/errors.js';
import * as repo from './auth.repository.js';

interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface LoginResult {
  token: string;
  ttlMinutes: number;
  session: SessionResponse;
}

const minutesFromNow = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000);

/* =================================================================== */
/* STEP 1 — Unit location authentication                               */
/* =================================================================== */

export async function unitLogin(
  input: UnitLoginInput,
  ctx: RequestContext,
): Promise<LoginResult> {
  const units = await repo.findUnitsByCode(input.unit_code, input.division_code);

  if (units.length === 0) {
    // Constant-time miss: a wrong unit code must cost the same as a wrong PIN.
    await verifyAgainstDummy(input.pin);
    throw unauthorized('Invalid unit code or PIN');
  }

  if (units.length > 1) {
    throw new AppError(
      409,
      'AMBIGUOUS_UNIT_CODE',
      'This unit code exists in more than one division. Include division_code.',
      { divisions: units.map((u) => u.division_code) },
    );
  }

  const unit = units[0]!;

  if (!unit.is_active) {
    await verifyAgainstDummy(input.pin);
    throw forbidden('This unit is not active');
  }

  const ok = await verifySecret(input.pin, unit.access_code_hash);
  if (!ok) {
    await repo.writeAudit({
      actorRole: null,
      actorId: null,
      action: 'UNIT_LOGIN_FAILED',
      entityType: 'unit',
      entityId: unit.id,
      metadata: { unit_code: unit.unit_code },
      ip: ctx.ip,
    });
    throw unauthorized('Invalid unit code or PIN');
  }

  const ttlMinutes = env.UNIT_SESSION_TTL_MINUTES;
  const sessionId = newId();
  const expiresAt = minutesFromNow(ttlMinutes);

  // Sign first so the session row can store the hash of this exact token.
  const claims: UnitPendingClaims = {
    role: 'UNIT_PENDING',
    sessionId,
    unitId: unit.id,
    divisionId: unit.division_id,
  };
  const token = signSession(claims, ttlMinutes);

  await repo.createUnitSession({
    id: sessionId,
    unitId: unit.id,
    tokenHash: hashToken(token),
    expiresAt,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  await repo.writeAudit({
    actorRole: null,
    actorId: null,
    action: 'UNIT_LOGIN',
    entityType: 'unit_session',
    entityId: sessionId,
    metadata: { unit_code: unit.unit_code },
    ip: ctx.ip,
  });

  return {
    token,
    ttlMinutes,
    session: {
      role: 'UNIT_PENDING',
      unit: {
        id: unit.id,
        unitCode: unit.unit_code,
        name: unit.name,
        sector: unit.sector,
      },
      division: {
        id: unit.division_id,
        name: unit.division_name,
        code: unit.division_code,
      },
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/* =================================================================== */
/* STEP 2 — Individual agent authentication                            */
/* =================================================================== */

export async function agentLogin(
  input: AgentLoginInput,
  pending: UnitPendingClaims,
  rawToken: string,
  ctx: RequestContext,
): Promise<LoginResult> {
  const session = await repo.findLiveSession(pending.sessionId);

  if (!session) {
    throw unauthorized('Unit session has expired. Sign in to the unit again.');
  }

  // The cookie must be the token this session was issued with. A valid
  // signature is not enough — a rotated or revoked token is dead.
  if (session.token_hash !== hashToken(rawToken)) {
    throw unauthorized('Session token is no longer valid');
  }

  if (session.agent_id !== null) {
    throw conflict('An agent is already bound to this session');
  }

  const agent = await repo.findAgentByMobile(input.mobile_number);

  if (!agent || !agent.pin_hash) {
    await verifyAgainstDummy(input.password);
    throw unauthorized('Invalid mobile number or password');
  }

  if (!agent.is_active) {
    await verifyAgainstDummy(input.password);
    throw forbidden('This agent account is not active');
  }

  const ok = await verifySecret(input.password, agent.pin_hash);
  if (!ok) {
    await repo.writeAudit({
      actorRole: null,
      actorId: null,
      action: 'AGENT_LOGIN_FAILED',
      entityType: 'agent',
      entityId: agent.id,
      metadata: { reason: 'BAD_CREDENTIALS', session_id: session.id },
      ip: ctx.ip,
    });
    throw unauthorized('Invalid mobile number or password');
  }

  /* --- THE critical check ---------------------------------------- *
   * Correct credentials are not sufficient. The agent must belong to
   * the unit that was authenticated in step 1. This is what stops a
   * valid agent from issuing tickets against someone else's unit.    */
  if (agent.unit_id !== pending.unitId) {
    await repo.writeAudit({
      actorRole: 'AGENT',
      actorId: agent.id,
      action: 'AGENT_UNIT_MISMATCH',
      entityType: 'unit_session',
      entityId: session.id,
      metadata: {
        agent_unit_id: agent.unit_id,
        session_unit_id: pending.unitId,
      },
      ip: ctx.ip,
    });
    throw forbidden('You are not assigned to this unit');
  }

  const ttlMinutes = env.AGENT_TOKEN_TTL_MINUTES;
  const expiresAt = minutesFromNow(ttlMinutes);

  const claims: AgentClaims = {
    role: 'AGENT',
    sessionId: session.id,
    agentId: agent.id,
    unitId: pending.unitId,
    divisionId: pending.divisionId,
  };
  const token = signSession(claims, ttlMinutes);

  const bound = await repo.bindAgentToSession({
    sessionId: session.id,
    agentId: agent.id,
    tokenHash: hashToken(token),
    expiresAt,
  });

  // Lost the race against a concurrent step 2 on the same session.
  if (!bound) {
    throw conflict('An agent is already bound to this session');
  }

  await repo.writeAudit({
    actorRole: 'AGENT',
    actorId: agent.id,
    action: 'AGENT_LOGIN',
    entityType: 'unit_session',
    entityId: session.id,
    metadata: { unit_id: pending.unitId },
    ip: ctx.ip,
  });

  return {
    token,
    ttlMinutes,
    session: {
      role: 'AGENT',
      agent: {
        id: agent.id,
        name: agent.name,
        mobileNumber: agent.mobile_number,
      },
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/* =================================================================== */
/* Superuser — single step, no unit scoping (§3.1)                     */
/* =================================================================== */

export async function superuserLogin(
  input: SuperuserLoginInput,
  ctx: RequestContext,
): Promise<LoginResult> {
  const user = await repo.findSuperuserByUsername(input.username);

  if (!user) {
    await verifyAgainstDummy(input.password);
    throw unauthorized('Invalid username or password');
  }

  if (!user.is_active) {
    await verifyAgainstDummy(input.password);
    throw forbidden('This account is not active');
  }

  const ok = await verifySecret(input.password, user.password_hash);
  if (!ok) {
    await repo.writeAudit({
      actorRole: 'SUPERUSER',
      actorId: user.id,
      action: 'SUPERUSER_LOGIN_FAILED',
      ip: ctx.ip,
    });
    throw unauthorized('Invalid username or password');
  }

  const ttlMinutes = env.SUPERUSER_TOKEN_TTL_MINUTES;
  const expiresAt = minutesFromNow(ttlMinutes);

  const claims: SuperuserClaims = {
    role: 'SUPERUSER',
    superuserId: user.id,
  };
  const token = signSession(claims, ttlMinutes);

  await repo.touchSuperuserLogin(user.id);
  await repo.writeAudit({
    actorRole: 'SUPERUSER',
    actorId: user.id,
    action: 'SUPERUSER_LOGIN',
    ip: ctx.ip,
  });

  return {
    token,
    ttlMinutes,
    session: {
      role: 'SUPERUSER',
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/* =================================================================== */
/* Session description — what the client hydrates its store from       */
/* =================================================================== */

export async function describeSession(
  claims: SessionClaims,
): Promise<SessionResponse & { role: SessionClaims['role'] }> {
  if (claims.role === 'SUPERUSER') {
    return { role: 'SUPERUSER', expiresAt: '' };
  }

  const ctx = await repo.loadSessionContext(claims.sessionId);

  if (!ctx) {
    // Token verifies but its session row is gone (revoked or pruned).
    throw unauthorized('Session no longer exists');
  }

  return {
    role: claims.role,
    unit: {
      id: ctx.unit_id,
      unitCode: ctx.unit_code,
      name: ctx.unit_name,
      sector: ctx.unit_sector,
    },
    division: {
      id: ctx.division_id,
      name: ctx.division_name,
      code: ctx.division_code,
    },
    agent:
      claims.role === 'AGENT' && ctx.agent_id
        ? {
            id: ctx.agent_id,
            name: ctx.agent_name ?? '',
            mobileNumber: ctx.agent_mobile ?? '',
          }
        : undefined,
    expiresAt: '',
  };
}

/* =================================================================== */

export async function logout(
  sessionId: string,
  ctx: RequestContext,
): Promise<void> {
  await repo.revokeSession(sessionId);
  await repo.writeAudit({
    actorRole: null,
    actorId: null,
    action: 'SESSION_REVOKED',
    entityType: 'unit_session',
    entityId: sessionId,
    ip: ctx.ip,
  });
}
