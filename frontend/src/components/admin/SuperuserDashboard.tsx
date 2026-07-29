'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import {
  AlertTriangle,
  RadioTower,
  ScanLine,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import {
  TICKET_TYPE_LABELS,
  type DashboardSnapshot,
  type LiveScanEvent,
  type RecentScanEntry,
} from '@pravasi/shared';
import {
  BAR_NAVY,
  CHART_INK,
  SCAN_RESULT_STYLES,
  TIER_COLORS,
} from '@/components/charts/chartTheme';
import { useLiveScans } from '@/lib/useLiveScans';

/** Totals and charts still poll. Only the feed moved to the socket. */
const POLL_INTERVAL_MS = 5_000;
/** §10.5 — the dashboard reconciles against REST so it cannot silently drift. */
const RECONCILE_INTERVAL_MS = 30_000;
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/* ------------------------------------------------------------------ */

export default function SuperuserDashboard({
  initialData,
}: {
  initialData?: DashboardSnapshot;
}) {
  const [data, setData] = useState<DashboardSnapshot | null>(
    initialData ?? MOCK_SNAPSHOT,
  );
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(!initialData);

  const { scans, alerts, connected, dismissAlert, reconcile } = useLiveScans();

  // Refs so the poll closure never sees a stale render.
  const inFlight = useRef<AbortController | null>(null);
  const seeded = useRef(false);
  const lastReconcile = useRef(0);

  const fetchSnapshot = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const res = await fetch(`${API_BASE}/analytics/dashboard`, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(String(res.status));

      const snapshot = (await res.json()) as DashboardSnapshot;
      setData(snapshot);
      setStale(false);

      /* The socket owns the feed once it is seeded. REST re-seeds it in
       * exactly two cases: the first load, and the 30s reconciliation — so a
       * dropped event or a missed reconnect cannot leave the list drifted
       * for the rest of the event. */
      const now = Date.now();
      const due = now - lastReconcile.current > RECONCILE_INTERVAL_MS;

      if (!seeded.current || due) {
        reconcile(snapshot.recentScans);
        seeded.current = true;
        lastReconcile.current = now;
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      /* Keep the last good snapshot on screen. A blanked ops dashboard is
       * worse than a visibly stale one — staff read it at a glance and need
       * to know the numbers are old, not that everything stopped. */
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, [reconcile]);

  useEffect(() => {
    // Seed the feed from whatever we already have so the panel is never
    // empty on first paint — including the standalone fixture case.
    if (!seeded.current && data) {
      reconcile(data.recentScans);
      seeded.current = true;
      lastReconcile.current = Date.now();
    }

    void fetchSnapshot();

    const tick = () => {
      // Don't poll a backgrounded tab; resume on return.
      if (document.visibilityState === 'visible') void fetchSnapshot();
    };

    const timer = setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      inFlight.current?.abort();
    };
    // `data` is read only for the one-time seed above; re-running on every
    // snapshot would tear down and rebuild the poll loop every 5 seconds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSnapshot, reconcile]);

  const divisionData = useMemo(
    () =>
      (data?.divisionPerformance ?? []).map((d) => ({
        name: d.divisionCode,
        fullName: d.divisionName,
        tickets: d.ticketsSold,
        guests: d.guestsExpected,
      })),
    [data],
  );

  const tierData = useMemo(
    () =>
      (data?.ticketTypeBreakdown ?? []).map((t) => ({
        name: TICKET_TYPE_LABELS[t.ticketType],
        tier: t.ticketType,
        value: t.ticketCount,
        seats: t.seatCount,
      })),
    [data],
  );

  const tierTotal = useMemo(
    () => tierData.reduce((sum, t) => sum + t.value, 0),
    [tierData],
  );

  if (loading && !data) return <DashboardSkeleton />;
  if (!data) return null;

  return (
    <div className="min-h-dvh bg-gray-50 px-5 py-8 font-sans antialiased sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-7xl">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-gray-900">
              System Overview
            </h1>
            <p className="mt-1 text-[13px] text-gray-500">
              Updated {formatTime(data.generatedAt)} · {data.timezone}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {stale && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-700 ring-1 ring-amber-600/15">
                <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
                Reconnecting
              </span>
            )}
            {/* The socket carries the feed, so its state is what "Live"
                actually means — not the REST poll. */}
            <LivePulse stale={stale || !connected} />
          </div>
        </header>

        {/* Key metrics */}
        <section className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Ticket}
            label="Total Tickets Issued"
            value={data.totals.totalTickets}
          />
          <StatCard
            icon={Users}
            label="Total Guests Expected"
            value={data.totals.totalGuestsExpected}
            hint="Guest QR codes on active tickets"
          />
          <StatCard
            icon={ScanLine}
            label="Scanned Today"
            value={data.totals.totalScannedToday}
            hint={`Since midnight · ${data.timezone}`}
          />
          <StatCard
            icon={RadioTower}
            label="Active Gates"
            value={data.totals.activeGates}
            hint="Scanned in the last 5 minutes"
            emphasis={data.totals.activeGates > 0}
          />
        </section>

        {/* Charts */}
        <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5">
          {/* Sales by division — 60% */}
          <Card className="lg:col-span-3">
            <CardHeader
              title="Sales by Division"
              subtitle="Active tickets issued"
            />

            {divisionData.length === 0 ? (
              <EmptyPlot message="No tickets issued yet" />
            ) : (
              <div className="mt-6 h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={divisionData}
                    margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
                    barCategoryGap="28%"
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke={CHART_INK.grid}
                      strokeWidth={1}
                    />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: CHART_INK.label }}
                      dy={8}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: CHART_INK.label }}
                      allowDecimals={false}
                      width={52}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(15,40,80,0.04)' }}
                      content={<DivisionTooltip />}
                    />
                    {/* 4px rounded data-end, anchored to the baseline */}
                    <Bar
                      dataKey="tickets"
                      fill={BAR_NAVY}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={56}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Ticket type breakdown — 40% */}
          <Card className="lg:col-span-2">
            <CardHeader
              title="Ticket Types"
              subtitle="Share of tickets issued"
            />

            {tierTotal === 0 ? (
              <EmptyPlot message="No tickets issued yet" />
            ) : (
              <>
                <div className="relative mt-6 h-[210px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={tierData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={62}
                        outerRadius={92}
                        paddingAngle={2} // 2px surface gap between fills
                        stroke="#fff"
                        strokeWidth={2}
                        startAngle={90}
                        endAngle={-270}
                      >
                        {tierData.map((entry) => (
                          <Cell
                            key={entry.tier}
                            fill={TIER_COLORS[entry.tier]}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<TierTooltip total={tierTotal} />} />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Hero number in the hole */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-gray-900">
                      {formatNumber(tierTotal)}
                    </span>
                    <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-400">
                      Tickets
                    </span>
                  </div>
                </div>

                {/* Legend doubles as the value table — identity is never
                    carried by colour alone. */}
                <ul className="mt-5 space-y-2.5">
                  {tierData.map((entry) => (
                    <li
                      key={entry.tier}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: TIER_COLORS[entry.tier] }}
                        />
                        <span className="truncate text-[13px] font-medium text-gray-700">
                          {entry.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-[13px] tabular-nums text-gray-500">
                        {formatNumber(entry.value)}
                        <span className="ml-1.5 text-gray-400">
                          {percent(entry.value, tierTotal)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </section>

        {/* Live feed — socket-fed, not polled */}
        <section className="mt-5">
          <Card>
            <CardHeader
              title="Live Gate Feed"
              subtitle={
                connected
                  ? 'Streaming — newest first'
                  : 'Socket disconnected · showing last snapshot'
              }
            />
            <LiveFeed scans={scans} />
          </Card>
        </section>
      </div>

      <ToastStack alerts={alerts} onDismiss={dismissAlert} />
    </div>
  );
}

/* ================================================================== */
/* Pieces                                                              */
/* ================================================================== */

function LivePulse({ stale }: { stale: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 ring-1 ring-gray-900/[0.06]">
      <span className="relative flex h-2 w-2">
        {!stale && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            stale ? 'bg-gray-300' : 'bg-emerald-500'
          }`}
        />
      </span>
      <span
        className={`text-[12px] font-semibold ${
          stale ? 'text-gray-400' : 'text-emerald-700'
        }`}
      >
        {stale ? 'Paused' : 'Live'}
      </span>
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  emphasis,
}: {
  icon: typeof Ticket;
  label: string;
  value: number;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-gray-500">{label}</p>
        <Icon
          className={`h-4 w-4 shrink-0 ${
            emphasis ? 'text-emerald-500' : 'text-gray-300'
          }`}
          strokeWidth={2.25}
        />
      </div>

      <p className="mt-4 text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-gray-900">
        {formatNumber(value)}
      </p>

      {hint && <p className="mt-2.5 text-[12px] text-gray-400">{hint}</p>}
    </div>
  );
}

function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04] ${className}`}
    >
      {children}
    </div>
  );
}

function CardHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-gray-900">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-0.5 text-[12px] text-gray-400">{subtitle}</p>
      )}
    </div>
  );
}

function EmptyPlot({ message }: { message: string }) {
  return (
    <div className="mt-6 flex h-[210px] items-center justify-center rounded-2xl bg-gray-50/70">
      <p className="text-[13px] text-gray-400">{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

const TOAST_DURATION_MS = 3000;

function ToastStack({
  alerts,
  onDismiss,
}: {
  alerts: LiveScanEvent[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[min(22rem,calc(100vw-3rem))] flex-col-reverse gap-2.5"
    >
      {alerts.map((alert) => (
        <Toast key={alert.id} alert={alert} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({
  alert,
  onDismiss,
}: {
  alert: LiveScanEvent;
  onDismiss: (id: string) => void;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const timer = setTimeout(() => onDismiss(alert.id), TOAST_DURATION_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [alert.id, onDismiss]);

  const tone = TOAST_TONES[alert.alertType] ?? TOAST_TONES.INVALID;
  const where = alert.gateLabel ?? alert.unitName ?? 'an unknown gate';

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-[0_12px_40px_rgb(0,0,0,0.10)] backdrop-blur-xl transition-all duration-300 ${
        tone.className
      } ${shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}
    >
      <AlertTriangle
        className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${tone.icon}`}
        strokeWidth={2.5}
      />

      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-semibold ${tone.title}`}>
          {tone.label}
        </p>
        <p className={`mt-0.5 text-[12px] leading-snug ${tone.body}`}>
          {tone.detail(where)}
          {alert.ticketNumber && (
            <span className="tabular-nums"> · {alert.ticketNumber}</span>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(alert.id)}
        aria-label="Dismiss"
        className={`shrink-0 rounded-full p-1 transition-colors ${tone.body} hover:bg-black/5`}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

const TOAST_TONES: Record<
  string,
  {
    label: string;
    detail: (where: string) => string;
    className: string;
    icon: string;
    title: string;
    body: string;
  }
> = {
  DUPLICATE: {
    label: 'Duplicate scan',
    detail: (where) => `Rejected at ${where}`,
    className: 'border-amber-200/70 bg-amber-50/90',
    icon: 'text-amber-600',
    title: 'text-amber-900',
    body: 'text-amber-700',
  },
  /* Louder than a live duplicate on purpose: this one was NOT stopped. Two
   * offline devices each admitted someone on the same code (§10.4), and both
   * people are already inside. */
  POST_SYNC_DUPLICATE: {
    label: 'Post-sync duplicate — entry already occurred',
    detail: (where) => `Offline double-admit involving ${where}`,
    className: 'border-red-200/70 bg-red-50/90',
    icon: 'text-red-600',
    title: 'text-red-900',
    body: 'text-red-700',
  },
  INVALID: {
    label: 'Invalid code',
    detail: (where) => `Rejected at ${where}`,
    className: 'border-red-200/70 bg-red-50/90',
    icon: 'text-red-600',
    title: 'text-red-900',
    body: 'text-red-700',
  },
};

/* ------------------------------------------------------------------ */
/* Live feed                                                           */
/* ------------------------------------------------------------------ */

function LiveFeed({ scans }: { scans: RecentScanEntry[] }) {
  if (scans.length === 0) {
    return (
      <div className="mt-6 flex h-32 items-center justify-center rounded-2xl bg-gray-50/70">
        <p className="text-[13px] text-gray-400">No scans recorded yet</p>
      </div>
    );
  }

  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse">
        <thead>
          <tr className="border-b border-gray-100">
            {['Time', 'Agent', 'Gate / Unit', 'Ticket', 'Result'].map(
              (heading, i) => (
                <th
                  key={heading}
                  scope="col"
                  className={`pb-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400 ${
                    i === 4 ? 'text-right' : 'text-left'
                  }`}
                >
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>

        <tbody>
          {scans.map((scan) => {
            const style = SCAN_RESULT_STYLES[scan.result];
            return (
              <tr
                key={scan.id}
                className="border-b border-gray-50 last:border-0"
              >
                <td className="py-3 pr-4 text-[12px] tabular-nums text-gray-500">
                  {formatTime(scan.scannedAt, true)}
                </td>
                <td className="py-3 pr-4 text-[13px] font-medium text-gray-900">
                  {scan.agentName ?? '—'}
                </td>
                <td className="py-3 pr-4 text-[12px] text-gray-500">
                  {scan.gateLabel && (
                    <span className="mr-1.5 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-600">
                      {scan.gateLabel}
                    </span>
                  )}
                  {scan.unitName ?? '—'}
                  {scan.unitSector && (
                    <span className="text-gray-400"> · {scan.unitSector}</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-[12px] tabular-nums text-gray-500">
                  {scan.ticketNumber ?? '—'}
                </td>
                <td className="py-3 text-right">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${style.className}`}
                  >
                    {style.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltips                                                            */
/* ------------------------------------------------------------------ */

interface TooltipPayload<T> {
  active?: boolean;
  payload?: Array<{ payload: T }>;
}

function TooltipShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/90 px-3.5 py-2.5 shadow-[0_8px_30px_rgb(0,0,0,0.08)] ring-1 ring-gray-900/[0.06] backdrop-blur-xl">
      {children}
    </div>
  );
}

function DivisionTooltip({
  active,
  payload,
}: TooltipPayload<{ fullName: string; tickets: number; guests: number }>) {
  const row = active ? payload?.[0]?.payload : null;
  if (!row) return null;

  return (
    <TooltipShell>
      <p className="text-[12px] font-semibold text-gray-900">{row.fullName}</p>
      <p className="mt-1 text-[12px] tabular-nums text-gray-500">
        {formatNumber(row.tickets)} tickets · {formatNumber(row.guests)} guests
      </p>
    </TooltipShell>
  );
}

function TierTooltip({
  active,
  payload,
  total,
}: TooltipPayload<{ name: string; value: number; seats: number }> & {
  total: number;
}) {
  const row = active ? payload?.[0]?.payload : null;
  if (!row) return null;

  return (
    <TooltipShell>
      <p className="text-[12px] font-semibold text-gray-900">{row.name}</p>
      <p className="mt-1 text-[12px] tabular-nums text-gray-500">
        {formatNumber(row.value)} tickets ({percent(row.value, total)}) ·{' '}
        {formatNumber(row.seats)} seats
      </p>
    </TooltipShell>
  );
}

/* ------------------------------------------------------------------ */

function DashboardSkeleton() {
  return (
    <div className="min-h-dvh bg-gray-50 px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-7xl animate-pulse">
        <div className="h-8 w-56 rounded-lg bg-gray-200" />
        <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 rounded-3xl bg-white" />
          ))}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="h-[380px] rounded-3xl bg-white lg:col-span-3" />
          <div className="h-[380px] rounded-3xl bg-white lg:col-span-2" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const numberFormat = new Intl.NumberFormat('en-US');
const formatNumber = (n: number) => numberFormat.format(n);

const percent = (value: number, total: number) =>
  total === 0 ? '0%' : `${Math.round((value / total) * 100)}%`;

function formatTime(iso: string, withSeconds = false): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* Standalone fixture — renders without a backend (§6.3)               */
/* ------------------------------------------------------------------ */

const MOCK_SNAPSHOT: DashboardSnapshot = {
  generatedAt: new Date().toISOString(),
  timezone: 'Asia/Riyadh',
  totals: {
    totalTickets: 1284,
    totalGuestsExpected: 3906,
    totalScannedToday: 1147,
    activeGates: 6,
  },
  ticketTypeBreakdown: [
    { ticketType: 'NORMAL', ticketCount: 742, seatCount: 742 },
    { ticketType: 'VIP', ticketCount: 318, seatCount: 1272 },
    { ticketType: 'VVIP', ticketCount: 154, seatCount: 616 },
    { ticketType: 'SVIP', ticketCount: 70, seatCount: 280 },
  ],
  divisionPerformance: [
    {
      divisionId: '1',
      divisionName: 'Riyadh',
      divisionCode: 'RIYADH',
      ticketsSold: 512,
      guestsExpected: 1604,
    },
    {
      divisionId: '2',
      divisionName: 'Jeddah',
      divisionCode: 'JEDDAH',
      ticketsSold: 388,
      guestsExpected: 1180,
    },
    {
      divisionId: '3',
      divisionName: 'Dammam',
      divisionCode: 'DAMMAM',
      ticketsSold: 241,
      guestsExpected: 702,
    },
    {
      divisionId: '4',
      divisionName: 'Al Khobar',
      divisionCode: 'KHOBAR',
      ticketsSold: 143,
      guestsExpected: 420,
    },
  ],
  recentScans: [
    {
      id: '9001',
      scannedAt: new Date(Date.now() - 12_000).toISOString(),
      result: 'ADMITTED',
      agentName: 'Rajesh Nair',
      unitName: '5 Building',
      unitSector: 'BATHA',
      gateLabel: 'GATE-2',
      ticketNumber: 'TKT-9C4E1A7B02',
      ticketType: 'SVIP',
    },
    {
      id: '9000',
      scannedAt: new Date(Date.now() - 48_000).toISOString(),
      result: 'DUPLICATE',
      agentName: 'Suma Bhat',
      unitName: '5 Building',
      unitSector: 'BATHA',
      gateLabel: 'GATE-1',
      ticketNumber: 'TKT-4B71E0C339',
      ticketType: 'VIP',
    },
    {
      id: '8999',
      scannedAt: new Date(Date.now() - 96_000).toISOString(),
      result: 'LOCATION_INFO',
      agentName: 'Praveen Shetty',
      unitName: 'Deera',
      unitSector: 'BATHA',
      gateLabel: 'GATE-3',
      ticketNumber: 'TKT-1F80A2D5C7',
      ticketType: 'VVIP',
    },
    {
      id: '8998',
      scannedAt: new Date(Date.now() - 145_000).toISOString(),
      result: 'UNKNOWN_CODE',
      agentName: 'Rajesh Nair',
      unitName: '5 Building',
      unitSector: 'BATHA',
      gateLabel: 'GATE-2',
      ticketNumber: null,
      ticketType: null,
    },
  ],
};
