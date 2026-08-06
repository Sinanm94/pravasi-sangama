'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertCircle,
  Building2,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RotateCcw,
  LogOut,
  RefreshCw,
  Search,
  Ticket,
  UserCheck,
  X,
} from 'lucide-react';
import {
  TICKET_TYPE_LABELS,
  type AdminTicketRow,
  type PendingAgent,
  type AgentPasswordResetResponse,
  type UnitAdminAgentListResponse,
  type UnitAdminInvitePinResponse,
  type UnitAdminTicketListResponse,
} from '@pravasi/shared';
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
 * A unit head's primary job is approving or rejecting the agents posted to
 * their own scope — buttons too big to miss, no nav rail, no analytics, no
 * CRUD. The Ticket Sales table below it is read-only and scoped the same
 * way (§3.3's OR-scope), so it adds visibility without adding navigation:
 * still one page, still nothing else to get lost in.
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

  /* Scope is NOT `user.unitId`.
   *
   * A Zone Supervisor covers its units through supervisor_unit_assignments
   * and carries `unitId: null` (§3.3) — gating on the direct posting alone
   * made all three zone accounts render "No unit assigned yet" while the
   * backend was happily resolving ten units each for them.
   *
   * The authority is the server: /unit-admin/invite-pin returns exactly the
   * units in scope, resolved by the same OR-predicate as every other query
   * in that module. Zero rows from THAT is what "unscoped" means. Until it
   * answers we do not know, so we render the dashboard rather than
   * flashing an empty-state that may be wrong. */
  const [invitePins, setInvitePins] =
    useState<UnitAdminInvitePinResponse | null>(null);
  const [scopeResolved, setScopeResolved] = useState(false);

  const hasUnit = !scopeResolved || (invitePins?.units.length ?? 0) > 0;

  const [data, setData] = useState<UnitAdminAgentListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [inFlight, setInFlight] = useState<Record<string, Decision>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
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
    [],
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

  /* --- Agent invite PIN — the number this unit head reads out (§3.2) -- */

  /* Hidden by default. This screen is open on a phone at a registration
   * desk all day; the PIN should be shown when it is being handed over, not
   * left facing the queue. */
  const [pinRevealed, setPinRevealed] = useState(false);

  useEffect(() => {
    void apiGet<UnitAdminInvitePinResponse>('/unit-admin/invite-pin')
      .then(setInvitePins)
      // Non-fatal for the PIN card itself, but it must still resolve scope —
      // otherwise a failed call would leave the dashboard permanently
      // assuming scope it may not have.
      .catch(() => setInvitePins(null))
      .finally(() => setScopeResolved(true));
  }, []);

  /* --- Ticket Sales — read-only ledger, scoped server-side (§3.3) ---- */

  const [tickets, setTickets] = useState<UnitAdminTicketListResponse | null>(null);
  const [ticketLoadError, setTicketLoadError] = useState<string | null>(null);
  const [ticketRefreshing, setTicketRefreshing] = useState(false);
  const [ticketSearch, setTicketSearch] = useState('');
  const [committedTicketSearch, setCommittedTicketSearch] = useState('');
  const [ticketAgentId, setTicketAgentId] = useState('');

  /* One request per pause in typing, not per keystroke — same reasoning as
   * the superuser ledger (/admin/tickets): the search hits an ILIKE scan. */
  useEffect(() => {
    const id = setTimeout(() => setCommittedTicketSearch(ticketSearch.trim()), 300);
    return () => clearTimeout(id);
  }, [ticketSearch]);

  const loadTickets = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setTicketRefreshing(true);

      const params = new URLSearchParams();
      if (ticketAgentId) params.set('agent_id', ticketAgentId);
      if (committedTicketSearch) params.set('search', committedTicketSearch);

      try {
        const qs = params.toString();
        setTickets(
          await apiGet<UnitAdminTicketListResponse>(
            `/unit-admin/tickets${qs ? `?${qs}` : ''}`,
          ),
        );
        setTicketLoadError(null);
      } catch (err) {
        setTicketLoadError(errorMessage(err));
      } finally {
        setTicketRefreshing(false);
      }
    },
    [ticketAgentId, committedTicketSearch],
  );

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  /* Filter options come from the agent list already loaded above — every
   * agent who could have sold a ticket is, by definition, approved and in
   * this admin's own scope, so there is no second endpoint to fetch. */
  const agentOptions = useMemo(() => data?.approved ?? [], [data]);

  const ticketFiltered = Boolean(ticketAgentId) || committedTicketSearch.length > 0;
  const ticketTotals = tickets?.totals;

  /* --- Agent password reset (§3.3) ---------------------------------- *
   * Replaces self-service email reset, which had to go once agents began
   * sharing email addresses. Rotate-and-reveal: the new password is shown
   * once, here, and only its hash is stored. */
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetResult, setResetResult] =
    useState<AgentPasswordResetResponse | null>(null);

  const resetPassword = async (agent: PendingAgent) => {
    if (resetting) return;
    setResetting(agent.id);
    try {
      const result = await apiPost<AgentPasswordResetResponse>(
        `/unit-admin/agents/${agent.id}/reset-password`,
      );
      setResetResult(result);
    } catch (err) {
      toast.error('Could not reset that password', {
        description: errorMessage(err),
      });
    } finally {
      setResetting(null);
    }
  };

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
            {resetResult && (
              <ResetResultCard
                result={resetResult}
                onDismiss={() => setResetResult(null)}
              />
            )}

            <InvitePinCard
              data={invitePins}
              revealed={pinRevealed}
              onToggle={() => setPinRevealed((v) => !v)}
            />

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
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void resetPassword(a)}
                            disabled={resetting === a.id}
                            className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-[11px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97] disabled:opacity-60"
                          >
                            {resetting === a.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.25} />
                            )}
                            Reset password
                          </button>
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-emerald-700">
                            Approved
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <TicketSalesSection
              tickets={tickets}
              totals={ticketTotals}
              loadError={ticketLoadError}
              refreshing={ticketRefreshing}
              onRefresh={() => void loadTickets(true)}
              search={ticketSearch}
              onSearchChange={setTicketSearch}
              filtered={ticketFiltered}
              agentId={ticketAgentId}
              onAgentChange={setTicketAgentId}
              agentOptions={agentOptions}
              onClearFilters={() => {
                setTicketSearch('');
                setTicketAgentId('');
              }}
            />
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

/* ================================================================== */
/* A freshly reset agent password — shown once                          */
/* ================================================================== */

/**
 * Deliberately loud, deliberately dismissible, and deliberately the ONLY
 * time this string is ever displayed: the server stores a bcrypt hash and
 * cannot show it again. If the unit head closes this before writing it
 * down, the fix is to reset again — which is safe, since the agent could
 * not have used it yet.
 *
 * Not persisted into the agent list. Leaving a password sitting in a row on
 * a dashboard that stays open at a registration desk all day is exactly the
 * exposure this flow is trying to avoid.
 */
function ResetResultCard({
  result,
  onDismiss,
}: {
  result: AgentPasswordResetResponse;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSurface}
      className="mb-6 rounded-3xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: VIOLET }}
          >
            New password for {result.agentName}
          </p>
          <p className="mt-0.5 text-[12px] tabular-nums text-gray-500">
            {result.mobileNumber}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-full bg-gray-100 p-2 text-gray-500 transition-colors hover:bg-gray-200/80 hover:text-gray-900 active:scale-95"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      </div>

      <p
        className="mt-4 text-center font-mono text-[28px] font-bold tracking-[0.08em]"
        style={{ color: VIOLET_DEEP }}
      >
        {result.temporaryPassword}
      </p>

      <p className="mt-3 text-center text-[12px] leading-snug text-gray-500">
        Read this out to {result.agentName} now — it is shown once and cannot
        be looked up again. Resetting again is safe if you lose it.
      </p>
    </motion.div>
  );
}

/* ================================================================== */
/* Agent invite PIN (§3.2)                                              */
/* ================================================================== */

/**
 * The number a unit head reads out to every agent they recruit, on their own
 * screen instead of in an administrator's spreadsheet.
 *
 * Concealed until tapped: this dashboard sits open on a phone at a
 * registration desk, and a 4-digit code facing a queue all afternoon is how
 * it ends up somewhere it was not meant to go. Revealing is one tap, and the
 * value is large and monospaced once shown — it is going to be read aloud
 * across a noisy hall.
 *
 * A zone supervisor covers several units, so this renders a list. Each row
 * distinguishes three states, because they need three different fixes:
 * a PIN to read, a unit whose PIN exists but was never recorded readably
 * (re-run db:provision-units), and a unit with no PIN configured at all.
 */
function InvitePinCard({
  data,
  revealed,
  onToggle,
}: {
  data: UnitAdminInvitePinResponse | null;
  revealed: boolean;
  onToggle: () => void;
}) {
  if (!data || data.units.length === 0) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <KeyRound className="h-4 w-4 shrink-0" style={{ color: VIOLET }} strokeWidth={2.25} />
          <div className="min-w-0">
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: VIOLET }}
            >
              Agent invite PIN
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-gray-500">
              Give this to agents registering at your unit
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2 text-[12px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97]"
        >
          {revealed ? (
            <>
              <EyeOff className="h-3.5 w-3.5" strokeWidth={2.25} />
              Hide
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" strokeWidth={2.25} />
              Show
            </>
          )}
        </button>
      </div>

      <ul className="mt-4 divide-y divide-gray-900/[0.05] border-t border-gray-900/[0.05]">
        {data.units.map((u) => (
          <li
            key={u.unitCode}
            className="flex items-center justify-between gap-4 px-6 py-3.5"
          >
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium text-gray-900">
                {u.unitName}
              </p>
              <p className="text-[11px] uppercase tracking-[0.08em] text-gray-400">
                {u.sector ? `${u.sector} · ` : ''}
                {u.unitCode}
              </p>
            </div>

            {!u.hasPin ? (
              <span className="shrink-0 text-[12px] font-medium text-amber-700">
                No PIN set
              </span>
            ) : u.invitePin === null ? (
              /* A working PIN exists, but nothing readable was stored for
                 it — migration 011 explains when that happens. Saying so is
                 better than a blank space that reads as "broken". */
              <span className="shrink-0 text-[12px] font-medium text-gray-400">
                Not recorded
              </span>
            ) : revealed ? (
              <span
                className="shrink-0 font-mono text-[22px] font-bold tabular-nums tracking-[0.18em]"
                style={{ color: VIOLET_DEEP }}
              >
                {u.invitePin}
              </span>
            ) : (
              <span
                className="shrink-0 font-mono text-[22px] font-bold tracking-[0.18em] text-gray-300"
                aria-label="PIN hidden"
              >
                ••••
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ================================================================== */
/* Ticket Sales — read-only, scoped to this admin's own unit(s)         */
/* ================================================================== */

function TicketSalesSection({
  tickets,
  totals,
  loadError,
  refreshing,
  onRefresh,
  search,
  onSearchChange,
  filtered,
  agentId,
  onAgentChange,
  agentOptions,
  onClearFilters,
}: {
  tickets: UnitAdminTicketListResponse | null;
  totals: { tickets: number; seats: number; children: number } | undefined;
  loadError: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  search: string;
  onSearchChange: (v: string) => void;
  filtered: boolean;
  agentId: string;
  onAgentChange: (v: string) => void;
  agentOptions: PendingAgent[];
  onClearFilters: () => void;
}) {
  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.02em] text-gray-900">
            Ticket Sales
          </h2>
          <p className="mt-1 text-[13px] text-gray-500">
            {tickets === null
              ? 'Loading…'
              : filtered
                ? `${(totals?.tickets ?? 0).toLocaleString()} matching ticket${totals?.tickets === 1 ? '' : 's'}`
                : `${(totals?.tickets ?? 0).toLocaleString()} ticket${totals?.tickets === 1 ? '' : 's'} sold in your unit`}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
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
            Could not load ticket sales — {loadError}
          </p>
        </div>
      )}

      {/* Filters — deliberately just the two the volunteer actually needs.
          No division/unit selects here: the scope IS the unit(s) this
          account covers, not something to narrow further (§3.3). */}
      <div className="mt-4 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="ticket-search"
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
                id="ticket-search"
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Buyer name, mobile or ticket no."
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
              />
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-[13px] font-medium text-gray-700">
              Agent
            </span>
            <div className="relative">
              <select
                value={agentId}
                onChange={(e) => onAgentChange(e.target.value)}
                className="w-full cursor-pointer appearance-none rounded-xl border border-gray-200 bg-white py-3 pl-4 pr-11 text-[15px] text-gray-900 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
              >
                <option value="">All agents</option>
                {agentOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.mobileNumber}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-400"
                strokeWidth={2.25}
              />
            </div>
          </label>
        </div>

        {filtered && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
            <p className="text-[12px] text-gray-400">
              The count above reflects these filters.
            </p>
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2 text-[12px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97]"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              Clear filters
            </button>
          </div>
        )}
      </div>

      {tickets?.truncated && (
        <p className="mt-3 px-1 text-[12px] leading-relaxed text-amber-700">
          Showing the {tickets.limit.toLocaleString()} most recent of{' '}
          {tickets.totals.tickets.toLocaleString()} matching tickets. The count
          above includes all of them — narrow the filters to see the rest.
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
        {tickets === null ? (
          <TicketSkeleton />
        ) : tickets.tickets.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Ticket className="h-7 w-7 text-gray-400" strokeWidth={2} />
            </span>
            <p className="mt-5 text-[17px] font-semibold text-gray-900">
              {filtered ? 'No matching tickets' : 'No tickets sold yet'}
            </p>
            <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-gray-500">
              {filtered
                ? 'Nothing matches these filters. Clear them to see every ticket sold in your unit.'
                : 'Tickets appear here as your agents issue them.'}
            </p>
          </div>
        ) : (
          // Vertical scroll caps the card's height instead of letting a
          // busy unit's ledger push the whole page down; horizontal scroll
          // covers narrow phones. Header stays visible via `sticky`.
          <div className="max-h-[28rem] overflow-y-auto overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-gray-900/[0.06]">
                  <TicketTh>Ticket</TicketTh>
                  <TicketTh>Buyer</TicketTh>
                  <TicketTh>Agent</TicketTh>
                  <TicketTh>Unit</TicketTh>
                  <TicketTh>Status</TicketTh>
                  <TicketTh numeric>Issued</TicketTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-900/[0.05]">
                {tickets.tickets.map((t) => (
                  <TicketRow key={t.id} ticket={t} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TicketRow({ ticket }: { ticket: AdminTicketRow }) {
  const revoked = ticket.status === 'REVOKED';

  return (
    <tr
      className={`align-middle transition-colors hover:bg-gray-50/70 ${
        revoked ? 'opacity-55' : ''
      }`}
    >
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium tabular-nums text-gray-900">
            {ticket.ticketNumber}
          </p>
          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-500">
            {TICKET_TYPE_LABELS[ticket.ticketType]}
          </span>
        </div>
      </td>

      <td className="px-5 py-3.5">
        <p className="truncate text-[14px] font-medium text-gray-900">
          {ticket.purchaserName}
        </p>
        <p className="mt-0.5 text-[12px] tabular-nums text-gray-500">
          {ticket.purchaserMobile}
        </p>
      </td>

      <td className="px-5 py-3.5">
        <p className="truncate text-[13px] font-medium text-gray-900">
          {ticket.agentName}
        </p>
      </td>

      <td className="px-5 py-3.5">
        <p className="truncate text-[13px] font-medium text-gray-900">
          {ticket.unitName}
        </p>
        <p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-gray-400">
          {ticket.unitCode}
        </p>
      </td>

      <td className="px-5 py-3.5">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] ${
            revoked
              ? 'bg-red-50 text-red-600'
              : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {revoked ? 'Revoked' : 'Active'}
        </span>
      </td>

      <td className="px-5 py-3.5 text-right text-[13px] tabular-nums text-gray-500">
        {formatWhen(ticket.createdAt)}
      </td>
    </tr>
  );
}

function TicketTh({
  children,
  numeric,
}: {
  children: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <th
      scope="col"
      className={`sticky top-0 z-10 bg-white px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 ${
        numeric ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function TicketSkeleton() {
  return (
    <div className="divide-y divide-gray-900/[0.05]">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-6 px-5 py-3.5">
          <div className="w-28 space-y-2">
            <div className="h-3.5 w-20 animate-pulse rounded-full bg-gray-100" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-36 animate-pulse rounded-full bg-gray-100" />
            <div className="h-3 w-24 animate-pulse rounded-full bg-gray-50" />
          </div>
          <div className="h-6 w-16 animate-pulse rounded-full bg-gray-100" />
        </div>
      ))}
    </div>
  );
}
