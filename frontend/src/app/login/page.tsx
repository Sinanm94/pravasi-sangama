'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowLeft, Building2, Loader2, ShieldCheck, User } from 'lucide-react';
import type { SessionResponse } from '@pravasi/shared';
import { useAuthStore } from '@/store/useAuthStore';
import { screenVariants, springSurface } from '@/lib/motion';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/** Official palette (§5.3). Navy is the action colour; gold accents navy. */
const NAVY = '#062B59';
const GOLD = '#D4AF37';

type Surface = 'agent' | 'superuser';

export default function LoginPage() {
  return (
    <Suspense fallback={<Shell />}>
      <LoginFlow />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */

function LoginFlow() {
  const router = useRouter();
  const params = useSearchParams();

  const role = useAuthStore((s) => s.role);
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);
  const login = useAuthStore((s) => s.login);
  const setUnitPending = useAuthStore((s) => s.setUnitPending);
  const unitName = useAuthStore((s) => s.userData?.unitName);

  const [surface, setSurface] = useState<Surface>('agent');
  const [busy, setBusy] = useState(false);

  const next = params.get('next');

  useEffect(() => {
    if (status === 'idle') void hydrate();
  }, [status, hydrate]);

  /* The two-step split is the whole point: a live unit session means the
   * location is already authenticated and only the person is missing. Shift
   * changes land here and re-run step 2 alone. */
  const step: 'unit' | 'agent' =
    role === 'UNIT_PENDING' || params.get('step') === 'agent' ? 'agent' : 'unit';

  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => null)) as
      | (T & { error?: { message?: string; code?: string } })
      | null;

    if (!res.ok) {
      throw new Error(
        data?.error?.message ?? 'Sign in failed. Check your details.',
      );
    }

    return data as T;
  };

  const handleUnit = async (form: FormData) => {
    setBusy(true);
    try {
      const session = await post<SessionResponse>('/auth/unit-login', {
        unit_code: String(form.get('unit_code') ?? ''),
        pin: String(form.get('pin') ?? ''),
      });
      setUnitPending(session);
      toast.success('Unit authenticated', {
        description: session.unit?.name ?? undefined,
      });
    } catch (err) {
      toast.error('Unit sign in failed', {
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAgent = async (form: FormData) => {
    setBusy(true);
    try {
      const session = await post<SessionResponse>('/auth/agent-login', {
        mobile_number: String(form.get('mobile_number') ?? ''),
        password: String(form.get('password') ?? ''),
      });
      login(session);
      // Step 2's response carries the agent; the unit came from step 1.
      // Re-reading /auth/session gets both in one verified answer rather
      // than stitching two partial responses together on the client.
      await hydrate();
      router.replace(next ?? '/ticketing');
    } catch (err) {
      /* A wrong unit is a materially different problem from a wrong
       * password — one is a typo, the other means this agent is standing at
       * the wrong desk. The server distinguishes them (403 vs 401) and so
       * should the message. */
      const message = (err as Error).message;
      toast.error(
        message.includes('not assigned') ? 'Wrong unit' : 'Sign in failed',
        { description: message },
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSuperuser = async (form: FormData) => {
    setBusy(true);
    try {
      const session = await post<SessionResponse>('/auth/superuser-login', {
        username: String(form.get('username') ?? ''),
        password: String(form.get('password') ?? ''),
      });
      login(session);
      router.replace(next ?? '/dashboard');
    } catch (err) {
      toast.error('Sign in failed', { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      {/* Surface switch */}
      <div className="-mt-1 flex rounded-full bg-gray-100 p-1">
        {(['agent', 'superuser'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSurface(s)}
            className="relative flex-1 rounded-full px-4 py-2 text-[13px] font-medium transition-colors duration-200"
          >
            {/* Shared layoutId — the white pill slides between tabs instead
                of one fading out while the other fades in. */}
            {surface === s && (
              <motion.span
                layoutId="surface-pill"
                transition={springSurface}
                className="absolute inset-0 rounded-full bg-white shadow-sm"
              />
            )}
            <span
              className={`relative z-10 ${
                surface === s ? 'text-gray-900' : 'text-gray-500'
              }`}
            >
              {s === 'agent' ? 'Agent' : 'Superuser'}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
      <motion.div
        key={`${surface}-${step}`}
        variants={screenVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        transition={springSurface}
      >
      {surface === 'superuser' ? (
        <form
          action={handleSuperuser}
          className="mt-6 space-y-4"
          key="superuser"
        >
          <Header
            icon={ShieldCheck}
            title="Superuser sign in"
            subtitle="Full system access"
          />
          <Field label="Username" name="username" autoComplete="username" />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
          />
          <Submit busy={busy}>Sign In</Submit>
        </form>
      ) : step === 'unit' ? (
        <form action={handleUnit} className="mt-6 space-y-4" key="unit">
          <Header
            icon={Building2}
            title="Step 1 — Unit location"
            subtitle="Authenticate the location before the person"
          />
          <Field
            label="Unit Code"
            name="unit_code"
            placeholder="5BUILDING"
            autoCapitalize="characters"
          />
          <Field
            label="Unit PIN"
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
          />
          <Submit busy={busy}>Authenticate Unit</Submit>
        </form>
      ) : (
        <form action={handleAgent} className="mt-6 space-y-4" key="agent">
          <Header
            icon={User}
            title="Step 2 — Agent"
            subtitle={
              unitName
                ? `Unit authenticated · ${unitName}`
                : 'Unit authenticated'
            }
          />
          <Field
            label="Mobile Number"
            name="mobile_number"
            inputMode="numeric"
            placeholder="8888999955"
            autoComplete="username"
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
          />
          <Submit busy={busy}>Sign In</Submit>

          {/* The unit session outlives agent logout by design (§3.2), so
              going back means explicitly abandoning the location too. */}
          <button
            type="button"
            onClick={async () => {
              await fetch(`${API_BASE}/auth/logout`, {
                method: 'POST',
                credentials: 'include',
              });
              useAuthStore.getState().logout();
              router.replace('/login');
            }}
            className="flex w-full items-center justify-center gap-1.5 pt-1 text-[12px] font-medium text-gray-400 transition-colors hover:text-gray-600"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
            Change unit
          </button>
        </form>
      )}
      </motion.div>
      </AnimatePresence>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Local primitives                                                    */
/* ------------------------------------------------------------------ */

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-10 font-sans antialiased">
      <div className="w-full max-w-sm">
        <div className="overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
          {/* Navy masthead.
              Gold at 10px on white measures ~2:1 contrast — unreadable. On
              navy it is the brand's own pairing and fully legible, so the
              accent lives here rather than on the light surface. */}
          <div
            className="px-7 pb-6 pt-7 text-center"
            style={{ backgroundColor: NAVY }}
          >
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.28em]"
              style={{ color: GOLD }}
            >
              Karnataka Cultural Foundation
            </p>
            <h1 className="mt-2 text-[22px] font-extrabold uppercase leading-tight tracking-tight text-white">
              Pravasi Sangama 2026
            </h1>
            <span
              aria-hidden
              className="mx-auto mt-4 block h-px w-14"
              style={{ backgroundColor: GOLD }}
            />
          </div>

          <div className="p-7">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Header({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof User;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3 pb-1">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#062B59]/[0.07]">
        <Icon className="h-4 w-4 text-[#062B59]" strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-gray-900">{title}</p>
        <p className="mt-0.5 text-[12px] text-gray-400">{subtitle}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = 'text',
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-medium text-gray-700">
        {label}
        <span className="ml-0.5 text-[#062B59]">*</span>
      </span>
      <input
        name={name}
        type={type}
        required
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#062B59]/40 focus:outline-none focus:ring-4 focus:ring-[#062B59]/10"
        {...rest}
      />
    </label>
  );
}

function Submit({
  busy,
  children,
}: {
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#062B59] px-6 py-4 text-[14px] font-semibold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:bg-[#031F43] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#062B59]/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {busy ? 'Signing in…' : children}
    </button>
  );
}
