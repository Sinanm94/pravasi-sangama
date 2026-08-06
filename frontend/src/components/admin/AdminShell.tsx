'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { BarChart3, DoorOpen, LogOut, Tickets, Users } from 'lucide-react';
import { apiPost } from '@/lib/apiClient';
import { useAuthStore } from '@/store/useAuthStore';
import { springSurface } from '@/lib/motion';
import { Logo } from '@/components/ui/Logo';
import BrandBackdrop from '@/components/ui/BrandBackdrop';

const VIOLET = '#5E17EB';
const VIOLET_DEEP = '#37098C';
const AMBER = '#FFA51F';

/**
 * Chrome for every superuser screen: masthead, section nav, sign out.
 *
 * This wraps /dashboard too. It previously did not — the dashboard was left
 * full-bleed on the theory that a wallboard is watched rather than operated —
 * but that left it with no way into the admin sections except a single
 * "Administration" link, and no way back from them at all. Every section is
 * Masthead, nav rail and body all share SHELL_WIDTH, so the branding sits on
 * the same vertical axis as the cards beneath it.
 */

const SECTIONS = [
  { href: '/dashboard', label: 'System Overview', icon: BarChart3 },
  { href: '/admin/directory', label: 'Agent Directory', icon: Users },
  { href: '/admin/tickets', label: 'Ticket Ledger', icon: Tickets },
  { href: '/admin/gates', label: 'Gate Management', icon: DoorOpen },
];

/**
 * ONE width for masthead, nav rail and body, so the mark lines up with the
 * left edge of the cards below it.
 *
 * This replaced a per-page `wide` prop that gave the dashboard and ticket
 * ledger max-w-7xl and the other three sections max-w-6xl. Since the prop
 * also sized the chrome, the nav rail visibly resized when clicking between
 * tabs. 7xl is the wider of the two, so nothing lost room — and the overline
 * at 0.28em tracking gets the space it needs.
 */
const SHELL_WIDTH = 'max-w-7xl';

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
    <div className="relative min-h-dvh bg-gray-50 font-sans antialiased">
      <BrandBackdrop />

      {/* Masthead */}
      {/* Two-tone chrome.
          Band 1 is WHITE because the logo is dark violet and vanishes on a
          dark surface (§5.3). Band 2 is deep violet, which is what gives the
          page its structural weight back — with a white masthead over white
          cards on a near-white page there was nothing anchoring the layout.
          Each band paints full-bleed while its contents stay on SHELL_WIDTH,
          so the colour reaches the viewport edges but the mark still lines up
          with the cards below. */}
      <header className="relative z-10">
        <div className="bg-white">
          <div className={`mx-auto flex ${SHELL_WIDTH} items-center justify-between gap-4 px-5 py-4 sm:px-8`}>
          {/* items-center here, not just on the outer row: it centers the
              mark against its own two-line text stack, independent of
              whatever height the sign-out button ends up being. */}
          <div className="flex min-w-0 shrink items-center gap-3">
            <Logo className="h-9 w-9" />
            <div className="min-w-0">
              {/* whitespace-nowrap so the wider tracking cannot push it onto
                  a second line, which would shove the title down and unbalance
                  the row against the sign-out button. */}
              {/* Amber on white is 1.97:1 — unreadable, the same trap gold had
                  (§5.3). The overline takes the violet instead. */}
              <p
                className="whitespace-nowrap text-[10px] font-semibold uppercase leading-[1.4] tracking-[0.28em]"
                style={{ color: VIOLET }}
              >
                Karnataka Cultural Foundation
              </p>
              <p className="mt-0.5 truncate text-[15px] font-semibold text-gray-900">
                Pravasi Sangama 2026 · Administration
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97]"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={2.25} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
          </div>
        </div>

        {/* Section nav — deep violet, the page's one dark anchor. */}
        <div style={{ backgroundColor: VIOLET_DEEP }}>
        <nav className={`mx-auto ${SHELL_WIDTH} px-5 sm:px-8`}>
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
                      active
                        ? 'text-white'
                        : 'text-white/60 hover:text-white/85'
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
                      style={{ backgroundColor: AMBER }}
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
        </div>
      </header>

      {/* Page */}
      <main className={`relative z-10 mx-auto ${SHELL_WIDTH} px-5 py-8 sm:px-8 sm:py-10`}>
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
  icon: typeof BarChart3;
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
