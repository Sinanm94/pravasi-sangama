'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertCircle,
  CalendarClock,
  ChevronDown,
  Clock,
  Loader2,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import {
  CLIENT_INTERACTION_KINDS,
  CLIENT_INTERACTION_LABELS,
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
  EVENT_TIME_ZONE,
  PREMIUM_TICKET_TYPES,
  TICKET_TYPE_LABELS,
  type ClientDetailResponse,
  type ClientInteractionKind,
  type ClientListResponse,
  type ClientRecord,
  type ClientStatus,
  type TicketType,
} from '@pravasi/shared';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AdminShell, { Card, EmptyState } from '@/components/admin/AdminShell';
import { apiGet, apiPost, apiPatch, errorMessage } from '@/lib/apiClient';
import { useDismissOnBack } from '@/lib/useDismissOnBack';
import { springSurface } from '@/lib/motion';

const VIOLET = '#5E17EB';
const VIOLET_DEEP = '#37098C';

/** Semantic, not brand — an overdue chase must read as urgent at a glance. */
const STATUS_TONE: Record<ClientStatus, string> = {
  PROSPECT: 'bg-gray-100 text-gray-600',
  AWAITING_REPLY: 'bg-amber-50 text-amber-700',
  CONFIRMED: 'bg-emerald-50 text-emerald-700',
  TICKETED: 'bg-emerald-50 text-emerald-700',
  DECLINED: 'bg-red-50 text-red-600',
};

const KIND_TONE: Record<ClientInteractionKind, string> = {
  NOTE: 'bg-gray-100 text-gray-600',
  OUTREACH: 'bg-violet-50 text-violet-700',
  RESPONSE: 'bg-emerald-50 text-emerald-700',
};

export default function ClientsPage() {
  return (
    <ProtectedRoute allow={['SUPERUSER']}>
      <ClientsScreen />
    </ProtectedRoute>
  );
}

/* ================================================================== */

function ClientsScreen() {
  const [data, setData] = useState<ClientListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [status, setStatus] = useState<ClientStatus | ''>('');
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');

  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setCommittedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(
    async (s: ClientStatus | '', term: string, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);

      const params = new URLSearchParams();
      if (s) params.set('status', s);
      if (term) params.set('search', term);

      try {
        const qs = params.toString();
        setData(await apiGet<ClientListResponse>(`/clients${qs ? `?${qs}` : ''}`));
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
    void load(status, committedSearch);
  }, [load, status, committedSearch]);

  const reload = () => void load(status, committedSearch, true);
  const totals = data?.totals;
  const filtered = Boolean(status) || committedSearch.length > 0;

  return (
    <AdminShell
      title="Clients"
      subtitle={
        data === null
          ? 'Loading…'
          : `${(totals?.total ?? 0).toLocaleString()} client${totals?.total === 1 ? '' : 's'}${filtered ? ' matching' : ''}`
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
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-[0.97]"
            style={{ backgroundColor: VIOLET }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Add client
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
            Could not load clients — {loadError}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Users} label="Clients" value={totals?.total} hint="Being tracked" />
        <StatCard
          icon={Clock}
          label="Awaiting reply"
          value={totals?.awaitingReply}
          hint="We asked, no answer yet"
        />
        <StatCard
          icon={CalendarClock}
          label="Due to chase"
          value={totals?.overdue}
          hint="Follow-up date reached"
        />
      </div>

      <div className="mt-6 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-gray-900/[0.04]">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-[13px] font-medium text-gray-700">
              Status
            </span>
            <div className="relative">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ClientStatus | '')}
                className="w-full cursor-pointer appearance-none rounded-xl border border-gray-200 bg-white py-3 pl-4 pr-11 text-[15px] text-gray-900 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
              >
                <option value="">All statuses</option>
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CLIENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-400"
                strokeWidth={2.25}
              />
            </div>
          </label>

          <div>
            <label
              htmlFor="client-search"
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
                id="client-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, mobile, email or organisation"
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
              />
            </div>
          </div>
        </div>

        {filtered && (
          <div className="mt-4 flex items-center justify-end border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => {
                setStatus('');
                setSearch('');
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2 text-[12px] font-medium text-gray-600 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 active:scale-[0.97]"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              Clear filters
            </button>
          </div>
        )}
      </div>

      <div className="mt-4">
        <Card>
          {data === null ? (
            <ListSkeleton />
          ) : data.clients.length === 0 ? (
            <EmptyState
              icon={UserRound}
              title={filtered ? 'No matching clients' : 'No clients yet'}
              body={
                filtered
                  ? 'Nothing matches these filters. Clear them to see everyone.'
                  : 'Add a client to start tracking what you asked and what they said.'
              }
            />
          ) : (
            <ul className="divide-y divide-gray-900/[0.05]">
              {data.clients.map((c) => (
                <ClientRow key={c.id} client={c} onOpen={() => setOpenId(c.id)} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {adding && (
        <AddClientSheet
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      {openId && (
        <ClientDetailSheet
          clientId={openId}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}
    </AdminShell>
  );
}

/* ================================================================== */

function ClientRow({
  client,
  onOpen,
}: {
  client: ClientRecord;
  onOpen: () => void;
}) {
  const overdue = isOverdue(client);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-gray-50/70 sm:px-6"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[15px] font-medium text-gray-900">
              {client.name}
            </p>
            {client.intendedTier && (
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-600">
                {TICKET_TYPE_LABELS[client.intendedTier]}
              </span>
            )}
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] ${
                STATUS_TONE[client.status]
              }`}
            >
              {CLIENT_STATUS_LABELS[client.status]}
            </span>
          </div>

          <p className="mt-0.5 truncate text-[12px] text-gray-500">
            {[client.organisation, client.mobile, client.email]
              .filter(Boolean)
              .join(' · ') || 'No contact details recorded'}
          </p>

          <p className="mt-1 text-[11px] text-gray-400">
            {client.interactionCount === 0
              ? 'No updates logged yet'
              : `${client.interactionCount} update${client.interactionCount === 1 ? '' : 's'}` +
                (client.lastInteractionAt
                  ? ` · last ${formatEventDate(client.lastInteractionAt)}`
                  : '')}
          </p>
        </div>

        {client.followUpOn && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              overdue ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {overdue ? 'Chase' : 'Follow up'} {formatDateOnly(client.followUpOn)}
          </span>
        )}
      </button>
    </li>
  );
}

/* ================================================================== */
/* Add                                                                 */
/* ================================================================== */

function AddClientSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  useDismissOnBack(true, onClose);

  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState<TicketType | ''>('');
  const [status, setStatus] = useState<ClientStatus>('PROSPECT');
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (name.trim().length < 2) {
      setError('Enter a name.');
      return;
    }

    setBusy(true);
    try {
      await apiPost('/clients', {
        name: name.trim(),
        ...(organisation.trim() ? { organisation: organisation.trim() } : {}),
        ...(mobile.trim() ? { mobile: mobile.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(tier ? { intended_tier: tier } : {}),
        status,
        ...(followUp ? { follow_up_on: followUp } : {}),
      });
      toast.success('Client added');
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Add client" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4 p-6">
        <SheetField label="Name" required>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="Full name"
            className={inputCls}
            autoFocus
          />
        </SheetField>

        <SheetField label="Organisation">
          <input
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
            placeholder="Company or association"
            className={inputCls}
          />
        </SheetField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SheetField label="Mobile">
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              inputMode="tel"
              placeholder="Any format"
              className={inputCls}
            />
          </SheetField>
          <SheetField label="Email">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              placeholder="name@example.com"
              className={inputCls}
            />
          </SheetField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SheetField label="Tier discussed">
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as TicketType | '')}
              className={inputCls}
            >
              <option value="">Not decided</option>
              {PREMIUM_TICKET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TICKET_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </SheetField>
          <SheetField label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ClientStatus)}
              className={inputCls}
            >
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CLIENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </SheetField>
        </div>

        <SheetField label="Follow up on" hint="Leave blank if nothing is pending">
          <input
            type="date"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            className={inputCls}
          />
        </SheetField>

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
            Add client
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ================================================================== */
/* Detail + timeline                                                   */
/* ================================================================== */

function ClientDetailSheet({
  clientId,
  onClose,
  onChanged,
}: {
  clientId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  useDismissOnBack(true, onClose);

  const [detail, setDetail] = useState<ClientDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [kind, setKind] = useState<ClientInteractionKind>('RESPONSE');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await apiGet<ClientDetailResponse>(`/clients/${clientId}`));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addEntry = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!body.trim()) return;

    setPosting(true);
    try {
      /* The endpoint returns the refreshed record AND timeline, so the entry
       * appears without a second round trip. */
      const next = await apiPost<ClientDetailResponse>(
        `/clients/${clientId}/interactions`,
        { kind, body: body.trim() },
      );
      setDetail(next);
      setBody('');
      onChanged();
    } catch (err) {
      toast.error('Could not save that update', {
        description: errorMessage(err),
      });
    } finally {
      setPosting(false);
    }
  };

  const patch = async (fields: Record<string, unknown>) => {
    try {
      await apiPatch(`/clients/${clientId}`, fields);
      await load();
      onChanged();
    } catch (err) {
      toast.error('Could not update', { description: errorMessage(err) });
    }
  };

  const client = detail?.client;

  return (
    <Sheet title={client?.name ?? 'Client'} onClose={onClose}>
      {loadError ? (
        <p className="p-6 text-[13px] text-red-600">{loadError}</p>
      ) : !client ? (
        <div className="space-y-3 p-6">
          <div className="h-4 w-40 animate-pulse rounded-full bg-gray-100" />
          <div className="h-4 w-56 animate-pulse rounded-full bg-gray-50" />
        </div>
      ) : (
        <div className="p-6">
          {/* Where things stand — editable inline, because the whole point of
              this screen is that the state changes as the conversation does. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SheetField label="Status">
              <select
                value={client.status}
                onChange={(e) => void patch({ status: e.target.value })}
                className={inputCls}
              >
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CLIENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </SheetField>

            <SheetField label="Follow up on">
              <input
                type="date"
                value={client.followUpOn ?? ''}
                onChange={(e) =>
                  void patch({ follow_up_on: e.target.value || null })
                }
                className={inputCls}
              />
            </SheetField>
          </div>

          <p className="mt-3 text-[12px] text-gray-500">
            {[
              client.organisation,
              client.mobile,
              client.email,
              client.intendedTier
                ? `${TICKET_TYPE_LABELS[client.intendedTier]} discussed`
                : null,
              client.ticketNumber ? `Ticket ${client.ticketNumber}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'No contact details recorded'}
          </p>

          {/* Add an update */}
          <form
            onSubmit={addEntry}
            className="mt-6 rounded-2xl bg-gray-50 p-4"
          >
            <div className="flex flex-wrap gap-1.5">
              {CLIENT_INTERACTION_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    kind === k
                      ? 'text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                  style={kind === k ? { backgroundColor: VIOLET } : undefined}
                >
                  {CLIENT_INTERACTION_LABELS[k]}
                </button>
              ))}
            </div>

            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder={
                kind === 'OUTREACH'
                  ? 'What did you ask them?'
                  : kind === 'RESPONSE'
                    ? 'What did they say?'
                    : 'Anything worth remembering'
              }
              className="mt-3 w-full resize-y rounded-xl border border-gray-200 bg-white px-4 py-3 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
            />

            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                disabled={posting || !body.trim()}
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-[0.97] disabled:opacity-40"
                style={{ backgroundColor: VIOLET }}
              >
                {posting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquarePlus className="h-4 w-4" strokeWidth={2.25} />
                )}
                Log update
              </button>
            </div>
          </form>

          {/* Timeline */}
          <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
            History
          </h3>

          {detail.interactions.length === 0 ? (
            <p className="mt-3 text-[13px] text-gray-500">
              Nothing logged yet. Add the first update above.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {detail.interactions.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-2xl border border-gray-100 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        KIND_TONE[entry.kind]
                      }`}
                    >
                      {CLIENT_INTERACTION_LABELS[entry.kind]}
                    </span>
                    <span className="text-[11px] tabular-nums text-gray-400">
                      {formatEventDateTime(entry.occurredAt)}
                    </span>
                    {entry.authorName && (
                      <span className="text-[11px] text-gray-400">
                        · {entry.authorName}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800">
                    {entry.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Local primitives — promote on a second consumer (§6.4)              */
/* ------------------------------------------------------------------ */

const inputCls =
  'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10';

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 overflow-y-auto bg-gray-900/30 backdrop-blur-[2px]"
    >
      <div className="flex min-h-full justify-center p-4 sm:p-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSurface}
          className="h-fit w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)]"
        >
          <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-4">
            <h2
              className="truncate text-[17px] font-semibold tracking-[-0.01em]"
              style={{ color: VIOLET_DEEP }}
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-full bg-gray-100 p-2 text-gray-500 transition-colors hover:bg-gray-200/80 hover:text-gray-900 active:scale-95"
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
          {children}
        </motion.div>
      </div>
    </div>
  );
}

function SheetField({
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

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-gray-900/[0.05]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2 px-5 py-4 sm:px-6">
          <div className="h-4 w-44 animate-pulse rounded-full bg-gray-100" />
          <div className="h-3 w-64 animate-pulse rounded-full bg-gray-50" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Due today or earlier, and not already settled. Mirrors the SQL. */
function isOverdue(c: ClientRecord): boolean {
  if (!c.followUpOn) return false;
  if (c.status === 'TICKETED' || c.status === 'DECLINED') return false;
  return c.followUpOn <= new Date().toISOString().slice(0, 10);
}

/** Already a plain YYYY-MM-DD from the API — no timezone shifting. */
function formatDateOnly(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(
    'en-GB',
    { day: '2-digit', month: 'short' },
  );
}

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    timeZone: EVENT_TIME_ZONE,
    day: '2-digit',
    month: 'short',
  });
}

function formatEventDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: EVENT_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
