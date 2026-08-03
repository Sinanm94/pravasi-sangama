'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertCircle,
  Building2,
  Check,
  Loader2,
  LogOut,
  RefreshCw,
  UserCheck,
  X,
} from 'lucide-react';
import type { PendingAgent, UnitAdminAgentListResponse } from '@pravasi/shared';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { Logo } from '@/components/ui/Logo';
import BrandBackdrop from '@/components/ui/BrandBackdrop';
import { apiGet, apiPost, errorMessage, errorStatus } from '@/lib/apiClient';
import { useAuthStore } from '@/store/useAuthStore';
import { springSnappy, springSurface } from '@/lib/motion';

const VIOLET = '#5E17EB';
const VIOLET_DEEP = '#37098C';

type Decision = 'APPROVED' | 'REJECTED';

/**
 * The Unit Admin screen — deliberately NOT AdminShell.
 *
 * A unit head is a non-technical volunteer with exactly one job: approve or
 * reject the agents posted to their own unit. No nav rail, no analytics, no
 * ticket ledger, no filters — every one of those is a way to get lost. One
 * screen, one purpose, buttons too big to miss.
 */
export default function UnitAdminDashboardPage() {
  return (
    <ProtectedRoute allow={['UNIT_ADMIN']}>
      <UnitAdminScreen />
    </ProtectedRoute>
  );
}

/* ================================================================== */

function UnitAdminScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.userData);
  const logout = useAuthStore((s) => s.logout);

  // Absent, not merely empty — see SessionUser: a "zone" account's session
  // carries no unit at all until a superuser assigns one.
  const hasUnit = Boolean(user?.unitId);

  const [data, setData] = useState<UnitAdminAgentListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [inFlight, setInFlight] = useState<Record<string, Decision>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!hasUnit) return;
      if (isRefresh) setRefreshing(true);
      try {
        setData(await apiGet<UnitAdminAgentListResponse>('/unit-admin/agents'));
        setLoadError(null);
      } catch (err) {
        setLoadError(errorMessage(err));
      } finally {
        setRefreshing(false);
      }
    },
    [hasUnit],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (agent: PendingAgent, decision: Decision) => {
    if (inFlight[agent.id]) return;

    setConfirming(null);
    setInFlight((p) => ({ ...p, [agent.id]: decision }));

    try {
      await apiPost(`/unit-admin/agents/${agent.id}/decision`, { decision });

      setData((prev) =>
        prev
          ? {
              ...prev,
              pending: prev.pending.filter((a) => a.id !== agent.id),
              approved:
                decision === 'APPROVED' ? [agent, ...prev.approved] : prev.approved,
            }
          : prev,
      );

      toast.success(
        decision === 'APPROVED' ? 'Agent approved' : 'Registration rejected',
        { description: `${agent.name} · ${agent.mobileNumber}` },
      );
    } catch (err) {
      // Another unit head (or a superuser override) already decided it.
      if (errorStatus(err) === 409) {
        setData((prev) =>
          prev
            ? { ...prev, pending: prev.pending.filter((a) => a.id !== agent.id) }
            : prev,
        );
        toast.info('Already decided', {
          description: 'This registration was already handled.',
        });
        return;
      }

      toast.error('Could not save that decision', {
        description: errorMessage(err),
      });
    } finally {
      setInFlight((p) => {
        const next = { ...p };
        delete next[agent.id];
        return next;
      });
    }
  };

  const signOut = async () => {
    await apiPost('/auth/logout').catch(() => {});
    logout();
    router.replace('/login');
  };

  const pendingCount = data?.pending.length ?? 0;

  return (
    <div className="relative min-h-dvh bg-gray-50 font-sans antialiased">
      <BrandBackdrop />

      {/* Masthead — white for the logo (§5.3), no nav rail: there is nothing
          else on this screen to navigate to. */}
      <header
        className="relative z-10 border-b-[3px] bg-white"
        style={{ borderBottomColor: VIOLET_DEEP }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Logo className="h-9 w-9" />
            <div className="min-w-0">
              <p
                className="truncate text-[10px] font-semibold uppercase leading-[1.4] tracking-[0.28em]"
                style={{ color: VIOLET }}
              >
                {user?.unitName ?? 'Zone Supervisor'}
              </p>
              <p className="mt-0.5 truncate text-[15px] font-semibold text-gray-900">
                {user?.unitAdminName ?? 'Unit Admin'}
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

      <main className="relative z-10 mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        {!hasUnit ? (
          <NoUnitAssigned />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-gray-900">
                  Agent Approvals
                </h1>
                <p className="mt-1.5 text-[14px] text-gray-500">
                  {data === null
                    ? 'Loading…'
                    : pendingCount === 0
                      ? 'Nothing waiting'
                      : `${pendingCount} agent${pendingCount === 1 ? '' : 's'} waiting for you`}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void load(true)}
                disabled={refreshing}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gray-100 px-4 py-2.5 text-[13px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97] disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                  strokeWidth={2.25}
                />
                Refresh
              </button>
            </div>

            {loadError && (
              <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50 p-4">
                <AlertCircle
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600"
                  strokeWidth={2.25}
                />
                <p className="text-[13px] leading-snug text-amber-800">
                  Could not refresh — {loadError}
                </p>
              </div>
            )}

            <div className="mt-6 space-y-4">
              {data === null ? (
                <PendingSkeleton />
              ) : pendingCount === 0 ? (
                <div className="flex flex-col items-center rounded-3xl bg-white px-6 py-16 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                    <UserCheck className="h-7 w-7 text-emerald-500" strokeWidth={2} />
                  </span>
                  <p className="mt-5 text-[17px] font-semibold text-gray-900">
                    All caught up
                  </p>
                  <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-gray-500">
                    No one is waiting on you right now. New registrations for
                    your unit will show up here.
                  </p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {data.pending.map((agent) => (
                    <PendingCard
                      key={agent.id}
                      agent={agent}
                      busy={inFlight[agent.id]}
                      confirming={confirming === agent.id}
                      onConfirmReject={() => setConfirming(agent.id)}
                      onCancelReject={() => setConfirming(null)}
                      onDecide={(d) => void decide(agent, d)}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>

            {data !== null && data.approved.length > 0 && (
              <div className="mt-9">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                  Already approved
                </h2>
                <div className="mt-3 overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
                  <ul className="divide-y divide-gray-900/[0.05]">
                    {data.approved.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-3 px-5 py-3.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-medium text-gray-900">
                            {a.name}
                          </p>
                          <p className="text-[12px] tabular-nums text-gray-500">
                            {a.mobileNumber}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-emerald-700">
                          Approved
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/* ================================================================== */

/**
 * A pending agent, rendered as ONE big card — not a table row. The two
 * buttons are the largest interactive elements on the page on purpose: this
 * screen exists for a volunteer who may never have used the rest of the
 * system, tapping on a phone, sometimes in bright sun.
 */
function PendingCard({
  agent,
  busy,
  confirming,
  onConfirmReject,
  onCancelReject,
  onDecide,
}: {
  agent: PendingAgent;
  busy?: Decision;
  confirming: boolean;
  onConfirmReject: () => void;
  onCancelReject: () => void;
  onDecide: (decision: Decision) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: busy ? 0.55 : 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, overflow: 'hidden' }}
      transition={springSurface}
      className="overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]"
    >
      <div className="px-6 pt-6">
        <p className="text-[19px] font-semibold leading-tight text-gray-900">
          {agent.name}
        </p>
        <p className="mt-1 text-[15px] font-medium tabular-nums text-gray-600">
          {agent.mobileNumber}
        </p>
        {agent.email && (
          <p className="mt-0.5 truncate text-[13px] text-gray-400">{agent.email}</p>
        )}
        <p className="mt-3 text-[12px] text-gray-400">
          Registered {formatWhen(agent.createdAt)}
        </p>
      </div>

      <div className="mt-5 px-4 pb-4">
        <AnimatePresence mode="wait" initial={false}>
          {confirming ? (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={springSnappy}
              className="space-y-2"
            >
              <p className="px-2 pb-1 text-center text-[13px] text-gray-500">
                Reject {agent.name}? They will need to register again.
              </p>
              <button
                type="button"
                onClick={() => onDecide('REJECTED')}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 py-5 text-[17px] font-bold text-white transition-all duration-200 hover:bg-red-700 active:scale-[0.98]"
              >
                Yes, Reject
              </button>
              <button
                type="button"
                onClick={onCancelReject}
                className="w-full rounded-2xl py-3.5 text-[15px] font-medium text-gray-500 transition-colors hover:text-gray-800"
              >
                Cancel
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={springSnappy}
              className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
            >
              {/* Massive, unmissable — this is the whole point of the screen. */}
              <button
                type="button"
                onClick={() => onDecide('APPROVED')}
                disabled={!!busy}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-5 text-[17px] font-bold text-white transition-all duration-200 hover:bg-emerald-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
              >
                {busy === 'APPROVED' ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <Check className="h-6 w-6" strokeWidth={3} />
                )}
                Approve
              </button>

              <button
                type="button"
                onClick={onConfirmReject}
                disabled={!!busy}
                aria-label={`Reject ${agent.name}`}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-red-200 bg-white py-5 text-[17px] font-bold text-red-600 transition-all duration-200 hover:bg-red-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-red-500/15 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
              >
                {busy === 'REJECTED' ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <X className="h-6 w-6" strokeWidth={3} />
                )}
                Reject
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** An unscoped ("zone") account signed in but has nothing to approve yet —
 *  see migration 005. A blank screen here would look broken; this says
 *  plainly what is actually true. */
function NoUnitAssigned() {
  return (
    <div className="flex flex-col items-center rounded-3xl bg-white px-6 py-16 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
      <span
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: `${VIOLET}12` }}
      >
        <Building2 className="h-7 w-7" strokeWidth={2} style={{ color: VIOLET }} />
      </span>
      <p className="mt-5 text-[17px] font-semibold text-gray-900">
        No unit assigned yet
      </p>
      <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-gray-500">
        Your account is not linked to a unit, so there is nothing to approve
        yet. Contact the event administrator to get set up.
      </p>
    </div>
  );
}

function PendingSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]"
        >
          <div className="h-5 w-40 animate-pulse rounded-full bg-gray-100" />
          <div className="mt-2.5 h-4 w-28 animate-pulse rounded-full bg-gray-50" />
          <div className="mt-6 grid grid-cols-2 gap-2.5">
            <div className="h-14 animate-pulse rounded-2xl bg-gray-100" />
            <div className="h-14 animate-pulse rounded-2xl bg-gray-50" />
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
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
