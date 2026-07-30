'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  Loader2,
  RefreshCw,
  UserCheck,
  X,
} from 'lucide-react';
import type { PendingAgent } from '@pravasi/shared';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AdminShell, {
  Card,
  EmptyState,
  RowSkeleton,
} from '@/components/admin/AdminShell';
import { apiGet, apiPost, errorMessage, errorStatus } from '@/lib/apiClient';
import { springSnappy, springSurface } from '@/lib/motion';

type Decision = 'APPROVED' | 'REJECTED';

export default function ApprovalsPage() {
  return (
    <ProtectedRoute allow={['SUPERUSER']}>
      <ApprovalsScreen />
    </ProtectedRoute>
  );
}

/* ================================================================== */

function ApprovalsScreen() {
  const [agents, setAgents] = useState<PendingAgent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /** id → the decision currently in flight for that row. */
  const [inFlight, setInFlight] = useState<Record<string, Decision>>({});
  /** id of the row showing a "confirm reject?" second tap. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await apiGet<{ agents: PendingAgent[] }>(
        '/admin/agents?status=PENDING',
      );
      setAgents(data.agents);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
      // Keep whatever is on screen. A blanked queue is worse than a stale one.
      if (agents === null) setAgents([]);
    } finally {
      setRefreshing(false);
    }
    // `agents` is read only to decide the empty fallback; re-creating this
    // callback on every list change would restart the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (agent: PendingAgent, decision: Decision) => {
    if (inFlight[agent.id]) return;

    setConfirming(null);
    setInFlight((p) => ({ ...p, [agent.id]: decision }));

    try {
      // `decision`, not `status` — and the schema is .strict(), so the wrong
      // key is a 400 rather than a silently ignored field.
      await apiPost(`/admin/agents/${agent.id}/decision`, { decision });

      setAgents((prev) => (prev ?? []).filter((a) => a.id !== agent.id));

      toast.success(
        decision === 'APPROVED' ? 'Agent approved' : 'Registration rejected',
        { description: `${agent.name} · ${agent.mobileNumber}` },
      );
    } catch (err) {
      /* 409 means another superuser already decided it. The row is genuinely
       * gone, so removing it is correct — reverting would put back something
       * that no longer exists and invite a second pointless click. */
      if (errorStatus(err) === 409) {
        setAgents((prev) => (prev ?? []).filter((a) => a.id !== agent.id));
        toast.info('Already decided', {
          description: 'Another administrator handled this registration.',
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

  const count = agents?.length ?? 0;

  return (
    <AdminShell
      title="Agent Approvals"
      subtitle={
        agents === null
          ? 'Loading pending registrations…'
          : count === 0
            ? 'Nothing waiting'
            : `${count} registration${count === 1 ? '' : 's'} awaiting a decision`
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
            Could not refresh the queue — {loadError}
          </p>
        </div>
      )}

      <Card>
        {agents === null ? (
          <RowSkeleton rows={3} />
        ) : count === 0 ? (
          <EmptyState
            icon={UserCheck}
            title="No pending agents"
            body="Self-registered agents appear here for approval. Until one is approved they cannot sign in or issue tickets."
          />
        ) : (
          <ul className="divide-y divide-gray-900/[0.05]">
            <AnimatePresence initial={false}>
              {agents.map((agent) => (
                <AgentRow
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
          </ul>
        )}
      </Card>

      {count > 0 && (
        <p className="mt-4 px-1 text-[12px] leading-relaxed text-gray-400">
          Approving an agent lets them sign in at their unit and issue tickets
          immediately. Rejecting is final — they would need to register again.
        </p>
      )}
    </AdminShell>
  );
}

/* ================================================================== */

function AgentRow({
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
    <motion.li
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: busy ? 0.55 : 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, overflow: 'hidden' }}
      transition={springSurface}
      className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-6"
    >
      {/* Identity */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-gray-900">
          {agent.name}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-gray-500">
          <span className="font-medium tabular-nums text-gray-700">
            {agent.mobileNumber}
          </span>
          {agent.email && (
            <>
              <Dot />
              <span className="truncate">{agent.email}</span>
            </>
          )}
        </p>
      </div>

      {/* Posting */}
      <div className="min-w-0 shrink-0">
        <p className="text-[13px] font-medium text-gray-900">
          {agent.unitName}
        </p>
        <p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-gray-400">
          {agent.divisionName} · {agent.unitCode}
        </p>
      </div>

      <p className="hidden shrink-0 text-[12px] text-gray-400 lg:block">
        {formatWhen(agent.createdAt)}
      </p>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        <AnimatePresence mode="wait" initial={false}>
          {confirming ? (
            /* Two-tap confirm rather than a modal. Rejection is terminal —
               the agent would have to register again — but a dialog for every
               decision would make a queue of thirty unbearable. */
            <motion.div
              key="confirm"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={springSnappy}
              className="flex items-center gap-2"
            >
              <button
                type="button"
                onClick={() => onDecide('REJECTED')}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-all duration-200 hover:bg-red-700 active:scale-[0.97]"
              >
                Confirm reject
              </button>
              <button
                type="button"
                onClick={onCancelReject}
                className="rounded-xl px-3 py-2.5 text-[13px] font-medium text-gray-500 transition-colors hover:text-gray-800"
              >
                Cancel
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={springSnappy}
              className="flex items-center gap-2"
            >
              <button
                type="button"
                onClick={() => onDecide('APPROVED')}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-all duration-200 hover:bg-emerald-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/20 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
              >
                {busy === 'APPROVED' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" strokeWidth={2.75} />
                )}
                Approve
              </button>

              <button
                type="button"
                onClick={onConfirmReject}
                disabled={!!busy}
                aria-label={`Reject ${agent.name}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-red-600 transition-all duration-200 hover:bg-red-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-red-500/15 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
              >
                {busy === 'REJECTED' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" strokeWidth={2.75} />
                )}
                Reject
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

/* ------------------------------------------------------------------ */

function Dot() {
  return <span className="text-gray-300">·</span>;
}

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}
