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
  ScanLine,
  ShieldCheck,
  User,
  UserPlus,
} from 'lucide-react';
import {
  AGENT_PASSWORD_MIN_LENGTH,
  type PublicUnit,
  type SessionResponse,
} from '@pravasi/shared';
import { useAuthStore } from '@/store/useAuthStore';
import { screenVariants, springSurface } from '@/lib/motion';
import {
  apiGet,
  apiPost,
  errorCode,
  errorMessage,
} from '@/lib/apiClient';
import {
  AuthHeader,
  AuthOutcome,
  AuthShell,
  Field,
  VIOLET,
  SelectField,
  SubtleButton,
  Submit,
} from '@/components/ui/AuthShell';

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
  // `?mode=admin` / `?mode=unit-admin` — a direct link into either form
  // without clicking through the card, e.g. while a deployment issue is
  // hiding the buttons themselves, or for a bookmark on a shared device.
  const [adminMode, setAdminMode] = useState(() => params.get('mode') === 'admin');
  const [unitAdminMode, setUnitAdminMode] = useState(
    () => params.get('mode') === 'unit-admin',
  );

  const next = params.get('next');

  useEffect(() => {
    if (status === 'idle') void hydrate();
  }, [status, hydrate]);

  const showTabs = !adminMode && !unitAdminMode;

  return (
    <AuthShell>
      {adminMode ? (
        <AdminForm
          onDone={(session) => {
            login(session);
            router.replace(next ?? '/dashboard');
          }}
          onBack={() => setAdminMode(false)}
        />
      ) : unitAdminMode ? (
        <UnitAdminForm
          onDone={(session) => {
            login(session);
            router.replace(next ?? '/unit/dashboard');
          }}
          onBack={() => setUnitAdminMode(false)}
        />
      ) : (
        <>
          {showTabs && (
            <div className="-mt-1 flex rounded-full bg-gray-100 p-1">
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

              {tab === 'signup' && <SignupForm onBack={() => setTab('login')} />}
              {tab === 'forgot' && <ForgotForm onBack={() => setTab('login')} />}
            </motion.div>
          </AnimatePresence>

          {showTabs && (
            <div className="mt-6 space-y-2.5 border-t border-gray-100 pt-5">
              <SubtleButton icon={ShieldCheck} onClick={() => setAdminMode(true)}>
                Administrator sign in
              </SubtleButton>
              <SubtleButton
                icon={Building2}
                onClick={() => setUnitAdminMode(true)}
              >
                Unit admin sign in
              </SubtleButton>
              <SubtleButton
                icon={ScanLine}
                onClick={() => router.push('/scanner/login')}
              >
                Gate scanner sign in
              </SubtleButton>
            </div>
          )}
        </>
      )}
    </AuthShell>
  );
}

/* ================================================================== */
/* Tab 1 — Agent login (two-step, §3.2)                                */
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
        placeholder="8888999955"
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

function SignupForm({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [units, setUnits] = useState<PublicUnit[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void apiGet<{ units: PublicUnit[] }>('/auth/units')
      .then((d) => setUnits(d.units))
      // Non-fatal — SelectField degrades to a free-text code input.
      .catch(() => setUnits([]));
  }, []);

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
    if (!unitCode.trim()) next.unitCode = 'Select your unit.';
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
        unit_code: unitCode,
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
        placeholder="8888999955"
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

      {/* Units survive self-registration: every ticket carries unit_id and
          division_id, and step 1 checks the agent against the authenticated
          location. Unit codes are not secrets — the unit PIN is. */}
      <SelectField
        label="Unit"
        hint="Ask your unit head"
        value={unitCode}
        onChange={(v) => {
          setUnitCode(v);
          clearError('unitCode');
        }}
        error={errors.unitCode}
        placeholder="Select your unit…"
        fallbackPlaceholder="5BUILDING"
        options={units.map((u) => ({
          value: u.unitCode,
          label: `${u.divisionName} · ${u.sector ? `${u.sector} — ` : ''}${u.name}`,
        }))}
      />

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

/* ================================================================== */
/* Administrator (spec §4 — three seeded accounts, no signup)          */
/* ================================================================== */

function AdminForm({
  onDone,
  onBack,
}: {
  onDone: (s: SessionResponse) => void;
  onBack: () => void;
}) {
  /* Sent as `username`. SuperuserLoginSchema and
   * auth.repository.ts#findSuperuserByUsername (backend, updated
   * 2026-08-01) accept either the short username (admin1) or the full
   * seeded email (admin1@pravasisangama.com) — either can be typed here. */
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    try {
      onDone(
        await apiPost<SessionResponse>('/auth/superuser-login', {
          username: username.trim(),
          password,
        }),
      );
    } catch (err) {
      toast.error('Sign in failed', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <AuthHeader
        icon={ShieldCheck}
        title="Administrator sign in"
        subtitle="Full system access"
      />
      <Field
        label="Username"
        type="text"
        name="username"
        value={username}
        onChange={setUsername}
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

      <SubtleButton icon={ArrowLeft} onClick={onBack} className="pt-1">
        Back to agent sign in
      </SubtleButton>
    </form>
  );
}

/* ================================================================== */
/* Tab 4 — Unit admin sign in (decentralised approvals, §2)             */
/* ================================================================== */

function UnitAdminForm({
  onDone,
  onBack,
}: {
  onDone: (s: SessionResponse) => void;
  onBack: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    try {
      onDone(
        await apiPost<SessionResponse>('/auth/unit-admin-login', {
          username: username.trim(),
          password,
        }),
      );
    } catch (err) {
      toast.error('Sign in failed', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <AuthHeader
        icon={Building2}
        title="Unit admin sign in"
        subtitle="Approve agents for your unit"
      />
      <Field
        label="Unit ID"
        hint="e.g. BAT01"
        type="text"
        name="username"
        value={username}
        onChange={(v) => setUsername(v.toUpperCase())}
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

      <SubtleButton icon={ArrowLeft} onClick={onBack} className="pt-1">
        Back to agent sign in
      </SubtleButton>
    </form>
  );
}
