'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Mail,
  User,
  UserPlus,
} from 'lucide-react';
import {
  AGENT_PASSWORD_MIN_LENGTH,
  type SessionResponse,
  type UnitGatewayResponse,
} from '@pravasi/shared';
import { useAuthStore } from '@/store/useAuthStore';
import { screenVariants, springSurface } from '@/lib/motion';
import { apiPost, errorMessage, errorCode } from '@/lib/apiClient';
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
 * The unit a visit has cleared the Unit Gateway for (§3.2), plus the PIN
 * they typed — kept only in memory so SignupForm can replay it into the
 * signup request without asking the agent to type the same PIN twice. Never
 * persisted, never sent anywhere except that one follow-up request.
 */
interface GatewayUnit extends UnitGatewayResponse {
  invitePin: string;
}

type Tab = 'login' | 'signup' | 'forgot';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'login', label: 'Agent Login' },
  { id: 'signup', label: 'First-Time' },
  { id: 'forgot', label: 'Forgot' },
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
   * The Unit Gateway (§3.2) — in front of the whole agent portal (both tabs
   * below), not just First-Time Setup. Purely client-side: no cookie, no
   * session, just "has this visit cleared the gateway".
   *
   * There are no administrative entry points on this page. Super User, Unit
   * Admin and Gate Scanner sign-in live at `/management` — this is the
   * public door and handles event staff only.
   */
  const [gatewayUnit, setGatewayUnit] = useState<GatewayUnit | null>(null);

  const next = params.get('next');

  useEffect(() => {
    if (status === 'idle') void hydrate();
  }, [status, hydrate]);

  const showTabs = gatewayUnit !== null;

  return (
    <AuthShell>
      {gatewayUnit === null ? (
        <UnitGatewayScreen onUnlock={setGatewayUnit} />
      ) : (
        <>
          <div className="-mt-1 mb-4 flex items-center gap-2 rounded-2xl bg-gray-50 px-4 py-2.5">
            <Building2 className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={2.25} />
            <p className="min-w-0 truncate text-[13px] font-medium text-gray-600">
              {gatewayUnit.unitName}
              <span className="text-gray-400"> · {gatewayUnit.unitCode}</span>
            </p>
          </div>

          {showTabs && (
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
          )}

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
                    await hydrate();
                    router.replace(next ?? '/agent/dashboard');
                  }}
                />
              )}

              {tab === 'signup' && (
                <SignupForm unit={gatewayUnit} onBack={() => setTab('login')} />
              )}
              {tab === 'forgot' && <ForgotForm onBack={() => setTab('login')} />}
            </motion.div>
          </AnimatePresence>

          {/* "Switch unit" only. Everything administrative moved to
              /management — this page is event staff and nothing else. */}
          {showTabs && (
            <div className="mt-6 border-t border-gray-100 pt-5">
              <SubtleButton icon={ArrowLeft} onClick={() => setGatewayUnit(null)}>
                Switch unit
              </SubtleButton>
            </div>
          )}
        </>
      )}
    </AuthShell>
  );
}

/* ================================================================== */
/* The Unit Gateway — reinstated unit-first gate (§3.2)                 */
/* ================================================================== */

/**
 * Step 1 of the agent flow. Unit code + a 4-digit invite PIN a unit head
 * hands to their own agents (migration 009) — NOT the unit admin's own
 * dashboard password, a deliberately separate, weaker credential whose only
 * job is routing a volunteer to the right unit's forms, not authenticating
 * them. No session is created here; a successful check just unlocks the
 * tabs below for the rest of this visit.
 */
function UnitGatewayScreen({
  onUnlock,
}: {
  onUnlock: (unit: GatewayUnit) => void;
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
      onUnlock({ ...result, invitePin: pin });
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
        hint="Ask your unit head"
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
  unit: GatewayUnit;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

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
    if (password.length < AGENT_PASSWORD_MIN_LENGTH)
      next.password = `At least ${AGENT_PASSWORD_MIN_LENGTH} characters.`;
    if (confirm !== password) next.confirm = 'Passwords do not match.';

    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      await apiPost('/auth/signup', {
        name: name.trim(),
        mobile_number: mobile,
        email: email.trim(),
        // Hardcoded from the Unit Gateway step already passed — never a
        // free-text or dropdown choice here. The invite PIN rides along too
        // so the backend can re-verify it (§3.2); the agent never re-types
        // it, since they already proved they know it to get this far.
        unit_code: unit.unitCode,
        agent_invite_pin: unit.invitePin,
        password,
        confirm_password: confirm,
      });
      // 202 Accepted — the account exists but cannot sign in yet.
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
          body="Awaiting admin approval. You'll be able to sign in once an administrator activates your account."
          actionLabel="Back to Sign In"
          onAction={onBack}
        />
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

      {/* Not a form field — nothing here is editable or submitted from this
          control. The unit is already decided by the Unit Gateway step;
          this is a confirmation, not a choice, which is the whole point of
          removing the old dropdown (agents were picking the wrong unit). */}
      <div>
        <p className="mb-2 block text-[13px] font-medium text-gray-700">Unit</p>
        <div
          className="flex items-center gap-2.5 rounded-xl px-4 py-3"
          style={{ backgroundColor: `${VIOLET}0d` }}
        >
          <Building2 className="h-4 w-4 shrink-0" style={{ color: VIOLET_DEEP }} strokeWidth={2.25} />
          <p className="min-w-0 truncate text-[15px] font-medium text-gray-900">
            {unit.unitName}
            <span className="text-gray-500"> · {unit.unitCode}</span>
          </p>
        </div>
      </div>

      <Field
        label="New Password"
        hint={`Min ${AGENT_PASSWORD_MIN_LENGTH} characters`}
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
/* Tab 3 — Forgot password                                             */
/* ================================================================== */

function ForgotForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    try {
      await apiPost('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      toast.error('Could not send the reset link', {
        description: errorMessage(err),
      });
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="mt-6">
        {/* Deliberately does not confirm the address exists — the API does not
            either, and the UI must not leak what the API protects. */}
        <AuthOutcome
          icon={Mail}
          tone="info"
          title="Check your email"
          body="If that address has an approved account, a reset link is on its way. It expires in 60 minutes."
          actionLabel="Back to Sign In"
          onAction={onBack}
        />
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-4">
      <AuthHeader
        icon={Mail}
        title="Forgot password"
        subtitle="We'll email you a reset link"
      />
      <Field
        label="Email Address"
        type="email"
        inputMode="email"
        value={email}
        onChange={(v) => {
          setEmail(v);
          setError(undefined);
        }}
        placeholder="name@example.com"
        autoComplete="email"
        error={error}
        required
      />
      <Submit busy={busy} busyLabel="Sending…">
        Send Reset Link
      </Submit>
    </form>
  );
}
