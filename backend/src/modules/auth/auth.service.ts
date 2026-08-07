import type {
  AgentClaims,
  AgentLoginInput,
  AgentSignupInput,
  AgentSignupResponse,
  GateLoginInput,
  PublicGate,
  PublicUnit,
  ScannerClaims,
  SessionClaims,
  SessionResponse,
  SuperuserClaims,
  SuperuserLoginInput,
  UnitAdminClaims,
  UnitAdminLoginInput,
  UnitGatewayInput,
  UnitGatewayResponse,
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
import { generateAgentPassword } from '../../lib/passwordGen.js';
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
/* Agent authentication — single step (§3.2)                           */
/* =================================================================== */

/**
 * Agent login — single step.
 *
 * DEVIATES FROM CLAUDE.md §3.2 BY EXPLICIT OPERATIONAL DECISION. The event is
 * run by unpaid volunteers who cannot distribute unit codes and PINs on the
 * day, so location authentication was dropped rather than left as a barrier
 * nobody could clear. What that costs is written up in §3.2 — read it before
 * reinstating anything here.
 *
 * The unit is NOT accepted from the client. It is read from the agent's own
 * row after the password verifies, which still satisfies §2: a token's
 * unitId/divisionId are server-derived, never client-supplied. An agent
 * therefore cannot issue against a unit they are not posted to — the check
 * that used to compare against a step-1 token is now structural, because
 * there is no other unit they could name.
 */
export async function agentLogin(
  input: AgentLoginInput,
  ctx: RequestContext,
): Promise<LoginResult> {
  // Spec §3: agents sign in with mobile OR email.
  const agent = await repo.findAgentByMobile(input.mobile_number);

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
      metadata: { reason: 'BAD_CREDENTIALS' },
      ip: ctx.ip,
    });
    throw unauthorized('Invalid mobile number or password');
  }

  /* The posting comes from the agent's row, never from the request. The
   * session id is minted here so it can be signed into the claims before the
   * row exists — the token hash is what ties the two together. */
  const sessionId = newId();
  const ttlMinutes = env.AGENT_TOKEN_TTL_MINUTES;
  const expiresAt = minutesFromNow(ttlMinutes);

  const claims: AgentClaims = {
    role: 'AGENT',
    sessionId,
    agentId: agent.id,
    unitId: agent.unit_id,
    divisionId: agent.division_id,
  };
  const token = signSession(claims, ttlMinutes);

  await repo.createAgentSession({
    id: sessionId,
    unitId: agent.unit_id,
    agentId: agent.id,
    tokenHash: hashToken(token),
    expiresAt,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  await repo.writeAudit({
    actorRole: 'AGENT',
    actorId: agent.id,
    action: 'AGENT_LOGIN',
    entityType: 'unit_session',
    entityId: sessionId,
    metadata: { unit_id: agent.unit_id, direct: true },
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
/* Unit admin — decentralised approvals (migration 005)                */
/* =================================================================== */

/**
 * Same shape as superuserLogin: username + password, no unit-session table,
 * no bound/unbound phase. The account's scope comes from `unit_admins.unit_id`
 * (possibly null — see UnitAdminClaims) and is signed into the token exactly
 * like an agent's unit is, never re-derived from anything the client sends.
 */
export async function unitAdminLogin(
  input: UnitAdminLoginInput,
  ctx: RequestContext,
): Promise<LoginResult> {
  const admin = await repo.findUnitAdminByUsername(input.username);

  if (!admin) {
    await verifyAgainstDummy(input.password);
    throw unauthorized('Invalid Unit ID or password');
  }

  if (!admin.is_active) {
    await verifyAgainstDummy(input.password);
    throw forbidden('This account is not active');
  }

  const ok = await verifySecret(input.password, admin.password_hash);
  if (!ok) {
    await repo.writeAudit({
      actorRole: 'UNIT_ADMIN',
      actorId: admin.id,
      action: 'UNIT_ADMIN_LOGIN_FAILED',
      ip: ctx.ip,
    });
    throw unauthorized('Invalid Unit ID or password');
  }

  const ttlMinutes = env.UNIT_ADMIN_TOKEN_TTL_MINUTES;
  const expiresAt = minutesFromNow(ttlMinutes);

  const claims: UnitAdminClaims = {
    role: 'UNIT_ADMIN',
    unitAdminId: admin.id,
    unitId: admin.unit_id,
  };
  const token = signSession(claims, ttlMinutes);

  await repo.touchUnitAdminLogin(admin.id);
  await repo.writeAudit({
    actorRole: 'UNIT_ADMIN',
    actorId: admin.id,
    action: 'UNIT_ADMIN_LOGIN',
    metadata: { unit_id: admin.unit_id },
    ip: ctx.ip,
  });

  const unit = admin.unit_id ? await repo.loadUnitAdminUnit(admin.unit_id) : null;

  return {
    token,
    ttlMinutes,
    session: {
      role: 'UNIT_ADMIN',
      unitAdmin: { id: admin.id, name: admin.name, username: admin.username },
      unit: unit
        ? {
            id: unit.unit_id,
            unitCode: unit.unit_code,
            name: unit.unit_name,
            sector: unit.unit_sector,
          }
        : undefined,
      division: unit
        ? { id: unit.division_id, name: unit.division_name, code: unit.division_code }
        : undefined,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/* =================================================================== */
/* Agent self-registration (spec §3)                                   */
/* =================================================================== */

const UNIQUE_VIOLATION = '23505';

/**
 * Shared by the Unit Gateway check and signup's own re-verification — one
 * place decides what "the invite PIN matched" means, including the
 * not-yet-configured case, so the two can never quietly disagree.
 */
async function requireInvitePin(
  unit: repo.UnitInviteRow,
  pin: string,
): Promise<void> {
  if (!unit.agent_invite_pin_hash) {
    // Burn the same time a real comparison would take (lib/crypto.ts's
    // verifyAgainstDummy), same reasoning as agentLogin's not-found path.
    await verifyAgainstDummy(pin);
    throw unauthorized(
      'This unit has not set up an invite PIN yet. Contact your unit head.',
    );
  }

  const ok = await verifySecret(pin, unit.agent_invite_pin_hash);
  if (!ok) {
    throw unauthorized('Incorrect invite PIN. Check with your unit head.');
  }
}

export async function agentSignup(
  input: AgentSignupInput,
  ctx: RequestContext,
): Promise<AgentSignupResponse> {
  const unit = await repo.findUnitForGateway(input.unit_code);
  if (!unit) {
    throw badRequest('That unit code does not exist. Check with your unit head.');
  }

  /* The Unit Gateway screen is a UX gate, not the security boundary — this
   * re-check is what actually stops someone from bypassing that screen and
   * POSTing an arbitrary unit_code straight to this endpoint (§3.2). The
   * frontend hardcodes unit_code from the gateway step already passed, but
   * nothing server-side trusts that on its own. */
  await requireInvitePin(unit, input.agent_invite_pin);

  /* A blank password is a supported path, not an error — see
   * AgentSignupSchema. Generating one here means an account can never be
   * created without a credential, and the plaintext is returned exactly
   * once below. */
  const generated = input.password ? null : generateAgentPassword();
  const passwordHash = await hashSecret(input.password ?? generated!);

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
      /* Only mobile_number can collide now. Migration 013 dropped the unique
       * index on email so agents without a personal address can share their
       * unit head's — a duplicate email is an expected, supported state, not
       * a conflict. Any other unique violation reaching here is a genuine
       * surprise, so it says so rather than blaming the email. */
      throw conflict(
        e.constraint === 'agents_mobile_number_key'
          ? 'An account already exists for this mobile number.'
          : 'That registration conflicts with an existing account.',
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

  /* Still no session — the agent signs in normally on the next screen.
   *
   * The account is APPROVED immediately (§3.4). Tickets are financial
   * instruments and self-service must not mint an issuer FREELY, which is
   * why the unit invite PIN is verified above before we ever get here: it
   * is now the only barrier, so it is doing the whole job that the PIN and
   * the human approval step used to share. */
  return {
    status: 'APPROVED',
    message: 'Account created. You can sign in now.',
    agent: {
      id: created.id,
      name: input.name,
      mobileNumber: input.mobile_number,
      email: input.email,
    },
    temporaryPassword: generated,
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
/* Unit Gateway — agent invite PIN (§3.2)                               */
/* =================================================================== */

/**
 * Checked fresh on every attempt. No session, cookie, or token is issued —
 * this only confirms the PIN is right and hands back the unit for the
 * frontend to hardcode into the rest of this visit's login/signup forms.
 */
export async function verifyUnitGateway(
  input: UnitGatewayInput,
): Promise<UnitGatewayResponse> {
  const unit = await repo.findUnitForGateway(input.unit_code);
  if (!unit) {
    throw badRequest('That unit code does not exist. Check with your unit head.');
  }

  await requireInvitePin(unit, input.agent_invite_pin);

  return {
    unitId: unit.id,
    unitCode: unit.unit_code,
    unitName: unit.name,
    divisionName: unit.division_name,
  };
}

/* =================================================================== */
/* Password reset — RETIRED for agents (§3.3)                          */
/* =================================================================== */

/*
 * `requestPasswordReset` / `resetPassword` and the token table they used are
 * gone for agents, deliberately.
 *
 * They resolved the account with `findAgentByEmail(...)`. Migration 013
 * lets agents share one address — typically their unit head's, because many
 * field agents have no personal email — and that turns this flow into an
 * account-takeover path in two ways at once:
 *
 *   - the lookup returns an ARBITRARY one of the agents on that address, so
 *     the link may be minted for someone other than the person who asked;
 *   - everyone with access to the shared inbox (the unit head, and every
 *     other agent on it) can open the link and set that password.
 *
 * Neither is fixable while the address is the identifier, so recovery moved
 * to where the authority actually is: a unit admin rotates the agent's
 * password from their dashboard and reads the new one out
 * (`POST /api/unit-admin/agents/:id/reset-password`). That is scoped by the
 * same OR-predicate as every other unit-admin action, and is attributable in
 * `audit_logs`, which an emailed link never was.
 *
 * `password_reset_tokens` is left on the table — dropping it would discard
 * history — but nothing writes to it any more.
 */

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

  if (claims.role === 'UNIT_ADMIN') {
    // Re-read rather than trust the token: a deactivated account or a unit
    // reassigned since login must take effect on the next request, not wait
    // for the token to expire — same reasoning as the gate branch above.
    const admin = await repo.findActiveUnitAdminById(claims.unitAdminId);
    if (!admin) {
      throw unauthorized('Unit admin session is no longer valid');
    }

    // The token's unitId may be stale if a superuser reassigned this account
    // after it signed in — read the current value, not the signed one.
    const unit = admin.unit_id
      ? await repo.loadUnitAdminUnit(admin.unit_id)
      : null;

    return {
      role: 'UNIT_ADMIN',
      unitAdmin: { id: admin.id, name: admin.name, username: admin.username },
      unit: unit
        ? {
            id: unit.unit_id,
            unitCode: unit.unit_code,
            name: unit.unit_name,
            sector: unit.unit_sector,
          }
        : undefined,
      division: unit
        ? { id: unit.division_id, name: unit.division_name, code: unit.division_code }
        : undefined,
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
