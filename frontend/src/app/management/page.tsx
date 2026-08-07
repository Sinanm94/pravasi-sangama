'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';
import type { SessionResponse } from '@pravasi/shared';
import { useAuthStore } from '@/store/useAuthStore';
import { screenVariants, springSurface } from '@/lib/motion';
import { apiPost, errorMessage } from '@/lib/apiClient';
import {
  AuthHeader,
  AuthShell,
  Field,
  VIOLET,
  SubtleButton,
  Submit,
} from '@/components/ui/AuthShell';

/**
 * The management portal — Super User, Unit Admin and Gate Scanner sign-in,
 * deliberately OFF `/login`.
 *
 * `/login` is the public door: a Unit Gateway, agent sign-in and first-time
 * setup, and nothing else. Every administrative entry point used to hang off
 * the bottom of that card, which put three doors an event agent must never
 * open directly in front of several hundred of them.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  THIS PATH IS NOT A SECURITY CONTROL. It is segregation, not secrecy.
 * ─────────────────────────────────────────────────────────────────────
 *
 * A URL is not a credential. `/management` is trivially discoverable — it is
 * in this repository, in the built JS bundle, and in any browser history.
 * What actually protects these roles is unchanged and unchanged on purpose:
 * the passwords themselves, `requireSuperuser` / `requireUnitAdmin` /
 * `requireScanAccess` on every endpoint (§11), and the rate limiter. Moving
 * the forms here removes them from an agent's line of sight; it does not put
 * them behind anything.
 *
 * NOT `/admin`, which was the other candidate: `middleware.ts` guards that
 * whole prefix with `allow: ['SUPERUSER']`, so an unauthenticated visitor is
 * bounced to `/login` — they could never reach a login form living there.
 * Making `/admin` itself public while `/admin/*` stayed guarded would work
 * but reads as a contradiction the next person has to decode.
 *
 * Gate Scanner is a LINK, not an inline form. `/scanner/login` already
 * exists as its own page with a gate picker and a numeric keypad, is already
 * exempted in `PUBLIC_ROUTES`, and is part of the offline PWA shell —
 * duplicating it here would mean two copies of the one screen that has to
 * work at a gate with no network.
 */

type Mode = 'choose' | 'superuser' | 'unit-admin';

export default function ManagementPage() {
  return (
    <Suspense fallback={<AuthShell />}>
      <ManagementFlow />
    </Suspense>
  );
}

/* ================================================================== */

function ManagementFlow() {
  const router = useRouter();
  const params = useSearchParams();

  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);
  const login = useAuthStore((s) => s.login);

  /* `?role=` keeps the old `/login?mode=` deep links working — middleware
   * rewrites those here — and lets someone bookmark straight to their own
   * form rather than the chooser. */
  /* `?role=unit-admin` deliberately no longer resolves — that tier is off
   * (§3.4), and honouring an old bookmark straight into a hidden form would
   * defeat hiding it. It falls through to the chooser. */
  const initial = params.get('role');
  const [mode, setMode] = useState<Mode>(
    initial === 'superuser' ? 'superuser' : 'choose',
  );

  const next = params.get('next');

  useEffect(() => {
    if (status === 'idle') void hydrate();
  }, [status, hydrate]);

  return (
    <AuthShell>
      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          variants={screenVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={springSurface}
        >
          {mode === 'superuser' ? (
            <AdminForm
              onDone={(session) => {
                login(session);
                router.replace(next ?? '/dashboard');
              }}
              onBack={() => setMode('choose')}
            />
          ) : mode === 'unit-admin' ? (
            <UnitAdminForm
              onDone={(session) => {
                login(session);
                router.replace(next ?? '/unit/dashboard');
              }}
              onBack={() => setMode('choose')}
            />
          ) : (
            <RoleChooser
              onSuperuser={() => setMode('superuser')}
              onScanner={() => router.push('/scanner/login')}
              onPublic={() => router.push('/login')}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}

/* ================================================================== */
/* The chooser                                                         */
/* ================================================================== */

/**
 * Unit Admin is intentionally absent (§3.4). The tier is switched off —
 * agent approval is automatic and password recovery moved to the superuser
 * — so offering the role here would hand someone a sign-in that leads to a
 * dashboard with nothing left to do.
 *
 * The login endpoint, the `unit_admins` rows and /unit/dashboard all still
 * exist and still work; only the way in from this portal is gone. Turning
 * the tier back on is re-adding this card, not rebuilding anything.
 */
function RoleChooser({
  onSuperuser,
  onScanner,
  onPublic,
}: {
  onSuperuser: () => void;
  onScanner: () => void;
  onPublic: () => void;
}) {
  return (
    <div className="space-y-4">
      <AuthHeader
        icon={ShieldCheck}
        title="Management sign in"
        subtitle="Choose your role to continue"
      />

      <div className="space-y-2.5">
        <RoleCard
          icon={ShieldCheck}
          label="Super User"
          detail="Analytics, ticket ledger, gates"
          onClick={onSuperuser}
        />
        <RoleCard
          icon={ScanLine}
          label="Gate Scanner"
          detail="Scan tickets at the door"
          onClick={onScanner}
        />
      </div>

      {/* An agent who lands here by mistake needs a way back that does not
          involve editing the URL bar. */}
      <div className="border-t border-gray-100 pt-4">
        <SubtleButton icon={ArrowLeft} onClick={onPublic}>
          Agent sign in
        </SubtleButton>
      </div>
    </div>
  );
}

/**
 * A whole-row target, not a text link. These get tapped on a phone by
 * someone holding a clipboard, and the roles are few enough that the extra
 * vertical space costs nothing.
 */
function RoleCard({
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  icon: typeof ShieldCheck;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-left transition-all duration-200 hover:border-gray-300 hover:bg-gray-50/70 focus:outline-none focus-visible:border-[#5E17EB]/40 focus-visible:ring-4 focus-visible:ring-[#5E17EB]/10 active:scale-[0.98]"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${VIOLET}0f` }}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} style={{ color: VIOLET }} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-gray-900">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-gray-500">
          {detail}
        </span>
      </span>

      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" strokeWidth={2.5} />
    </button>
  );
}

/* ================================================================== */
/* Administrator (spec §4 — three provisioned accounts, no signup)     */
/* ================================================================== */

function AdminForm({
  onDone,
  onBack,
}: {
  onDone: (s: SessionResponse) => void;
  onBack: () => void;
}) {
  /* Sent as `username`. SuperuserLoginSchema and
   * auth.repository.ts#findSuperuserByUsername accept either the username
   * (ADMIN01) or an email, if one was ever set — either can be typed here. */
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
        title="Super User sign in"
        subtitle="Full system access"
      />
      <Field
        label="Username"
        hint="e.g. ADMIN01"
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
        Back to roles
      </SubtleButton>
    </form>
  );
}

/* ================================================================== */
/* Unit admin sign in (decentralised approvals, §3.3)                  */
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
        Back to roles
      </SubtleButton>
    </form>
  );
}
