'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
  type ClientAnalyticsResponse,
  type ClientStatus,
} from '@pravasi/shared';
import { CHART_INK, CLIENT_STAGE_COLORS } from '@/components/charts/chartTheme';

/**
 * Charts for the client pipeline.
 *
 * FORM CHOICES, decided before colour:
 *
 *   - "how far along is each sector" is PART-TO-WHOLE across an ordered
 *     scale, so it is a STACKED bar, horizontal — sector and volunteer
 *     names are long, and a vertical axis would either truncate them or
 *     rotate them 45°.
 *   - "how many of each stage overall" is a handful of headline numbers, so
 *     it is a KPI ROW of stat tiles, not a pie. A five-slice pie of an
 *     ordered scale is the classic misuse: angle is the worst channel for
 *     comparing similar magnitudes.
 *   - conversion is ONE number, so it is a hero figure, not a one-bar chart.
 *
 * Colour comes from CLIENT_STAGE_COLORS, which was validated with the
 * palette validator — the first attempt reused the emerald/red from the
 * status badges and FAILED CVD separation at ΔE 5.6, meaning a deuteranope
 * could not tell CONFIRMED from DECLINED. See chartTheme.ts.
 */

interface Props {
  data: ClientAnalyticsResponse;
  groupBy: 'sector' | 'owner' | 'tier';
  onGroupByChange: (g: 'sector' | 'owner' | 'tier') => void;
}

const GROUP_LABELS = {
  sector: 'Sector',
  owner: 'Contact owner',
  tier: 'Tier',
} as const;

export default function ClientInsights({
  data,
  groupBy,
  onGroupByChange,
}: Props) {
  /* Recharts wants one object per bar with a key per stack segment. */
  const chartData = useMemo(
    () =>
      data.buckets.map((b) => ({
        name: b.bucket,
        PROSPECT: b.prospect,
        AWAITING_REPLY: b.awaiting,
        CONFIRMED: b.confirmed,
        TICKETED: b.ticketed,
        DECLINED: b.declined,
        total: b.total,
      })),
    [data.buckets],
  );

  const pipelineByStatus = useMemo(() => {
    const map = new Map<ClientStatus, number>();
    for (const p of data.pipeline) map.set(p.status, p.count);
    return map;
  }, [data.pipeline]);

  /* Height grows with the row count: a fixed height either crushes 12
   * sectors together or leaves white space under three. */
  const chartHeight = Math.max(220, chartData.length * 44 + 48);

  const { member, nonMember, unknown } = data.membership;
  const membershipTotal = member + nonMember + unknown;

  return (
    <div className="space-y-4">
      {/* Hero + stage KPI row */}
      <div className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
              Converted
            </p>
            <p className="mt-1 flex items-baseline gap-2">
              <span
                className="text-[44px] font-semibold leading-none tracking-[-0.02em]"
                style={{ color: CLIENT_STAGE_COLORS.CONFIRMED }}
              >
                {data.totals.conversionRate}%
              </span>
              <span className="text-[13px] text-gray-500">
                of {data.totals.total.toLocaleString()} tracked
              </span>
            </p>
            <p className="mt-1.5 text-[12px] text-gray-400">
              Confirmed or ticketed
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {CLIENT_STATUSES.map((s) => (
              <div
                key={s}
                className="rounded-2xl bg-gray-50 px-3.5 py-2.5 text-center"
              >
                <span
                  className="mx-auto mb-1.5 block h-1.5 w-8 rounded-full"
                  style={{ backgroundColor: CLIENT_STAGE_COLORS[s] }}
                />
                <p className="text-[18px] font-semibold leading-none text-gray-900">
                  {(pipelineByStatus.get(s) ?? 0).toLocaleString()}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.06em] text-gray-500">
                  {CLIENT_STATUS_LABELS[s]}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stacked pipeline by group */}
      <div className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-gray-900">
              Pipeline by {GROUP_LABELS[groupBy].toLowerCase()}
            </h3>
            <p className="mt-0.5 text-[12px] text-gray-400">
              Largest first — where the volume actually sits
            </p>
          </div>

          <div className="flex items-center gap-0.5 rounded-full bg-gray-100 p-0.5">
            {(['sector', 'owner', 'tier'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onGroupByChange(g)}
                aria-pressed={groupBy === g}
                className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-all duration-200 active:scale-[0.97] ${
                  groupBy === g
                    ? 'bg-white text-gray-900 shadow-[0_1px_3px_rgb(0,0,0,0.08)]'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {GROUP_LABELS[g]}
              </button>
            ))}
          </div>
        </div>

        {/* Legend is always present for >= 2 series, so identity is never
            carried by colour alone. */}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          {CLIENT_STATUSES.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ backgroundColor: CLIENT_STAGE_COLORS[s] }}
              />
              <span className="text-[12px] text-gray-600">
                {CLIENT_STATUS_LABELS[s]}
              </span>
            </span>
          ))}
        </div>

        {chartData.length === 0 ? (
          <p className="mt-8 pb-6 text-center text-[13px] text-gray-400">
            Nothing to chart with these filters.
          </p>
        ) : (
          <div className="mt-4 w-full" style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 0, left: 4 }}
                barCategoryGap="28%"
              >
                <CartesianGrid
                  horizontal={false}
                  stroke={CHART_INK.grid}
                  strokeWidth={1}
                />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: CHART_INK.label }}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: CHART_INK.label }}
                  width={118}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(15,40,80,0.04)' }}
                  content={<StageTooltip />}
                />
                {CLIENT_STATUSES.map((s, i) => (
                  <Bar
                    key={s}
                    dataKey={s}
                    stackId="pipeline"
                    fill={CLIENT_STAGE_COLORS[s]}
                    /* 2px surface gap between stacked segments, and a 4px
                     * rounded data-end only on the last segment so the bar
                     * terminates cleanly without rounding interior joins. */
                    stroke="#ffffff"
                    strokeWidth={2}
                    radius={
                      i === CLIENT_STATUSES.length - 1
                        ? [0, 4, 4, 0]
                        : undefined
                    }
                    maxBarSize={30}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Membership — three states, not two */}
      <div className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-gray-900">
          KCF membership
        </h3>
        <p className="mt-0.5 text-[12px] text-gray-400">
          A member is being invited back; a non-member is being sold to
        </p>

        {membershipTotal === 0 ? (
          <p className="mt-6 text-center text-[13px] text-gray-400">
            No membership recorded yet.
          </p>
        ) : (
          <>
            {/* A single 100% stacked bar — part-to-whole with three classes
                reads better as one bar than as a pie. */}
            <div className="mt-5 flex h-3 gap-[2px] overflow-hidden rounded-full">
              {(
                [
                  ['Member', member, CLIENT_STAGE_COLORS.CONFIRMED],
                  ['Not a member', nonMember, CLIENT_STAGE_COLORS.TICKETED],
                  ['Not known', unknown, CLIENT_STAGE_COLORS.PROSPECT],
                ] as const
              ).map(([label, value, color]) =>
                value === 0 ? null : (
                  <span
                    key={label}
                    title={`${label}: ${value}`}
                    style={{
                      width: `${(value / membershipTotal) * 100}%`,
                      backgroundColor: color,
                    }}
                  />
                ),
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              {(
                [
                  ['Member', member, CLIENT_STAGE_COLORS.CONFIRMED],
                  ['Not a member', nonMember, CLIENT_STAGE_COLORS.TICKETED],
                  ['Not known', unknown, CLIENT_STAGE_COLORS.PROSPECT],
                ] as const
              ).map(([label, value, color]) => (
                <div key={label}>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-[3px]"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-[12px] text-gray-600">{label}</span>
                  </span>
                  <p className="mt-1 text-[20px] font-semibold leading-none text-gray-900">
                    {value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Table view — the relief the gold contrast WARN obligates, and the
          answer for anyone who cannot read the chart at all. */}
      <div className="overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
        <div className="px-6 pt-6">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-gray-900">
            The same numbers, as a table
          </h3>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-gray-900/[0.06]">
                <th className="px-6 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                  {GROUP_LABELS[groupBy]}
                </th>
                {CLIENT_STATUSES.map((s) => (
                  <th
                    key={s}
                    className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400"
                  >
                    {CLIENT_STATUS_LABELS[s]}
                  </th>
                ))}
                <th className="px-6 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-900/[0.05]">
              {data.buckets.map((b) => (
                <tr key={b.bucket}>
                  <td className="px-6 py-2.5 text-[13px] font-medium text-gray-900">
                    {b.bucket}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-gray-600">
                    {b.prospect}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-gray-600">
                    {b.awaiting}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-gray-600">
                    {b.confirmed}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-gray-600">
                    {b.ticketed}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-gray-600">
                    {b.declined}
                  </td>
                  <td className="px-6 py-2.5 text-right text-[13px] font-semibold tabular-nums text-gray-900">
                    {b.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */

interface TooltipPayloadItem {
  dataKey?: string | number;
  value?: number;
}

function StageTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  const total = payload.reduce((n, p) => n + (p.value ?? 0), 0);

  return (
    <div className="rounded-xl border border-gray-900/[0.06] bg-white/95 px-3.5 py-2.5 shadow-[0_8px_30px_rgb(0,0,0,0.08)] backdrop-blur">
      <p className="text-[12px] font-semibold text-gray-900">{label}</p>
      <div className="mt-1.5 space-y-1">
        {payload
          .filter((p) => (p.value ?? 0) > 0)
          .map((p) => {
            const key = String(p.dataKey) as ClientStatus;
            return (
              <p key={key} className="flex items-center gap-2 text-[12px]">
                <span
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: CLIENT_STAGE_COLORS[key] }}
                />
                {/* Text wears text tokens, never the series colour — the
                    swatch beside it carries identity. */}
                <span className="text-gray-600">
                  {CLIENT_STATUS_LABELS[key]}
                </span>
                <span className="ml-auto font-medium tabular-nums text-gray-900">
                  {p.value}
                </span>
              </p>
            );
          })}
      </div>
      <p className="mt-2 border-t border-gray-100 pt-1.5 text-[12px] text-gray-500">
        Total <span className="font-semibold text-gray-900">{total}</span>
      </p>
    </div>
  );
}
