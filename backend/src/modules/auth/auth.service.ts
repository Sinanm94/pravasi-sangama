import type {
  AgentClaims,
  AgentLoginInput,
  AgentSignupInput,
  AgentSignupResponse,
  ForgotPasswordInput,
  GateLoginInput,
  PublicGate,
  PublicUnit,
  ResetPasswordInput,
  ScannerClaims,
  SessionClaims,
  SessionResponse,
  SuperuserClaims,
  SuperuserLoginInput,
  UnitLoginInput,
  UnitPendingClaims,
} from '@pravasi/shared';
import { env } from '../../config/env.js';
import {
  hashSecret,
  hashToken,
  newId,
  newResetToken,
  verifyAgainstDummy,
  verifySecret,
} from '../../lib/crypto.js';
import { signSession } from '../../lib/jwt.js';
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  unauthorized,
} from '../../lib/errors.js';
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

  // Spec §3: agents sign in with mobile OR email.
  const agent = await repo.findAgentByMobileOrEmail(input.mobile_number);

  if (!agent || !agent.pin_hash) {
    await verifyAgainstDummy(input.password);
    throw unauthorized('Invalid mobile number or password');
  }

  if (!agent.is_active) {
    await verifyAgainstDummy(input.password);
    throw forbidden('This agent account is not active');
  }

  /* Approval gate. Checked AFTER the password so a stranger cannot probe
   * which numbers are registered — a pending account and a wrong password
   * must be indistinguishable until the password is right. */
  if (agent.approval_status !== 'APPROVED') {
    const okPassword = await verifySecret(input.password, agent.pin_hash);
    if (!okPassword) {
      throw unauthorized('Invalid mobile number or password');
    }

    throw new AppError(
      403,
      agent.approval_status === 'REJECTED'
        ? 'AGENT_REJECTED'
        : 'AGENT_PENDING_APPROVAL',
      agent.approval_status === 'REJECTED'
        ? 'This registration was declined. Contact the event administrator.'
        : 'Your registration is awaiting administrator approval.',
    );
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
/* Agent self-registration (spec §3)                                   */
/* =================================================================== */

const UNIQUE_VIOLATION = '23505';

export async function agentSignup(
  input: AgentSignupInput,
  ctx: RequestContext,
): Promise<AgentSignupResponse> {
  const unit = await repo.findUnitIdByCode(input.unit_code);
  if (!unit) {
    throw badRequest('That unit code does not exist. Check with your unit head.');
  }

  const passwordHash = await hashSecret(input.password);

  let created: { id: string };
  try {
    created = await repo.createSelfRegisteredAgent({
      unitId: unit.id,
      mobileNumber: input.mobile_number,
      name: input.name,
      email: input.email,
      passwordHash,
    });
  } catch (err) {
    // The unique indexes decide, not a pre-check — two simultaneous signups
    // on one number cannot both win.
    const e = err as { code?: string; constraint?: string };
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(
        e.constraint === 'agents_mobile_number_key'
          ? 'An account already exists for this mobile number.'
          : 'An account already exists for this email address.',
      );
    }
    throw err;
  }

  await repo.writeAudit({
    actorRole: null,
    actorId: null,
    action: 'AGENT_SELF_REGISTERED',
    entityType: 'agent',
    entityId: created.id,
    metadata: {
      mobile_number: input.mobile_number,
      unit_code: unit.unit_code,
    },
    ip: ctx.ip,
  });

  /* No session is issued. The account is PENDING until a superuser approves
   * it, which is the whole point — tickets are financial instruments and
   * self-service must not mint an issuer. */
  return {
    status: 'PENDING',
    message:
      'Registration received. An administrator must approve your account before you can sign in.',
    agent: {
      id: created.id,
      name: input.name,
      mobileNumber: input.mobile_number,
      email: input.email,
    },
  };
}

export async function listUnitsForSignup(): Promise<PublicUnit[]> {
  const rows = await repo.listPublicUnits();
  return rows.map((r) => ({
    unitCode: r.unit_code,
    name: r.name,
    sector: r.sector,
    divisionName: r.division_name,
  }));
}

/* =================================================================== */
/* Password reset (spec §3)                                            */
/* =================================================================== */

const RESET_TTL_MINUTES = 60;

/**
 * Always resolves, whether or not the address exists. Returning "no such
 * account" would turn this endpoint into a membership oracle for every email
 * an attacker cares to try.
 */
export async function requestPasswordReset(
  input: ForgotPasswordInput,
  ctx: RequestContext,
): Promise<{ token: string | null; agentEmail: string | null; agentName: string | null }> {
  const agent = await repo.findAgentByEmail(input.email);

  if (!agent || !agent.is_active || agent.approval_status !== 'APPROVED') {
    await repo.writeAudit({
      actorRole: null,
      actorId: null,
      action: 'PASSWORD_RESET_REQUESTED_UNKNOWN',
      metadata: { email: input.email },
      ip: ctx.ip,
    });
    return { token: null, agentEmail: null, agentName: null };
  }

  // Raw token goes in the email; only its hash is stored.
  const token = newResetToken();
  await repo.createPasswordResetToken({
    agentId: agent.id,
    tokenHash: hashToken(token),
    expiresAt: minutesFromNow(RESET_TTL_MINUTES),
  });

  await repo.writeAudit({
    actorRole: 'AGENT',
    actorId: agent.id,
    action: 'PASSWORD_RESET_REQUESTED',
    entityType: 'agent',
    entityId: agent.id,
    ip: ctx.ip,
  });

  return { token, agentEmail: agent.email, agentName: agent.name };
}

export async function resetPassword(
  input: ResetPasswordInput,
  ctx: RequestContext,
): Promise<void> {
  const passwordHash = await hashSecret(input.password);

  const claimed = await repo.consumeResetToken({
    tokenHash: hashToken(input.token),
    passwordHash,
  });

  if (!claimed) {
    throw badRequest('This reset link has expired or has already been used.');
  }

  await repo.writeAudit({
    actorRole: 'AGENT',
    actorId: claimed.agent_id,
    action: 'PASSWORD_RESET_COMPLETED',
    entityType: 'agent',
    entityId: claimed.agent_id,
    ip: ctx.ip,
  });
}

/* =================================================================== */
/* Gate scanner login (spec §2, Option A)                              */
/* =================================================================== */

export async function gateLogin(
  input: GateLoginInput,
  ctx: RequestContext,
): Promise<LoginResult> {
  const gate = await repo.findGateByCode(input.gate_code);

  if (!gate) {
    await verifyAgainstDummy(input.pin);
    throw unauthorized('Invalid gate or PIN');
  }

  if (!gate.is_active) {
    await verifyAgainstDummy(input.pin);
    throw forbidden('This gate is not active');
  }

  /* Daily PIN. A token minted yesterday is refused today, which is what
   * makes a PIN shared with volunteers acceptable — it stops working when
   * the event does. */
  if (gate.pin_valid_on && gate.pin_valid_on !== todayIso()) {
    await verifyAgainstDummy(input.pin);
    throw unauthorized('This gate PIN has expired. Ask for today’s PIN.');
  }

  const ok = await verifySecret(input.pin, gate.pin_hash);
  if (!ok) {
    await repo.writeAudit({
      actorRole: null,
      actorId: null,
      action: 'GATE_LOGIN_FAILED',
      entityType: 'gate',
      entityId: gate.id,
      metadata: { gate_code: gate.gate_code },
      ip: ctx.ip,
    });
    throw unauthorized('Invalid gate or PIN');
  }

  const ttlMinutes = env.GATE_SESSION_TTL_MINUTES;
  const sessionId = newId();
  const expiresAt = minutesFromNow(ttlMinutes);

  const claims: ScannerClaims = {
    role: 'SCANNER',
    sessionId,
    gateId: gate.id,
    gateCode: gate.gate_code,
    gateName: gate.name,
    divisionId: gate.division_id,
  };
  const token = signSession(claims, ttlMinutes);

  await repo.createGateSession({
    id: sessionId,
    gateId: gate.id,
    tokenHash: hashToken(token),
    expiresAt,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  await repo.writeAudit({
    actorRole: null,
    actorId: null,
    action: 'GATE_LOGIN',
    entityType: 'gate_session',
    entityId: sessionId,
    metadata: { gate_code: gate.gate_code },
    ip: ctx.ip,
  });

  return {
    token,
    ttlMinutes,
    session: {
      role: 'SCANNER',
      gate: { id: gate.id, gateCode: gate.gate_code, name: gate.name },
      expiresAt: expiresAt.toISOString(),
    },
  };
}

export async function listGatesForLogin(): Promise<PublicGate[]> {
  const rows = await repo.listPublicGates();
  return rows.map((r) => ({ gateCode: r.gate_code, name: r.name }));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

  if (claims.role === 'SCANNER') {
    // Re-read the session so a revoked gate or a deactivated one is rejected
    // on the next request rather than at token expiry.
    const live = await repo.findLiveGateSession(claims.sessionId);
    if (!live) {
      throw unauthorized('Gate session is no longer valid');
    }

    return {
      role: 'SCANNER',
      gate: {
        id: claims.gateId,
        gateCode: claims.gateCode,
        name: claims.gateName,
      },
      expiresAt: '',
    };
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
