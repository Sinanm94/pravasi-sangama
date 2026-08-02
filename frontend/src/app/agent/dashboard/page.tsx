'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Baby,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Ticket,
  Users,
} from 'lucide-react';
import {
  TICKET_TYPE_LABELS,
  type AgentTicketListResponse,
  type AgentTicketSummary,
} from '@pravasi/shared';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { Logo } from '@/components/ui/Logo';
import BrandBackdrop from '@/components/ui/BrandBackdrop';
import { apiGet, apiPost, errorMessage } from '@/lib/apiClient';
import { useAuthStore } from '@/store/useAuthStore';
import { springSurface } from '@/lib/motion';

const VIOLET = '#5E17EB';
const VIOLET_DEEP = '#37098C';

export default function AgentDashboardPage() {
  return (
    <ProtectedRoute allow={['AGENT']}>
      <LedgerScreen />
    </ProtectedRoute>
  );
}

/* ================================================================== */

function LedgerScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.userData);
  const logout = useAuthStore((s) => s.logout);

  const [data, setData] = useState<AgentTicketListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setData(await apiGet<AgentTicketListResponse>('/tickets/mine'));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
      // Keep whatever is on screen — a stale ledger beats a blank one.
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Derived, never mirrored into state (§6.1). */
  const visible = useMemo(() => {
    const rows = data?.tickets ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((t) =>
      [t.purchaserName, t.purchaserMobile, t.ticketNumber, t.requestNumber]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [data, search]);

  const signOut = async () => {
    await apiPost('/auth/logout').catch(() => {});
    logout();
    router.replace('/login');
  };

  const totals = data?.totals;

  return (
    <div className="relative min-h-dvh bg-gray-50 font-sans antialiased">
      <BrandBackdrop />

      {/* Masthead */}
      {/* White for the logo's sake (§5.3), with a deep-violet rule beneath —
          the agent shell has no nav rail, so this stands in for AdminShell's
          dark band and keeps the two shells anchored the same way. */}
      <header className="relative z-10 border-b-[3px] bg-white"
              style={{ borderBottomColor: VIOLET_DEEP }}>
        {/* Same max-w as <main> below, so the mark lines up with the left
            edge of the cards. */}
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Logo className="h-9 w-9" />
            <div className="min-w-0">
              {/* Wider tracking than Tailwind's tracking-widest (0.1em),
                  which would have been narrower than what was here. 0.28em is
                  the top of §5.2's eyebrow range. A unit name is variable
                  length, so this one truncates rather than nowraps. */}
              {/* Amber on white is 1.97:1 — the overline takes violet. */}
              <p
                className="truncate text-[10px] font-semibold uppercase leading-[1.4] tracking-[0.28em]"
                style={{ color: VIOLET }}
              >
                {user?.unitName ?? 'Registration Desk'}
              </p>
              <p className="mt-0.5 truncate text-[15px] font-semibold text-gray-900">
                {user?.agentName ?? 'Agent'}
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
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-gray-900">
              My Registrations
            </h1>
            <p className="mt-1.5 text-[13px] text-gray-500">
              {data === null
                ? 'Loading your ledger…'
                : `${totals?.tickets ?? 0} ticket${totals?.tickets === 1 ? '' : 's'} issued`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              aria-label="Refresh ledger"
              className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2.5 text-[13px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97] disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                strokeWidth={2.25}
              />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => router.push('/ticketing')}
              className="inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-[13px] font-semibold text-white transition-all duration-200 hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5E17EB]/20 active:scale-[0.98]"
              style={{ backgroundColor: VIOLET }}
            >
              <Plus className="h-4 w-4" strokeWidth={2.75} />
              New Registration
            </button>
          </div>
        </div>

        {loadError && (
          <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50 p-4">
            <AlertCircle
              className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600"
              strokeWidth={2.25}
            />
            <p className="text-[13px] leading-snug text-amber-800">
              Could not refresh your ledger — {loadError}
            </p>
          </div>
        )}

        {/* Totals */}
        <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon={Ticket} label="Tickets issued" value={totals?.tickets} hint="All time" />
          <StatCard
            icon={Users}
            label="Guests admitted"
            value={totals?.seats}
            hint="Seats on active tickets"
          />
          <StatCard
            icon={Baby}
            label="Children below 12"
            value={totals?.children}
            hint="Free — outside ticket capacity"
          />
        </div>

        {/* Search */}
        <div className="relative mt-6">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            strokeWidth={2.25}
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, mobile, ticket or request number"
            aria-label="Search your registrations"
            className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
          {data === null ? (
            <LedgerSkeleton />
          ) : data.tickets.length === 0 ? (
            <Empty
              title="No registrations yet"
              body="Tickets you issue appear here. Tap New Registration to issue the first one."
            />
          ) : visible.length === 0 ? (
            <Empty
              title="No matches"
              body={`Nothing in your ledger matches “${search.trim()}”.`}
            />
          ) : (
            /* Scrolls inside its own container so the page never scrolls
               sideways on the phone an agent is actually holding. */
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-gray-900/[0.06]">
                    <Th>Purchaser</Th>
                    <Th>Ticket</Th>
                    <Th>Type</Th>
                    <Th numeric>Guests</Th>
                    <Th numeric>Children</Th>
                    <Th numeric>Issued</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-900/[0.05]">
                  {visible.map((t) => (
                    <Row key={t.id} ticket={t} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {data !== null && data.tickets.length > 0 && (
          <p className="mt-4 px-1 text-[12px] leading-relaxed text-gray-400">
            Children below 12 enter free and are not counted as guests — they
            do not consume a QR code. Revoked tickets stay listed but are
            excluded from the totals above.
          </p>
        )}
      </main>
    </div>
  );
}

/* ================================================================== */

function Row({ ticket }: { ticket: AgentTicketSummary }) {
  const revoked = ticket.status === 'REVOKED';

  return (
    <motion.tr
      layout
      transition={springSurface}
      className={`align-middle transition-colors hover:bg-gray-50/70 ${
        revoked ? 'opacity-55' : ''
      }`}
    >
      <td className="px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[15px] font-medium text-gray-900">
            {ticket.purchaserName}
          </p>
          {revoked && (
            <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-red-600">
              Revoked
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] tabular-nums text-gray-500">
          {ticket.purchaserMobile}
        </p>
      </td>

      <td className="px-5 py-4 sm:px-6">
        <p className="text-[13px] font-medium tabular-nums text-gray-900">
          {ticket.ticketNumber}
        </p>
        <p className="mt-0.5 text-[11px] tabular-nums text-gray-400">
          {ticket.requestNumber}
        </p>
      </td>

      <td className="px-5 py-4 sm:px-6">
        <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-600">
          {TICKET_TYPE_LABELS[ticket.ticketType]}
        </span>
      </td>

      <td className="px-5 py-4 text-right text-[15px] font-semibold tabular-nums text-gray-900 sm:px-6">
        {ticket.countedPersons}
      </td>

      {/* The column this page exists to surface — captured at registration
          but previously invisible everywhere after it. */}
      <td className="px-5 py-4 text-right text-[15px] tabular-nums sm:px-6">
        {ticket.childrenBelow12 > 0 ? (
          <span className="font-semibold text-gray-900">
            {ticket.childrenBelow12}
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>

      <td className="px-5 py-4 text-right text-[13px] tabular-nums text-gray-500 sm:px-6">
        {formatWhen(ticket.createdAt)}
      </td>
    </motion.tr>
  );
}

/* ------------------------------------------------------------------ */
/* Local primitives — promote on a second consumer (§6.4)              */
/* ------------------------------------------------------------------ */

function Th({
  children,
  numeric,
}: {
  children: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <th
      scope="col"
      className={`px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 sm:px-6 ${
        numeric ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Ticket;
  label: string;
  value: number | undefined;
  hint: string;
}) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-gray-500">{label}</p>
        <Icon className="h-4 w-4 shrink-0 text-gray-300" strokeWidth={2.25} />
      </div>
      {value === undefined ? (
        <div className="mt-4 h-[34px] w-20 animate-pulse rounded-lg bg-gray-100" />
      ) : (
        <p className="mt-4 text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-gray-900">
          {value.toLocaleString()}
        </p>
      )}
      <p className="mt-2.5 text-[12px] text-gray-400">{hint}</p>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
        <Ticket className="h-6 w-6 text-gray-400" strokeWidth={2} />
      </span>
      <p className="mt-5 text-[15px] font-semibold text-gray-900">{title}</p>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-gray-500">
        {body}
      </p>
    </div>
  );
}

function LedgerSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-gray-900/[0.05]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-40 animate-pulse rounded-full bg-gray-100" />
            <div className="h-3 w-28 animate-pulse rounded-full bg-gray-50" />
          </div>
          <div className="hidden w-28 space-y-2 sm:block">
            <div className="h-3 w-24 animate-pulse rounded-full bg-gray-100" />
          </div>
          <div className="h-4 w-8 animate-pulse rounded-full bg-gray-100" />
          <div className="h-4 w-8 animate-pulse rounded-full bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

function formatWhen(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}
