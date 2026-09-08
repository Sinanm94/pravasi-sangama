'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Download,
  ListTodo,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  ACTIVITY_PRIORITIES,
  ACTIVITY_PRIORITY_LABELS,
  EVENT_TIME_ZONE,
  type ActivityListResponse,
  type ActivityPriority,
  type ActivityRecord,
} from '@pravasi/shared';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AdminShell, { Card, EmptyState } from '@/components/admin/AdminShell';
import {
  apiDelete,
  apiDownload,
  apiGet,
  apiPatch,
  apiPost,
  errorMessage,
} from '@/lib/apiClient';
import { useDismissOnBack } from '@/lib/useDismissOnBack';
import { springSurface } from '@/lib/motion';

const VIOLET = '#5E17EB';

/** Semantic, not brand — HIGH must read as urgent without being decoded. */
const PRIORITY_TONE: Record<ActivityPriority, string> = {
  LOW: 'bg-gray-100 text-gray-500',
  NORMAL: 'bg-gray-100 text-gray-600',
  HIGH: 'bg-red-50 text-red-600',
};

interface Assignee {
  id: string;
  label: string;
}

export default function ActivitiesPage() {
  return (
    <ProtectedRoute allow={['SUPERUSER']}>
      <ActivitiesScreen />
    </ProtectedRoute>
  );
}

/* ================================================================== */

function ActivitiesScreen() {
  const [data, setData] = useState<ActivityListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /* Open by default. A task list exists to show what is still outstanding;
   * opening on "everything" buries that under months of finished work. */
  const [state, setState] = useState<'open' | 'done' | ''>('open');
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');

  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setCommittedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(
    async (s: 'open' | 'done' | '', term: string, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);

      const params = new URLSearchParams();
      if (s) params.set('state', s);
      if (term) params.set('search', term);

      try {
        const qs = params.toString();
        setData(
          await apiGet<ActivityListResponse>(
            `/activities${qs ? `?${qs}` : ''}`,
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
    void load(state, committedSearch);
  }, [load, state, committedSearch]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await apiGet<{ assignees: Assignee[] }>(
          '/activities/assignees',
        );
        setAssignees(r.assignees);
      } catch {
        /* Non-fatal — the picker degrades to "unassigned" and everything
         * else on the screen still works. Not worth a toast on load. */
      }
    })();
  }, []);

  const reload = () => void load(state, committedSearch, true);
  const totals = data?.totals;

  /* Same filters as the list, same query — the report is exactly the rows on
   * screen. On a phone the OS share sheet hands the CSV straight to WhatsApp;
   * on desktop it downloads and opens WhatsApp with the message ready. Mirror
   * of the Clients tab's Report button. */
  const downloadReport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (state) params.set('state', state);
      if (committedSearch) params.set('search', committedSearch);
      const qs = params.toString();

      const outcome = await apiDownload(
        `/activities/export${qs ? `?${qs}` : ''}`,
        {
          fallbackFilename: 'pravasi-activities-report.csv',
          shareTitle: 'Pravasi Sangama 2026 — Activities report',
          shareText: 'Pravasi Sangama 2026 — Activities report',
          whatsappOnFallback: true,
        },
      );

      if (outcome.via === 'share') {
        toast.success('Report ready', { description: outcome.filename });
      } else if (outcome.via === 'download') {
        toast.success('Report downloaded', {
          description: outcome.whatsappTab
            ? `${outcome.filename} — attach it in the WhatsApp tab that just opened.`
            : `${outcome.filename} — check your browser's Downloads.`,
          duration: 8000,
        });
      }
      // 'cancelled' — the user dismissed the share sheet. Say nothing.
    } catch (err) {
      toast.error('Could not download the report', {
        description: errorMessage(err),
      });
    } finally {
      setExporting(false);
    }
  };

  /* One helper for every mutation: they all end the same way, and a shared
   * error path means none of them can silently no-op. */
  const mutate = async (fn: () => Promise<unknown>, failure: string) => {
    try {
      await fn();
      reload();
    } catch (err) {
      toast.error(failure, { description: errorMessage(err) });
    }
  };

  return (
    <AdminShell
      title="Activities"
      subtitle={
        data === null
          ? 'Loading…'
          : `${totals?.open ?? 0} open · ${totals?.overdue ?? 0} overdue`
      }
      actions={
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={reload}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-[13px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97] disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
              strokeWidth={2.25}
            />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void downloadReport()}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-[13px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97] disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />
            ) : (
              <Download className="h-4 w-4" strokeWidth={2.25} />
            )}
            Report
          </button>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-[0.97]"
            style={{ backgroundColor: VIOLET }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Add task
          </button>
        </div>
      }
    >
      {loadError && (
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50 p-4">
          <AlertCircle
            className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600"
            strokeWidth={2.25}
          />
          <p className="text-[13px] leading-snug text-amber-800">
            Could not load activities — {loadError}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={ListTodo}
          label="Total Activities"
          value={totals?.total}
          hint="Every task, open or done"
        />
        <StatCard
          icon={Circle}
          label="Pending"
          value={totals?.open}
          hint="Still to do"
        />
        <StatCard
          icon={CheckCircle2}
          label="Done"
          value={totals?.done}
          hint="Completed"
        />
      </div>

      <div className="mt-6 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex gap-1.5">
            {(
              [
                ['open', 'Open'],
                ['done', 'Done'],
                ['', 'All'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setState(value)}
                className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-all duration-200 active:scale-[0.97] ${
                  state === value
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200/80'
                }`}
                style={state === value ? { backgroundColor: VIOLET } : undefined}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1">
            <label
              htmlFor="activity-search"
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
                id="activity-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks and notes"
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Card>
          {data === null ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-5 animate-pulse rounded-full bg-gray-100"
                />
              ))}
            </div>
          ) : data.activities.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title={
                committedSearch
                  ? 'Nothing matches'
                  : state === 'done'
                    ? 'Nothing finished yet'
                    : 'No open tasks'
              }
              body={
                committedSearch
                  ? 'Try a different search.'
                  : 'Add a task to start tracking what needs doing.'
              }
            />
          ) : (
            <ul className="divide-y divide-gray-900/[0.05]">
              {data.activities.map((a) => (
                <ActivityRow
                  key={a.id}
                  activity={a}
                  assignees={assignees}
                  onToggle={() =>
                    mutate(
                      () =>
                        apiPatch(`/activities/${a.id}`, {
                          done: a.doneAt === null,
                        }),
                      'Could not update the task',
                    )
                  }
                  onAssign={(id) =>
                    mutate(
                      () =>
                        apiPatch(`/activities/${a.id}`, {
                          assigned_to: id || null,
                        }),
                      'Could not reassign',
                    )
                  }
                  onDelete={() =>
                    mutate(
                      () => apiDelete(`/activities/${a.id}`),
                      'Could not delete',
                    )
                  }
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {adding && (
        <AddActivitySheet
          assignees={assignees}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </AdminShell>
  );
}

/* ================================================================== */

function ActivityRow({
  activity,
  assignees,
  onToggle,
  onAssign,
  onDelete,
}: {
  activity: ActivityRecord;
  assignees: Assignee[];
  onToggle: () => void;
  onAssign: (id: string) => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const done = activity.doneAt !== null;
  const overdue = isOverdue(activity);

  return (
    <li className="px-5 py-4 sm:px-6">
      <div className="flex items-start gap-3">
        {/* The tick is the primary action, so it is the biggest target and
            sits where the eye lands first. */}
        <button
          type="button"
          onClick={onToggle}
          aria-label={done ? 'Mark as not done' : 'Mark as done'}
          className="mt-0.5 shrink-0 transition-transform duration-200 active:scale-[0.9]"
        >
          {done ? (
            <CheckCircle2
              className="h-5 w-5 text-emerald-600"
              strokeWidth={2.25}
            />
          ) : (
            <Circle
              className="h-5 w-5 text-gray-300 hover:text-gray-400"
              strokeWidth={2.25}
            />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={`text-[15px] font-medium ${
                done ? 'text-gray-400 line-through' : 'text-gray-900'
              }`}
            >
              {activity.title}
            </p>
            {/* Priority is noise once something is finished. */}
            {!done && activity.priority !== 'NORMAL' && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${
                  PRIORITY_TONE[activity.priority]
                }`}
              >
                {ACTIVITY_PRIORITY_LABELS[activity.priority]}
              </span>
            )}
            {!done && activity.dueOn && (
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  overdue ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {overdue ? 'Overdue' : 'Due'} {formatDateOnly(activity.dueOn)}
              </span>
            )}
          </div>

          {activity.notes && (
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-gray-600">
              {activity.notes}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={activity.assignedTo ?? ''}
              onChange={(e) => onAssign(e.target.value)}
              className="cursor-pointer rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5E17EB]/30"
            >
              <option value="">Unassigned</option>
              {assignees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>

            {done && activity.doneAt && (
              <span className="text-[11px] text-emerald-600">
                Done {formatEventDate(activity.doneAt)}
              </span>
            )}
            {activity.createdByName && (
              <span className="text-[11px] text-gray-400">
                Added by {activity.createdByName}
              </span>
            )}
          </div>
        </div>

        {/* Two-step, like the client delete: a task carries its notes and
            its history of who owned it, and a stray tap should not take
            that with it. */}
        {confirmingDelete ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onDelete}
              className="rounded-full bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-red-700 active:scale-[0.97]"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-full bg-gray-100 px-3 py-1.5 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-200/80 active:scale-[0.97]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete task"
            className="shrink-0 rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-600 active:scale-[0.92]"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2.25} />
          </button>
        )}
      </div>
    </li>
  );
}

/* ================================================================== */

function AddActivitySheet({
  assignees,
  onClose,
  onCreated,
}: {
  assignees: Assignee[];
  onClose: () => void;
  onCreated: () => void;
}) {
  useDismissOnBack(true, onClose);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<ActivityPriority>('NORMAL');
  const [dueOn, setDueOn] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (title.trim().length < 2) {
      setError('Say what needs doing.');
      return;
    }

    setBusy(true);
    try {
      await apiPost('/activities', {
        title: title.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        priority,
        ...(dueOn ? { due_on: dueOn } : {}),
        ...(assignedTo ? { assigned_to: assignedTo } : {}),
      });
      toast.success('Task added');
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add task"
      className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/20 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-[0_-8px_40px_rgb(0,0,0,0.12)] sm:max-w-lg sm:rounded-3xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-gray-900">
            Add task
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <X className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="What needs doing" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Confirm catering headcount"
              autoFocus
              className={inputCls}
            />
          </Field>

          <Field label="Notes" hint="Optional detail or context">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={`${inputCls} resize-y`}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as ActivityPriority)
                }
                className={inputCls}
              >
                {ACTIVITY_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {ACTIVITY_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Due on" hint="Leave blank if open-ended">
              <input
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Assign to" hint="Anyone can pick this up either way">
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className={inputCls}
            >
              <option value="">Unassigned</option>
              {assignees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          {error && <p className="text-[13px] text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-gray-100 px-4 py-2.5 text-[13px] font-medium text-gray-600 transition-colors hover:bg-gray-200/80 active:scale-[0.97]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-[0.97] disabled:opacity-60"
              style={{ backgroundColor: VIOLET }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Add task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Local primitives — promote on a second consumer (§6.4)              */
/* ------------------------------------------------------------------ */

const inputCls =
  'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10';

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-baseline gap-1.5">
        <span className="text-[13px] font-medium text-gray-700">{label}</span>
        {required && <span style={{ color: VIOLET }}>*</span>}
        {hint && <span className="text-[12px] text-gray-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** Mirrors the Clients tab's summary card — same surface, type scale and the
 *  skeleton-then-fade on first load. */
function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof ListTodo;
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

/* ------------------------------------------------------------------ */

/** Compared as a plain date string — `due_on` has no time, so no timezone
 *  conversion is involved and none should be invented. */
function isOverdue(a: ActivityRecord): boolean {
  if (!a.dueOn || a.doneAt !== null) return false;
  return a.dueOn <= new Date().toISOString().slice(0, 10);
}

function formatDateOnly(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Event-local, per the scan log's reasoning: a volunteer's phone is often
 *  still on their home timezone, and the event's clock is what matters. */
function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: EVENT_TIME_ZONE,
  });
}
