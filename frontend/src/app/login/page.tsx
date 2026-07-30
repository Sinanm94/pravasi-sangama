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

  const role = useAuthStore((s) => s.role);
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);
  const login = useAuthStore((s) => s.login);
  const setUnitPending = useAuthStore((s) => s.setUnitPending);

  const [tab, setTab] = useState<Tab>('login');
  const [adminMode, setAdminMode] = useState(false);

  const next = params.get('next');

  useEffect(() => {
    if (status === 'idle') void hydrate();
  }, [status, hydrate]);

  /* A live unit session means the location is authenticated and only the
   * person is missing — shift changes land here and re-run step 2 alone. */
  const step: 'unit' | 'agent' =
    role === 'UNIT_PENDING' || params.get('step') === 'agent' ? 'agent' : 'unit';

  // Mid-session, the only sensible action is finishing step 2.
  useEffect(() => {
    if (role === 'UNIT_PENDING') setTab('login');
  }, [role]);

  const showTabs = step === 'unit' && !adminMode;

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
              key={`${tab}-${step}`}
              variants={screenVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={springSurface}
            >
              {tab === 'login' && (
                <AgentLoginForm
                  step={step}
                  onUnit={setUnitPending}
                  onAgent={async (session) => {
                    login(session);
                    await hydrate();
                    router.replace(next ?? '/ticketing');
                  }}
                  onChangeUnit={async () => {
                    await apiPost('/auth/logout').catch(() => {});
                    useAuthStore.getState().logout();
                    router.replace('/login');
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
  step,
  onUnit,
  onAgent,
  onChangeUnit,
}: {
  step: 'unit' | 'agent';
  onUnit: (s: SessionResponse) => void;
  onAgent: (s: SessionResponse) => Promise<void>;
  onChangeUnit: () => Promise<void>;
}) {
  const unitName = useAuthStore((s) => s.userData?.unitName);

  const [unitCode, setUnitCode] = useState('');
  const [pin, setPin] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submitUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const session = await apiPost<SessionResponse>('/auth/unit-login', {
        unit_code: unitCode,
        pin,
      });
      onUnit(session);
      toast.success('Unit authenticated', { description: session.unit?.name });
    } catch (err) {
      toast.error('Unit sign in failed', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const submitAgent = async (e: React.FormEvent) => {
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
        const message = errorMessage(err);
        toast.error(
          message.includes('not assigned') ? 'Wrong unit' : 'Sign in failed',
          { description: message },
        );
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === 'unit') {
    return (
      <form onSubmit={submitUnit} className="mt-6 space-y-4">
        <AuthHeader
          icon={Building2}
          title="Step 1 — Unit location"
          subtitle="Authenticate the location before the person"
        />
        <Field
          label="Unit Code"
          value={unitCode}
          onChange={setUnitCode}
          placeholder="5BUILDING"
          autoCapitalize="characters"
          required
        />
        <Field
          label="Unit PIN"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={setPin}
          autoComplete="off"
          required
        />
        <Submit busy={busy} busyLabel="Checking…">
          Authenticate Unit
        </Submit>
      </form>
    );
  }

  return (
    <form onSubmit={submitAgent} className="mt-6 space-y-4">
      <AuthHeader
        icon={User}
        title="Step 2 — Agent"
        subtitle={
          unitName ? `Unit authenticated · ${unitName}` : 'Unit authenticated'
        }
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

      {/* The unit session outlives agent logout by design (§3.2), so going
          back means explicitly abandoning the location too. */}
      <SubtleButton
        icon={ArrowLeft}
        onClick={() => void onChangeUnit()}
        className="pt-1"
      >
        Change unit
      </SubtleButton>
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
  /* Sent as `username`, per explicit instruction (2026-08-01). As of that
   * change, packages/shared/src/schemas.ts SuperuserLoginSchema still
   * requires `email` (validated email string) and
   * auth.repository.ts#findSuperuserByEmail looks up on it — there is no
   * `username` key or lookup on the backend. This payload will 400 until
   * the backend schema/repository are updated to match. Not something this
   * tier can fix under the frozen-backend constraint; flagging here so the
   * next person touching this file has the full story in one place. */
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
