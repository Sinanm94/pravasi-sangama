'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  RefreshCw,
  ScanLine,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import {
  EVENT_TIME_ZONE,
  SCAN_RESULTS,
  TICKET_TYPE_LABELS,
  type AdminScanLogResponse,
  type AdminScanRow,
  type ScanResult,
} from '@pravasi/shared';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AdminShell, { Card, EmptyState } from '@/components/admin/AdminShell';
import { apiGet, errorMessage } from '@/lib/apiClient';
import { springSurface } from '@/lib/motion';

const VIOLET = '#5E17EB';

/** Plain words, not enum names — this is read by organisers, not engineers. */
const RESULT_LABELS: Record<ScanResult, string> = {
  ADMITTED: 'Entered',
  DUPLICATE: 'Already entered',
  REVOKED: 'Revoked',
  UNKNOWN_CODE: 'Not recognised',
  LOCATION_INFO: 'Location pass',
};

/** Same semantic palette as the gate overlay — green / amber / red (§5.3). */
const RESULT_TONE: Record<ScanResult, string> = {
  ADMITTED: 'bg-emerald-50 text-emerald-700',
  DUPLICATE: 'bg-amber-50 text-amber-700',
  REVOKED: 'bg-red-50 text-red-700',
  UNKNOWN_CODE: 'bg-red-50 text-red-700',
  LOCATION_INFO: 'bg-gray-100 text-gray-600',
};

interface Filters {
  result: ScanResult | '';
  gateLabel: string;
}

const NO_FILTERS: Filters = { result: '', gateLabel: '' };

export default function ScanLogPage() {
  return (
    <ProtectedRoute allow={['SUPERUSER']}>
      <ScanLogScreen />
    </ProtectedRoute>
  );
}

/* ================================================================== */

function ScanLogScreen() {
  const [data, setData] = useState<AdminScanLogResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');

  /* One request per pause in typing — the search is an ILIKE across the
   * whole log, same reasoning as the ticket ledger. */
  useEffect(() => {
    const id = setTimeout(() => setCommittedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(
    async (f: Filters, term: string, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);

      const params = new URLSearchParams();
      if (f.result) params.set('result', f.result);
      if (f.gateLabel) params.set('gate_label', f.gateLabel);
      if (term) params.set('search', term);

      try {
        const qs = params.toString();
        setData(
          await apiGet<AdminScanLogResponse>(
            `/admin/scans${qs ? `?${qs}` : ''}`,
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

  const filtered =
    Boolean(filters.result || filters.gateLabel) || committedSearch.length > 0;

  const totals = data?.totals;

  return (
    <AdminShell
      title="Scan Log"
      subtitle={
        data === null
          ? 'Loading scans…'
          : `${(totals?.total ?? 0).toLocaleString()} scan${totals?.total === 1 ? '' : 's'}${
              filtered ? ' matching' : ' recorded'
            }`
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
            Could not load the scan log — {loadError}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={CheckCircle2}
          label="Entered"
          value={totals?.admitted}
          hint="Guests admitted"
        />
        <StatCard
          icon={Clock}
          label="Already entered"
          value={totals?.duplicate}
          hint="Repeat scans stopped"
        />
        <StatCard
          icon={XCircle}
          label="Rejected"
          value={totals?.rejected}
          hint="Revoked or unrecognised"
        />
      </div>

      {/* Filters */}
      <div className="mt-6 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectFilter
            label="Result"
            value={filters.result}
            onChange={(v) =>
              setFilters((p) => ({ ...p, result: v as ScanResult | '' }))
            }
            placeholder="All results"
            options={SCAN_RESULTS.map((r) => ({
              value: r,
              label: RESULT_LABELS[r],
            }))}
          />
          <SelectFilter
            label="Gate"
            value={filters.gateLabel}
            onChange={(v) => setFilters((p) => ({ ...p, gateLabel: v }))}
            placeholder="All gates"
            options={(data?.gates ?? []).map((g) => ({ value: g, label: g }))}
          />

          <div>
            <label
              htmlFor="scan-search"
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
                id="scan-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ticket no., buyer or gate"
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <p className="text-[12px] text-gray-400">
            Times shown in Riyadh time ({EVENT_TIME_ZONE}).
          </p>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setFilters(NO_FILTERS);
                setSearch('');
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2 text-[12px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97]"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {data?.truncated && (
        <p className="mt-4 px-1 text-[12px] leading-relaxed text-amber-700">
          Showing the {data.limit.toLocaleString()} most recent of{' '}
          {data.totals.total.toLocaleString()} matching scans. The counts above
          include all of them — narrow the filters to see the rest.
        </p>
      )}

      <div className="mt-4">
        <Card>
          {data === null ? (
            <LogSkeleton />
          ) : data.scans.length === 0 ? (
            <EmptyState
              icon={ScanLine}
              title={filtered ? 'No matching scans' : 'No scans yet'}
              body={
                filtered
                  ? 'Nothing matches these filters. Clear them to see the whole log.'
                  : 'Scans appear here as gate staff admit guests.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-gray-900/[0.06]">
                    <Th>When</Th>
                    <Th>Result</Th>
                    <Th>Ticket</Th>
                    <Th>Buyer</Th>
                    <Th>Gate</Th>
                    <Th>Scanned by</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-900/[0.05]">
                  {data.scans.map((s) => (
                    <Row key={s.id} scan={s} />
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

function Row({ scan }: { scan: AdminScanRow }) {
  return (
    <tr className="align-middle transition-colors hover:bg-gray-50/70">
      <td className="px-5 py-3.5 sm:px-6">
        <p className="text-[13px] font-medium tabular-nums text-gray-900">
          {formatEventTime(scan.scannedAt)}
        </p>
        <p className="mt-0.5 text-[11px] tabular-nums text-gray-400">
          {formatEventDate(scan.scannedAt)}
        </p>
      </td>

      <td className="px-5 py-3.5 sm:px-6">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] ${
            RESULT_TONE[scan.result]
          }`}
        >
          {RESULT_LABELS[scan.result]}
        </span>
      </td>

      <td className="px-5 py-3.5 sm:px-6">
        {scan.ticketNumber ? (
          <>
            <p className="text-[13px] font-medium tabular-nums text-gray-900">
              {scan.ticketNumber}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-400">
              {scan.ticketType ? TICKET_TYPE_LABELS[scan.ticketType] : '—'}
              {scan.guestIndex ? ` · Guest ${scan.guestIndex}` : ''}
            </p>
          </>
        ) : (
          /* An unrecognised code has no ticket to name — saying so beats a
             blank cell that reads as missing data. */
          <span className="text-[12px] text-gray-300">No ticket</span>
        )}
      </td>

      <td className="px-5 py-3.5 sm:px-6">
        {scan.purchaserName ? (
          <>
            <p className="truncate text-[13px] font-medium text-gray-900">
              {scan.purchaserName}
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-gray-500">
              {scan.purchaserMobile}
            </p>
          </>
        ) : (
          <span className="text-[12px] text-gray-300">—</span>
        )}
      </td>

      <td className="px-5 py-3.5 text-[13px] text-gray-600 sm:px-6">
        {scan.gateLabel ?? <span className="text-gray-300">—</span>}
      </td>

      <td className="px-5 py-3.5 sm:px-6">
        <p className="truncate text-[13px] text-gray-600">
          {scan.agentName ?? <span className="text-gray-300">Gate account</span>}
        </p>
        {scan.unitName && (
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-gray-400">
            {scan.unitSector ? `${scan.unitSector} · ` : ''}
            {scan.unitName}
          </p>
        )}
      </td>
    </tr>
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 sm:px-6"
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
  icon: typeof ScanLine;
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
          className="mt-4 text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums"
          style={{ color: VIOLET }}
        >
          {value.toLocaleString()}
        </motion.p>
      )}
      <p className="mt-2.5 text-[12px] text-gray-400">{hint}</p>
    </div>
  );
}

function LogSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-gray-900/[0.05]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 px-5 py-3.5 sm:px-6">
          <div className="w-24 space-y-2">
            <div className="h-3.5 w-16 animate-pulse rounded-full bg-gray-100" />
            <div className="h-3 w-20 animate-pulse rounded-full bg-gray-50" />
          </div>
          <div className="h-6 w-24 animate-pulse rounded-full bg-gray-100" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-32 animate-pulse rounded-full bg-gray-100" />
          </div>
          <div className="h-3.5 w-20 animate-pulse rounded-full bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

/* Riyadh time, always — a superuser may be reviewing this from anywhere, and
 * "when did this guest walk in" is a question about the gate's clock. */
function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: EVENT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    timeZone: EVENT_TIME_ZONE,
    day: '2-digit',
    month: 'short',
  });
}
