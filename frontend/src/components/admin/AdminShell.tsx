'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { BarChart3, DoorOpen, LogOut, UserCheck } from 'lucide-react';
import { apiPost } from '@/lib/apiClient';
import { useAuthStore } from '@/store/useAuthStore';
import { springSurface } from '@/lib/motion';
import { Logo } from '@/components/ui/Logo';

const NAVY = '#062B59';

/**
 * Chrome for every /admin page: masthead, section nav, sign out.
 *
 * The live dashboard at /dashboard stays a separate full-bleed screen — it is
 * a wallboard, watched rather than operated, and wrapping it in navigation
 * would waste the vertical space its charts need.
 */

const SECTIONS = [
  { href: '/dashboard', label: 'Live Dashboard', icon: BarChart3 },
  { href: '/admin/approvals', label: 'Agent Approvals', icon: UserCheck },
  { href: '/admin/gates', label: 'Gate Management', icon: DoorOpen },
];

export default function AdminShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  const signOut = async () => {
    await apiPost('/auth/logout').catch(() => {});
    logout();
    router.replace('/login');
  };

  return (
    <div className="min-h-dvh bg-gray-50 font-sans antialiased">
      {/* Masthead */}
      <header style={{ backgroundColor: NAVY }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          {/* items-center here, not just on the outer row: it centers the
              mark against its own two-line text stack, independent of
              whatever height the sign-out button ends up being. */}
          <div className="flex min-w-0 items-center gap-3">
            <Logo className="h-9 w-9" />
            <div className="min-w-0">
              <p
                className="text-[9px] font-semibold uppercase tracking-[0.24em]"
                style={{ color: '#D4AF37' }}
              >
                Karnataka Cultural Foundation
              </p>
              <p className="mt-0.5 truncate text-[15px] font-semibold text-white">
                Pravasi Sangama 2026 · Administration
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/20 hover:text-white active:scale-[0.97]"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={2.25} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>

        {/* Section nav — the active pill slides between items */}
        <nav className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="flex gap-1 overflow-x-auto pb-px">
            {SECTIONS.map((s) => {
              const active =
                pathname === s.href || pathname.startsWith(`${s.href}/`);

              return (
                <Link
                  key={s.href}
                  href={s.href}
                  className="relative shrink-0 px-4 py-3 text-[13px] font-medium transition-colors"
                >
                  <span
                    className={`relative z-10 inline-flex items-center gap-1.5 ${
                      active ? 'text-white' : 'text-white/55 hover:text-white/80'
                    }`}
                  >
                    <s.icon className="h-3.5 w-3.5" strokeWidth={2.25} />
                    {s.label}
                  </span>

                  {active && (
                    <motion.span
                      layoutId="admin-nav-underline"
                      transition={springSurface}
                      className="absolute inset-x-3 bottom-0 h-[2px] rounded-full"
                      style={{ backgroundColor: '#D4AF37' }}
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      {/* Page */}
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-gray-900">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1.5 text-[13px] text-gray-500">{subtitle}</p>
            )}
          </div>
          {actions}
        </div>

        <div className="mt-7">{children}</div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared panels                                                       */
/* ------------------------------------------------------------------ */

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
      {children}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof UserCheck;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
        <Icon className="h-6 w-6 text-gray-400" strokeWidth={2} />
      </span>
      <p className="mt-5 text-[15px] font-semibold text-gray-900">{title}</p>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-gray-500">
        {body}
      </p>
    </div>
  );
}

/** Row skeletons. Sized to the real row so the layout does not jump. */
export function RowSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-gray-900/[0.05]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-40 animate-pulse rounded-full bg-gray-100" />
            <div className="h-3 w-56 animate-pulse rounded-full bg-gray-50" />
          </div>
          <div className="h-9 w-24 animate-pulse rounded-xl bg-gray-100" />
        </div>
      ))}
    </div>
  );
}
