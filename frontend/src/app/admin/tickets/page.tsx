'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertCircle,
  Baby,
  ChevronDown,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import {
  TICKET_STATUSES,
  TICKET_TYPE_LABELS,
  type AdminFilterOptions,
  type AdminTicketLedgerResponse,
  type AdminTicketRow,
  type TicketStatus,
} from '@pravasi/shared';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AdminShell, { Card, EmptyState } from '@/components/admin/AdminShell';
import { apiDownload, apiGet, errorMessage } from '@/lib/apiClient';
import { springSurface } from '@/lib/motion';

const VIOLET = '#5E17EB';

const STATUS_LABELS: Record<TicketStatus, string> = {
  ACTIVE: 'Active',
  REVOKED: 'Revoked',
};

interface Filters {
  divisionId: string;
  unitId: string;
  agentId: string;
  status: TicketStatus | '';
}

const NO_FILTERS: Filters = { divisionId: '', unitId: '', agentId: '', status: '' };

/**
 * Shared by the JSON list request and the CSV export — both accept the same
 * filters (§ backend AdminTicketQuerySchema / AdminTicketExportQuerySchema),
 * so there is exactly one place that turns UI filter state into a query
 * string for either of them to disagree about.
 */
function buildQueryString(f: Filters, searchTerm: string): string {
  const params = new URLSearchParams();
  if (f.divisionId) params.set('division_id', f.divisionId);
  if (f.unitId) params.set('unit_id', f.unitId);
  if (f.agentId) params.set('agent_id', f.agentId);
  if (f.status) params.set('status', f.status);
  if (searchTerm) params.set('search', searchTerm);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export default function TicketLedgerPage() {
  return (
    <ProtectedRoute allow={['SUPERUSER']}>
      <LedgerScreen />
    </ProtectedRoute>
  );
}

/* ================================================================== */

function LedgerScreen() {
  const [data, setData] = useState<AdminTicketLedgerResponse | null>(null);
  const [options, setOptions] = useState<AdminFilterOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState('');
  /** Debounced mirror of `search` — this is what actually hits the API. */
  const [committedSearch, setCommittedSearch] = useState('');

  /* One request per pause in typing, not one per keystroke. The ledger is a
   * full-table scan behind an ILIKE; firing it on every character would put
   * the admin's keyboard in front of the database. */
  useEffect(() => {
    const id = setTimeout(() => setCommittedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    apiGet<AdminFilterOptions>('/admin/filter-options')
      .then(setOptions)
      // Non-fatal: the table still works, the dropdowns just stay empty.
      .catch(() => setOptions({ divisions: [], units: [], agents: [] }));
  }, []);

  const load = useCallback(
    async (f: Filters, searchTerm: string, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);

      try {
        setData(
          await apiGet<AdminTicketLedgerResponse>(
            `/admin/tickets${buildQueryString(f, searchTerm)}`,
          ),
        );
        setLoadError(null);
      } catch (err) {
        setLoadError(errorMessage(err));
      } finally {
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(filters, committedSearch);
  }, [load, filters, committedSearch]);

  const [exporting, setExporting] = useState(false);

  const downloadReport = async () => {
    setExporting(true);
    try {
      await apiDownload(
        `/admin/tickets/export${buildQueryString(filters, committedSearch)}`,
        'pravasi-tickets-report.csv',
      );
    } catch (err) {
      toast.error('Could not download the report', {
        description: errorMessage(err),
      });
    } finally {
      setExporting(false);
    }
  };

  /* Dependent option lists, derived — never a second copy in state (§6.1). */
  const unitOptions = useMemo(() => {
    const all = options?.units ?? [];
    return filters.divisionId
      ? all.filter((u) => u.divisionId === filters.divisionId)
      : all;
  }, [options, filters.divisionId]);

  const agentOptions = useMemo(() => {
    const all = options?.agents ?? [];
    if (filters.unitId) return all.filter((a) => a.unitId === filters.unitId);
    if (filters.divisionId) {
      const ids = new Set(unitOptions.map((u) => u.id));
      return all.filter((a) => ids.has(a.unitId));
    }
    return all;
  }, [options, filters.unitId, filters.divisionId, unitOptions]);

  /* Narrowing the parent invalidates the children, so clear them in the same
   * update. Leaving a stale unit selected under a new division would send a
   * filter pair that matches nothing and read as "no tickets". Status isn't
   * part of that hierarchy, so it survives every one of these unchanged. */
  const setDivision = (divisionId: string) =>
    setFilters((p) => ({ ...p, divisionId, unitId: '', agentId: '' }));

  const setUnit = (unitId: string) =>
    setFilters((p) => ({ ...p, unitId, agentId: '' }));

  const setAgent = (agentId: string) =>
    setFilters((p) => ({ ...p, agentId }));

  const setStatus = (status: string) =>
    setFilters((p) => ({ ...p, status: status as TicketStatus | '' }));

  const filtered =
    Boolean(filters.divisionId || filters.unitId || filters.agentId || filters.status) ||
    committedSearch.length > 0;

  const clearAll = () => {
    setFilters(NO_FILTERS);
    setSearch('');
  };

  const totals = data?.totals;

  return (
    <AdminShell
      title="Ticket Ledger"
      subtitle={
        data === null
          ? 'Loading tickets…'
          : filtered
            ? `${totals?.tickets.toLocaleString() ?? 0} matching ticket${totals?.tickets === 1 ? '' : 's'}`
            : `${totals?.tickets.toLocaleString() ?? 0} ticket${totals?.tickets === 1 ? '' : 's'} issued`
      }
      actions={
        <button
          type="button"
          onClick={() => void load(filters, committedSearch, true)}
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
            Could not load the ledger — {loadError}
          </p>
        </div>
      )}

      {/* Summary — server-aggregated over the whole filtered set */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={Ticket}
          label={filtered ? 'Filtered tickets' : 'Tickets sold'}
          value={totals?.tickets}
          hint="Includes revoked"
        />
        <StatCard
          icon={Users}
          label={filtered ? 'Filtered seats' : 'Seats sold'}
          value={totals?.seats}
          hint="Adults on active tickets"
        />
        <StatCard
          icon={Baby}
          label="Children below 12"
          value={totals?.children}
          hint="Free — outside capacity"
        />
      </div>

      {/* Filters */}
      <div className="mt-6 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SelectFilter
            label="Division"
            value={filters.divisionId}
            onChange={setDivision}
            placeholder="All divisions"
            options={(options?.divisions ?? []).map((d) => ({
              value: d.id,
              label: `${d.name} · ${d.code}`,
            }))}
          />
          <SelectFilter
            label="Unit / Location"
            value={filters.unitId}
            onChange={setUnit}
            placeholder="All units"
            options={unitOptions.map((u) => ({
              value: u.id,
              label: `${u.name} · ${u.unitCode}`,
            }))}
          />
          <SelectFilter
            label="Agent"
            value={filters.agentId}
            onChange={setAgent}
            placeholder="All agents"
            options={agentOptions.map((a) => ({
              value: a.id,
              label: `${a.name} · ${a.mobileNumber}`,
            }))}
          />
          <SelectFilter
            label="Status"
            value={filters.status}
            onChange={setStatus}
            placeholder="All statuses"
            options={TICKET_STATUSES.map((s) => ({
              value: s,
              label: STATUS_LABELS[s],
            }))}
          />

          <div>
            <label
              htmlFor="ledger-search"
              className="mb-2 block text-[13px] font-medium text-gray-700"
            >
              Search
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                strokeWidth={2.25}
              />
              <input
                id="ledger-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, mobile or ticket no."
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
              />
            </div>
          </div>
        </div>

        {/* Always visible, not just when filtered — the download button lives
            here because it acts on whatever this row currently expresses:
            "everything" with no filters set, or the filtered subset. */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <p className="text-[12px] text-gray-400">
            {filtered
              ? 'Summary cards above reflect these filters. The download matches them too.'
              : 'No filters applied — the download will contain every ticket.'}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {filtered && (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2 text-[12px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97]"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                Clear filters
              </button>
            )}
            <button
              type="button"
              onClick={() => void downloadReport()}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: VIOLET }}
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
              ) : (
                <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
              )}
              {exporting ? 'Preparing…' : 'Download Report'}
            </button>
          </div>
        </div>
      </div>

      {data?.truncated && (
        <p className="mt-4 px-1 text-[12px] leading-relaxed text-amber-700">
          Showing the {data.limit.toLocaleString()} most recent of{' '}
          {data.totals.tickets.toLocaleString()} matching tickets. The summary
          cards above count all of them — narrow the filters to see the rest.
        </p>
      )}

      <div className="mt-4">
        <Card>
          {data === null ? (
            <LedgerSkeleton />
          ) : data.tickets.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title={filtered ? 'No matching tickets' : 'No tickets issued yet'}
              body={
                filtered
                  ? 'Nothing matches these filters. Clear them to see the full ledger.'
                  : 'Tickets appear here as agents issue them.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-gray-900/[0.06]">
                    <Th>Ticket</Th>
                    <Th>Purchaser</Th>
                    <Th>Type</Th>
                    <Th numeric>Seats</Th>
                    <Th>Issued by</Th>
                    <Th>Unit / Location</Th>
                    <Th numeric>Issued</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-900/[0.05]">
                  {data.tickets.map((t) => (
                    <Row key={t.id} ticket={t} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}

/* ================================================================== */

function Row({ ticket }: { ticket: AdminTicketRow }) {
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
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium tabular-nums text-gray-900">
            {ticket.ticketNumber}
          </p>
          {revoked && (
            <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-red-600">
              Revoked
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] tabular-nums text-gray-400">
          {ticket.requestNumber}
        </p>
      </td>

      <td className="px-5 py-4 sm:px-6">
        <p className="truncate text-[15px] font-medium text-gray-900">
          {ticket.purchaserName}
        </p>
        <p className="mt-0.5 text-[12px] tabular-nums text-gray-500">
          {ticket.purchaserMobile}
        </p>
      </td>

      <td className="px-5 py-4 sm:px-6">
        <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-600">
          {TICKET_TYPE_LABELS[ticket.ticketType]}
        </span>
      </td>

      {/* Adults and children kept visually separate: children are free and
          never consume a guest QR, so a single summed number would misstate
          how many people the ticket actually admits (§4.2). */}
      <td className="px-5 py-4 text-right sm:px-6">
        <p className="text-[15px] font-semibold tabular-nums text-gray-900">
          {ticket.countedPersons}
        </p>
        <p className="mt-0.5 text-[11px] tabular-nums text-gray-400">
          {ticket.childrenBelow12 > 0
            ? `+${ticket.childrenBelow12} child${ticket.childrenBelow12 === 1 ? '' : 'ren'}`
            : 'no children'}
        </p>
      </td>

      <td className="px-5 py-4 sm:px-6">
        <p className="truncate text-[13px] font-medium text-gray-900">
          {ticket.agentName}
        </p>
      </td>

      <td className="px-5 py-4 sm:px-6">
        <p className="truncate text-[13px] font-medium text-gray-900">
          {ticket.unitName}
        </p>
        <p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-gray-400">
          {ticket.divisionName} · {ticket.unitCode}
        </p>
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

function SelectFilter({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-medium text-gray-700">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full cursor-pointer appearance-none rounded-xl border border-gray-200 bg-white py-3 pl-4 pr-11 text-[15px] text-gray-900 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-400"
          strokeWidth={2.25}
        />
      </div>
    </label>
  );
}

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
        <motion.p
          key={value}
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 1 }}
          transition={springSurface}
          className="mt-4 text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-gray-900"
          style={{ color: VIOLET }}
        >
          {value.toLocaleString()}
        </motion.p>
      )}
      <p className="mt-2.5 text-[12px] text-gray-400">{hint}</p>
    </div>
  );
}

function LedgerSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-gray-900/[0.05]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 px-5 py-4 sm:px-6">
          <div className="w-32 space-y-2">
            <div className="h-3.5 w-24 animate-pulse rounded-full bg-gray-100" />
            <div className="h-3 w-28 animate-pulse rounded-full bg-gray-50" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-40 animate-pulse rounded-full bg-gray-100" />
            <div className="h-3 w-24 animate-pulse rounded-full bg-gray-50" />
          </div>
          <div className="h-6 w-16 animate-pulse rounded-full bg-gray-100" />
          <div className="h-4 w-8 animate-pulse rounded-full bg-gray-100" />
          <div className="hidden w-32 sm:block">
            <div className="h-3 w-28 animate-pulse rounded-full bg-gray-100" />
          </div>
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
    year: 'numeric',
  });
}
