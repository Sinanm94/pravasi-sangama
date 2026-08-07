'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { Building2, CheckCircle2, User, UserPlus } from 'lucide-react';
import {
  AGENT_PASSWORD_MIN_LENGTH,
  type AgentSignupResponse,
  type SessionResponse,
  type UnitGatewayResponse,
} from '@pravasi/shared';
import { useAuthStore } from '@/store/useAuthStore';
import { screenVariants, springSurface } from '@/lib/motion';
import { apiPost, errorMessage, errorCode } from '@/lib/apiClient';
import {
  clearStickyUnit,
  readStickyUnit,
  saveStickyUnit,
} from '@/lib/unitGateway';
import {
  AuthHeader,
  AuthOutcome,
  AuthShell,
  Field,
  VIOLET,
  VIOLET_DEEP,
  SubtleButton,
  Submit,
} from '@/components/ui/AuthShell';

/**
 * The unit a visit is acting as.
 *
 * `invitePin` is present only when THIS visit cleared the gateway, and lives
 * in React state alone — never in storage (§3.5). A device restored from
 * sticky state carries null, which is what makes SignupForm ask for the PIN
 * again before it can register anyone.
 */
interface ActiveUnit {
  unitCode: string;
  unitName: string;
  invitePin: string | null;
}

type Tab = 'login' | 'signup' | 'help';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'login', label: 'Agent Login' },
  { id: 'signup', label: 'First-Time' },
  { id: 'help', label: 'Forgot?' },
];

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthShell />}>
      <LoginFlow />
    </Suspense>
  );
}

/* ================================================================== */

function LoginFlow() {
  const router = useRouter();
  const params = useSearchParams();

  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);
  const login = useAuthStore((s) => s.login);

  const [tab, setTab] = useState<Tab>('login');

  /**
   * The unit this visit is operating as.
   *
   * `invitePin` is held in memory ONLY, and only for the length of a visit
   * that actually cleared the gateway. A sticky (remembered) device restores
   * the unit with `invitePin: null` — it can sign an existing agent in, but
   * SignupForm will ask for the PIN again before registering a new one,
   * because the server re-verifies it either way (§3.5).
   */
  const [gatewayUnit, setGatewayUnit] = useState<ActiveUnit | null>(null);

  /* Until localStorage has been read we do not know whether to show the
   * gateway. Rendering it and then yanking it away is worse than one frame
   * of nothing, so hold the shell until this resolves. */
  const [restored, setRestored] = useState(false);

  const next = params.get('next');

  useEffect(() => {
    if (status === 'idle') void hydrate();
  }, [status, hydrate]);

  /* Sticky bypass (§3.5). localStorage is not readable during SSR, so this
   * runs after mount rather than in useState's initialiser. */
  useEffect(() => {
    const saved = readStickyUnit();
    if (saved) {
      setGatewayUnit({
        unitCode: saved.unitCode,
        unitName: saved.unitName,
        invitePin: null,
      });
    }
    setRestored(true);
  }, []);

  const enterUnit = (unit: ActiveUnit) => {
    saveStickyUnit({ unitCode: unit.unitCode, unitName: unit.unitName });
    setGatewayUnit(unit);
    setTab('login');
  };

  const switchUnit = () => {
    clearStickyUnit();
    setGatewayUnit(null);
    setTab('login');
  };

  // One frame of empty shell while localStorage is read — see `restored`.
  if (!restored) return <AuthShell />;

  return (
    <AuthShell>
      {gatewayUnit === null ? (
        <UnitGatewayScreen onUnlock={enterUnit} />
      ) : (
        <>
          {/* Which unit this device is acting as, and the way out of it.
              Without an escape a phone that cleared the wrong unit would be
              stuck short of clearing site data (§3.5). */}
          <div className="-mt-1 mb-4 flex items-center gap-2 rounded-2xl bg-gray-50 px-4 py-2.5">
            <Building2 className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={2.25} />
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-600">
              {gatewayUnit.unitName}
              <span className="text-gray-400"> · {gatewayUnit.unitCode}</span>
            </p>
            <button
              type="button"
              onClick={switchUnit}
              className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-400 transition-colors hover:bg-white hover:text-gray-700"
            >
              Change
            </button>
          </div>

          <div className="flex rounded-full bg-gray-100 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="relative flex-1 rounded-full px-2 py-2 text-[12px] font-medium transition-colors duration-200"
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="login-tab-pill"
                    transition={springSurface}
                    className="absolute inset-0 rounded-full bg-white shadow-sm"
                  />
                )}
                <span
                  className={`relative z-10 ${
                    tab === t.id ? 'text-gray-900' : 'text-gray-500'
                  }`}
                >
                  {t.label}
                </span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              variants={screenVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={springSurface}
            >
              {tab === 'login' && (
                <AgentLoginForm
                  onAgent={async (session) => {
                    login(session);
                    /* Remember the unit the SERVER says this agent belongs
                     * to, not the one the device guessed. If a device was
                     * sticky on the wrong unit, a real sign-in corrects it. */
                    if (session.unit?.unitCode && session.unit.name) {
                      saveStickyUnit({
                        unitCode: session.unit.unitCode,
                        unitName: session.unit.name,
                      });
                    }
                    await hydrate();
                    router.replace(next ?? '/agent/dashboard');
                  }}
                />
              )}

              {tab === 'signup' && (
                <SignupForm unit={gatewayUnit} onBack={() => setTab('login')} />
              )}
              {tab === 'help' && <ForgotHelp onBack={() => setTab('login')} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </AuthShell>
  );
}

/* ================================================================== */
/* The Unit Gateway (§3.2, §3.5)                                        */
/* ================================================================== */

/**
 * Step 1 for a device that has not been here before. Unit code plus the
 * 4-digit invite PIN a unit head hands to their own agents — NOT the unit
 * admin's dashboard password, a deliberately separate and weaker credential
 * whose only job is routing a volunteer to the right unit.
 *
 * No session is created. Clearing this unlocks the tabs behind it and
 * remembers the unit on this device, so it is asked once rather than on
 * every visit — the friction that got the gateway removed the first time.
 */
function UnitGatewayScreen({
  onUnlock,
}: {
  onUnlock: (unit: ActiveUnit) => void;
}) {
  const [unitCode, setUnitCode] = useState('');
  const [pin, setPin] = useState('');
  const [errors, setErrors] = useState<{ unitCode?: string; pin?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();

    const next: { unitCode?: string; pin?: string } = {};
    if (!unitCode.trim()) next.unitCode = 'Enter your unit code.';
    if (!/^[0-9]{4}$/.test(pin)) next.pin = 'Enter the 4-digit invite PIN.';

    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const result = await apiPost<UnitGatewayResponse>('/auth/unit-gateway', {
        unit_code: unitCode.trim(),
        agent_invite_pin: pin,
      });
      onUnlock({
        unitCode: result.unitCode,
        unitName: result.unitName,
        invitePin: pin,
      });
    } catch (err) {
      toast.error('Could not verify', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <AuthHeader
        icon={Building2}
        title="Welcome"
        subtitle="Enter your unit code and invite PIN to continue"
      />

      <Field
        label="Unit Code"
        hint="e.g. BAT01"
        value={unitCode}
        onChange={(v) => {
          setUnitCode(v.toUpperCase());
          setErrors((e) => ({ ...e, unitCode: undefined }));
        }}
        placeholder="BAT01"
        autoComplete="off"
        error={errors.unitCode}
        required
      />

      <Field
        label="Invite PIN"
        hint="4 digits — ask your unit head"
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(v) => {
          setPin(v.replace(/\D/g, '').slice(0, 4));
          setErrors((e) => ({ ...e, pin: undefined }));
        }}
        placeholder="••••"
        autoComplete="off"
        error={errors.pin}
        required
      />

      <Submit busy={busy} busyLabel="Checking…">
        Continue
      </Submit>

      <p className="pt-1 text-center text-[12px] leading-snug text-gray-400">
        You will only be asked this once on this device.
      </p>
    </form>
  );
}

/* ================================================================== */
/* Tab 1 — Agent login, single step (§3.2)                             */
/* ================================================================== */

function AgentLoginForm({
  onAgent,
}: {
  onAgent: (s: SessionResponse) => Promise<void>;
}) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * One request, mobile + password.
   *
   * There is no unit code or PIN here BY EXPLICIT DECISION — see the note on
   * `agentLogin` in the backend service and CLAUDE.md §3.2. The volunteers
   * running this event cannot distribute location credentials on the day, so
   * the server reads each agent's posting from their own row instead. The
   * client never names a unit, which is why it cannot pick the wrong one.
   */
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onAgent(
        await apiPost<SessionResponse>('/auth/agent-login', {
          mobile_number: identifier,
          password,
        }),
      );
    } catch (err) {
      /* The approval states get their own words. "Sign in failed" would send
       * an agent hunting for a typo that isn't there. */
      const code = errorCode(err);

      if (code === 'AGENT_PENDING_APPROVAL') {
        toast.warning('Awaiting approval', {
          description: 'An administrator must approve your account first.',
          duration: 7000,
        });
      } else if (code === 'AGENT_REJECTED') {
        toast.error('Registration declined', {
          description: 'Contact the event administrator.',
          duration: 7000,
        });
      } else {
        toast.error('Sign in failed', { description: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <AuthHeader
        icon={User}
        title="Sign in"
        subtitle="Your mobile number and password"
      />
      <Field
        label="Mobile Number"
        hint="Your Agent ID"
        value={identifier}
        onChange={(v) => setIdentifier(v.replace(/\D/g, '').slice(0, 10))}
        inputMode="numeric"
        placeholder="9876543210"
        autoComplete="username"
        required
      />
      <Field
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        required
      />
      <Submit busy={busy} busyLabel="Signing in…">
        Sign In
      </Submit>
    </form>
  );
}

/* ================================================================== */
/* Tab 2 — First-time setup                                            */
/* ================================================================== */

function SignupForm({
  unit,
  onBack,
}: {
  unit: ActiveUnit;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  /* No unit dropdown. The unit is whatever the gateway resolved — locking
   * it here is the entire reason the gateway exists (agents were picking
   * the wrong one from a list).
   *
   * The PIN is only asked for when this visit did not itself clear the
   * gateway, i.e. a device restored from sticky state (§3.5). Signing in
   * needs no PIN, but registering does: agentSignup re-verifies it
   * server-side, so a borrowed sticky device cannot mint a new agent. */
  const needsPin = unit.invitePin === null;
  const [invitePin, setInvitePin] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  /** Set only when the agent left the password blank — revealed once below. */
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const clearError = (key: string) =>
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const nextErrors = { ...prev };
      delete nextErrors[key];
      return nextErrors;
    });

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();

    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = 'Enter your full name.';
    if (!/^[0-9]{10}$/.test(mobile))
      next.mobile = 'Enter a valid 10-digit mobile number.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()))
      next.email = 'Enter a valid email address.';
    if (needsPin && !/^[0-9]{4}$/.test(invitePin))
      next.invitePin = 'Enter the 4-digit invite PIN from your unit head.';
    /* Blank is allowed: the server generates one and returns it once. Only
     * validate what was actually typed. */
    if (password && password.length < AGENT_PASSWORD_MIN_LENGTH)
      next.password = `At least ${AGENT_PASSWORD_MIN_LENGTH} characters.`;
    if (password && confirm !== password)
      next.confirm = 'Passwords do not match.';

    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const result = await apiPost<AgentSignupResponse>('/auth/signup', {
        name: name.trim(),
        mobile_number: mobile,
        email: email.trim(),
        // Hardcoded from the Unit Gateway step already passed — never a
        // free-text or dropdown choice here. The invite PIN rides along too
        // so the backend can re-verify it (§3.2); the agent never re-types
        // it, since they already proved they know it to get this far.
        unit_code: unit.unitCode,
        agent_invite_pin: unit.invitePin ?? invitePin,
        // Omitted entirely when blank — the schema reads absent as "generate
        // one", where an empty string would fail the min-length rule.
        ...(password ? { password, confirm_password: confirm } : {}),
      });
      // 202 Accepted — the account exists but cannot sign in yet.
      setTempPassword(result.temporaryPassword);
      setDone(true);
    } catch (err) {
      toast.error('Could not create the account', {
        description: errorMessage(err),
      });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mt-6">
        <AuthOutcome
          icon={CheckCircle2}
          tone="success"
          title="Account created"
          body="Awaiting approval from your unit head. You'll be able to sign in once they activate your account."
          actionLabel="Back to Sign In"
          onAction={onBack}
        />

        {/* Shown exactly once — only the hash is stored, so it cannot be
            retrieved later. If it is lost, the unit head resets it. */}
        {tempPassword && (
          <div
            className="mt-4 rounded-2xl px-4 py-4 text-center"
            style={{ backgroundColor: `${VIOLET}0d` }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              Write this down now
            </p>
            <p
              className="mt-2 font-mono text-[24px] font-bold tracking-[0.08em]"
              style={{ color: VIOLET_DEEP }}
            >
              {tempPassword}
            </p>
            <p className="mt-2 text-[12px] leading-snug text-gray-500">
              This is your password. It is not shown again and is not emailed.
              If you lose it, your unit head can reset it for you.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-4">
      <AuthHeader
        icon={UserPlus}
        title="First-time setup"
        subtitle="Create your agent account"
      />

      <Field
        label="Agent Name"
        value={name}
        onChange={(v) => {
          setName(v);
          clearError('name');
        }}
        placeholder="Full name"
        autoComplete="name"
        error={errors.name}
        required
      />

      <Field
        label="Mobile Number"
        hint="This is your Agent ID"
        value={mobile}
        onChange={(v) => {
          setMobile(v.replace(/\D/g, '').slice(0, 10));
          clearError('mobile');
        }}
        inputMode="numeric"
        placeholder="9876543210"
        error={errors.mobile}
        required
      />

      <Field
        label="Email Address"
        hint="For password reset"
        type="email"
        inputMode="email"
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError('email');
        }}
        placeholder="name@example.com"
        autoComplete="email"
        error={errors.email}
        required
      />

      {/* Confirmation, not a choice — the gateway already decided this. */}
      <div>
        <p className="mb-2 block text-[13px] font-medium text-gray-700">Unit</p>
        <div
          className="flex items-center gap-2.5 rounded-xl px-4 py-3"
          style={{ backgroundColor: `${VIOLET}0d` }}
        >
          <Building2
            className="h-4 w-4 shrink-0"
            style={{ color: VIOLET_DEEP }}
            strokeWidth={2.25}
          />
          <p className="min-w-0 truncate text-[15px] font-medium text-gray-900">
            {unit.unitName}
            <span className="text-gray-500"> · {unit.unitCode}</span>
          </p>
        </div>
      </div>

      {needsPin && (
        <Field
          label="Unit Invite PIN"
          hint="4 digits — confirms you may register here"
          type="password"
          inputMode="numeric"
          value={invitePin}
          onChange={(v) => {
            setInvitePin(v.replace(/\D/g, '').slice(0, 4));
            clearError('invitePin');
          }}
          placeholder="••••"
          autoComplete="off"
          error={errors.invitePin}
          required
        />
      )}

      <Field
        label="New Password"
        hint={`Optional — blank means we create one (min ${AGENT_PASSWORD_MIN_LENGTH})`}
        type="password"
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError('password');
        }}
        autoComplete="new-password"
        error={errors.password}
        required
      />

      <Field
        label="Confirm Password"
        hint="Only if you set one above"
        type="password"
        value={confirm}
        onChange={(v) => {
          setConfirm(v);
          clearError('confirm');
        }}
        autoComplete="new-password"
        error={errors.confirm}
        required
      />

      <Submit busy={busy} busyLabel="Creating…">
        Create Account
      </Submit>
    </form>
  );
}

/* ================================================================== */
/* Tab 3 — Forgot password → ask your unit head                        */
/* ================================================================== */

/**
 * Not a form. Self-service email reset was retired (migration 013): agents
 * share email addresses — typically their unit head's — so a reset link
 * could be minted for the wrong agent, and anyone with access to that
 * shared inbox could claim it.
 *
 * Recovery is now a person: the unit admin rotates the password from their
 * own dashboard and reads the new one out. This screen exists so an agent
 * who taps "Forgot?" is told exactly that, rather than finding the tab gone
 * and assuming the app is broken.
 */
function ForgotHelp({ onBack }: { onBack: () => void }) {
  return (
    <div className="mt-6">
      <AuthOutcome
        icon={Building2}
        tone="info"
        title="Ask your unit head"
        body="Passwords are reset by your unit admin, not by email. Ask them to open their dashboard and reset yours — they can give you a new one straight away."
        actionLabel="Back to Sign In"
        onAction={onBack}
      />
    </div>
  );
}
