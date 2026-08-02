'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  Search,
  Ticket,
  Users,
  UserX,
} from 'lucide-react';
import type { AgentDirectoryEntry, AgentDirectoryResponse } from '@pravasi/shared';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AdminShell, { Card, EmptyState } from '@/components/admin/AdminShell';
import { apiGet, errorMessage } from '@/lib/apiClient';
import { springSurface } from '@/lib/motion';

const VIOLET = '#5E17EB';

/** Columns the table can be ordered by. */
type SortKey = 'name' | 'unit' | 'tickets' | 'seats' | 'last';

export default function AgentDirectoryPage() {
  return (
    <ProtectedRoute allow={['SUPERUSER']}>
      <DirectoryScreen />
    </ProtectedRoute>
  );
}

/* ================================================================== */

function DirectoryScreen() {
  const [data, setData] = useState<AgentDirectoryResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('tickets');
  const [descending, setDescending] = useState(true);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const next = await apiGet<AgentDirectoryResponse>('/admin/agent-directory');
      setData(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
      // Keep whatever is on screen — a stale table beats a blank one.
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Filter and sort are derived, never mirrored into state (§6.1). Holding a
   * second copy of the list would let it drift from `data` on refresh. */
  const visible = useMemo(() => {
    const rows = data?.agents ?? [];
    const needle = search.trim().toLowerCase();

    const matched = needle
      ? rows.filter((a) =>
          [a.name, a.mobileNumber, a.email ?? '', a.unitName, a.unitCode, a.divisionName]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : rows;

    const direction = descending ? -1 : 1;

    return [...matched].sort((a, b) => {
      switch (sort) {
        case 'name':
          return direction * a.name.localeCompare(b.name);
        case 'unit':
          return direction * a.unitName.localeCompare(b.unitName);
        case 'seats':
          return direction * (a.seatsIssued - b.seatsIssued);
        case 'last':
          // Never-issued sorts last in both directions: an agent with no
          // activity is not "the most recent" just because the field is null.
          if (!a.lastIssuedAt && !b.lastIssuedAt) return 0;
          if (!a.lastIssuedAt) return 1;
          if (!b.lastIssuedAt) return -1;
          return direction * (Date.parse(a.lastIssuedAt) - Date.parse(b.lastIssuedAt));
        default:
          return direction * (a.ticketsIssued - b.ticketsIssued);
      }
    });
  }, [data, search, sort, descending]);

  /** Scale for the volume bars. Guarded so a table of zeroes cannot divide by 0. */
  const busiest = useMemo(
    () => Math.max(1, ...(data?.agents ?? []).map((a) => a.ticketsIssued)),
    [data],
  );

  const toggleSort = (key: SortKey) => {
    if (sort === key) {
      setDescending((d) => !d);
      return;
    }
    setSort(key);
    // Text reads naturally A→Z; counts and dates are most useful highest-first.
    setDescending(key !== 'name' && key !== 'unit');
  };

  const totals = data?.totals;

  return (
    <AdminShell
      title="Agent Directory"
      subtitle={
        data === null
          ? 'Loading agents…'
          : `${totals?.agents ?? 0} approved agent${totals?.agents === 1 ? '' : 's'}`
      }
      actions={
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-[13px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97] disabled:opacity-60"
        >
          <RefreshCw
            className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
            strokeWidth={2.25}
          />
          Refresh
        </button>
      }
    >
      {loadError && (
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50 p-4">
          <AlertCircle
            className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600"
            strokeWidth={2.25}
          />
          <p className="text-[13px] leading-snug text-amber-800">
            Could not refresh the directory — {loadError}
          </p>
        </div>
      )}

      {/* Totals — from the server, so they never disagree with the rows */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={Users}
          label="Approved agents"
          value={totals?.agents}
          hint="Able to sign in and issue"
        />
        <StatCard
          icon={Ticket}
          label="Tickets issued"
          value={totals?.ticketsIssued}
          hint="All time, revoked included"
        />
        <StatCard
          icon={Users}
          label="Seats issued"
          value={totals?.seatsIssued}
          hint="Capacity on active tickets — not attendance"
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
          placeholder="Search name, mobile, email, unit or division"
          aria-label="Search agents"
          className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
        />
      </div>

      <div className="mt-4">
        <Card>
          {data === null ? (
            <TableSkeleton />
          ) : data.agents.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No approved agents"
              body="Agents appear here once their registration is approved. Until then they cannot sign in or issue tickets."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matches"
              body={`Nothing in the directory matches “${search.trim()}”. Clear the search to see every agent.`}
            />
          ) : (
            /* The table scrolls inside its own container rather than letting
             * the page scroll sideways on a phone. */
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-gray-900/[0.06]">
                    <SortHeader
                      label="Agent"
                      active={sort === 'name'}
                      descending={descending}
                      onClick={() => toggleSort('name')}
                    />
                    <SortHeader
                      label="Unit"
                      active={sort === 'unit'}
                      descending={descending}
                      onClick={() => toggleSort('unit')}
                    />
                    <SortHeader
                      label="Tickets"
                      numeric
                      active={sort === 'tickets'}
                      descending={descending}
                      onClick={() => toggleSort('tickets')}
                    />
                    <SortHeader
                      label="Seats"
                      numeric
                      active={sort === 'seats'}
                      descending={descending}
                      onClick={() => toggleSort('seats')}
                    />
                    <SortHeader
                      label="Last issued"
                      numeric
                      active={sort === 'last'}
                      descending={descending}
                      onClick={() => toggleSort('last')}
                    />
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-900/[0.05]">
                  {visible.map((agent) => (
                    <AgentRow key={agent.id} agent={agent} busiest={busiest} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {data !== null && data.agents.length > 0 && (
        <p className="mt-4 px-1 text-[12px] leading-relaxed text-gray-400">
          Counts cover every ticket an agent has issued, including any later
          revoked. Seats are the capacity printed on active tickets — arrivals
          are counted at the gate, not here.
        </p>
      )}
    </AdminShell>
  );
}

/* ================================================================== */

function AgentRow({
  agent,
  busiest,
}: {
  agent: AgentDirectoryEntry;
  busiest: number;
}) {
  return (
    <motion.tr
      layout
      transition={springSurface}
      className="align-middle transition-colors hover:bg-gray-50/70"
    >
      {/* Identity */}
      <td className="px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[15px] font-medium text-gray-900">
            {agent.name}
          </p>
          {/* Optional data drives state, not blank space (§6.3). */}
          {!agent.isActive && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
              <UserX className="h-3 w-3" strokeWidth={2.5} />
              Disabled
            </span>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-gray-500">
          <span className="font-medium tabular-nums text-gray-700">
            {agent.mobileNumber}
          </span>
          {agent.email ? (
            <>
              <span className="text-gray-300">·</span>
              <span className="truncate">{agent.email}</span>
            </>
          ) : (
            <>
              <span className="text-gray-300">·</span>
              <span className="text-gray-400">No email on file</span>
            </>
          )}
        </p>
      </td>

      {/* Posting */}
      <td className="px-5 py-4 sm:px-6">
        <p className="text-[13px] font-medium text-gray-900">{agent.unitName}</p>
        <p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-gray-400">
          {agent.divisionName} · {agent.unitCode}
        </p>
      </td>

      {/* Tickets, with a bar for relative volume */}
      <td className="px-5 py-4 text-right sm:px-6">
        <p className="text-[15px] font-semibold tabular-nums text-gray-900">
          {formatNumber(agent.ticketsIssued)}
        </p>
        {agent.ticketsRevoked > 0 && (
          <p className="mt-0.5 text-[11px] tabular-nums text-amber-600">
            {formatNumber(agent.ticketsRevoked)} revoked
          </p>
        )}
        <div className="mt-1.5 ml-auto h-1 w-20 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.round((agent.ticketsIssued / busiest) * 100)}%`,
              backgroundColor: VIOLET,
            }}
          />
        </div>
      </td>

      <td className="px-5 py-4 text-right text-[15px] tabular-nums text-gray-700 sm:px-6">
        {formatNumber(agent.seatsIssued)}
      </td>

      <td className="px-5 py-4 text-right text-[13px] tabular-nums text-gray-500 sm:px-6">
        {agent.lastIssuedAt ? (
          formatWhen(agent.lastIssuedAt)
        ) : (
          <span className="text-gray-400">Never</span>
        )}
      </td>
    </motion.tr>
  );
}

/* ------------------------------------------------------------------ */
/* Local primitives — promote to components/ui/ on a second consumer   */
/* ------------------------------------------------------------------ */

function SortHeader({
  label,
  numeric,
  active,
  descending,
  onClick,
}: {
  label: string;
  numeric?: boolean;
  active: boolean;
  descending: boolean;
  onClick: () => void;
}) {
  const Arrow = descending ? ArrowDown : ArrowUp;

  return (
    <th
      scope="col"
      aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
      className={`px-5 py-3 sm:px-6 ${numeric ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
          active ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
        } ${numeric ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <Arrow
          className={`h-3 w-3 transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
          strokeWidth={2.75}
        />
      </button>
    </th>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
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
          {formatNumber(value)}
        </p>
      )}

      <p className="mt-2.5 text-[12px] text-gray-400">{hint}</p>
    </div>
  );
}

/** Sized to the real row so the layout does not jump when data lands. */
function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-gray-900/[0.05]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-40 animate-pulse rounded-full bg-gray-100" />
            <div className="h-3 w-56 animate-pulse rounded-full bg-gray-50" />
          </div>
          <div className="hidden w-32 space-y-2 sm:block">
            <div className="h-3 w-24 animate-pulse rounded-full bg-gray-100" />
            <div className="h-2.5 w-20 animate-pulse rounded-full bg-gray-50" />
          </div>
          <div className="h-4 w-10 animate-pulse rounded-full bg-gray-100" />
          <div className="h-4 w-10 animate-pulse rounded-full bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const formatNumber = (n: number) => n.toLocaleString();

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
