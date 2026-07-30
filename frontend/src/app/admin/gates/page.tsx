'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  Copy,
  DoorOpen,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  GATE_PIN_MAX_LENGTH,
  GATE_PIN_MIN_LENGTH,
  type GateSummary,
} from '@pravasi/shared';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AdminShell, {
  Card,
  EmptyState,
  RowSkeleton,
} from '@/components/admin/AdminShell';
import {
  apiGet,
  apiPost,
  errorMessage,
  errorStatus,
} from '@/lib/apiClient';
import { inputClass } from '@/components/ui/AuthShell';
import { springSnappy, springSurface } from '@/lib/motion';

const NAVY = '#062B59';

/**
 * IMPORTANT — read before touching the PIN handling below.
 *
 * The backend never stores or returns a PIN in plaintext: `createGate` and
 * `rotateGatePin` both take `pin` as INPUT and respond with only an id (see
 * admin.controller.ts — "The PIN is never echoed back... the only stored
 * form is the bcrypt hash"). `GateSummary` carries no PIN field at all.
 *
 * So this screen cannot "look up" a gate's current PIN — nothing in the
 * system knows it in plaintext after the moment it was set. What it CAN do,
 * and does: generate a PIN client-side, let the admin edit it, and echo it
 * back the instant the server confirms it was accepted. That reveal is pure
 * local state — it evaporates on refresh, exactly like a password would.
 */

export default function GatesPage() {
  return (
    <ProtectedRoute allow={['SUPERUSER']}>
      <GatesScreen />
    </ProtectedRoute>
  );
}

/* ================================================================== */

function GatesScreen() {
  const [gates, setGates] = useState<GateSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /** gateId → the PIN this admin just set, for as long as they keep it open. */
  const [revealedPins, setRevealedPins] = useState<Record<string, string>>({});
  const [rotating, setRotating] = useState<Record<string, 'confirm' | 'busy'>>(
    {},
  );
  const [rotateDraft, setRotateDraft] = useState<Record<string, string>>({});
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await apiGet<{ gates: GateSummary[] }>('/admin/gates');
      setGates(data.gates);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
      setGates((prev) => prev ?? []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* --- Create ------------------------------------------------------- */

  const handleCreated = (gate: GateSummary, pin: string) => {
    setGates((prev) => [gate, ...(prev ?? [])]);
    setRevealedPins((prev) => ({ ...prev, [gate.id]: pin }));
  };

  /* --- Rotate --------------------------------------------------------
   * Two-tap: "Rotate PIN" opens the warning + a pre-filled random PIN the
   * admin can edit; "Confirm Rotate" is the second, deliberate tap. Nothing
   * fires on the first tap. */

  const beginRotate = (gate: GateSummary) => {
    setRotating((p) => ({ ...p, [gate.id]: 'confirm' }));
    setRotateDraft((p) => ({ ...p, [gate.id]: randomPin() }));
  };

  const cancelRotate = (gateId: string) => {
    setRotating((p) => {
      const next = { ...p };
      delete next[gateId];
      return next;
    });
  };

  const confirmRotate = async (gate: GateSummary) => {
    const pin = rotateDraft[gate.id] ?? '';
    if (pin.length < GATE_PIN_MIN_LENGTH || pin.length > GATE_PIN_MAX_LENGTH) {
      toast.error('Invalid PIN', {
        description: `Enter ${GATE_PIN_MIN_LENGTH}–${GATE_PIN_MAX_LENGTH} digits.`,
      });
      return;
    }

    setRotating((p) => ({ ...p, [gate.id]: 'busy' }));
    try {
      await apiPost(`/admin/gates/${gate.id}/rotate-pin`, { pin });

      setGates((prev) =>
        (prev ?? []).map((g) =>
          g.id === gate.id
            ? { ...g, pinRotatedAt: new Date().toISOString() }
            : g,
        ),
      );
      setRevealedPins((prev) => ({ ...prev, [gate.id]: pin }));
      cancelRotate(gate.id);

      toast.success('PIN rotated', {
        description: `Every session open at ${gate.name} was signed out.`,
      });
    } catch (err) {
      toast.error('Could not rotate the PIN', {
        description: errorMessage(err),
      });
      setRotating((p) => ({ ...p, [gate.id]: 'confirm' }));
    }
  };

  /* --- Active / inactive --------------------------------------------- */

  const toggleActive = async (gate: GateSummary) => {
    setToggling((p) => ({ ...p, [gate.id]: true }));
    const nextActive = !gate.isActive;

    try {
      await apiPost(`/admin/gates/${gate.id}/active`, { is_active: nextActive });
      setGates((prev) =>
        (prev ?? []).map((g) =>
          g.id === gate.id ? { ...g, isActive: nextActive } : g,
        ),
      );
      toast.success(nextActive ? 'Gate reopened' : 'Gate closed', {
        description: gate.name,
      });
    } catch (err) {
      toast.error('Could not change the gate status', {
        description: errorMessage(err),
      });
    } finally {
      setToggling((p) => {
        const next = { ...p };
        delete next[gate.id];
        return next;
      });
    }
  };

  const count = gates?.length ?? 0;

  return (
    <AdminShell
      title="Gate Management"
      subtitle={
        gates === null
          ? 'Loading gates…'
          : `${count} gate${count === 1 ? '' : 's'} configured`
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
          <AlertTriangle
            className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600"
            strokeWidth={2.25}
          />
          <p className="text-[13px] leading-snug text-amber-800">
            Could not refresh the list — {loadError}
          </p>
        </div>
      )}

      <CreateGateCard onCreated={handleCreated} />

      <div className="mt-6">
        {gates === null ? (
          <Card>
            <RowSkeleton rows={3} />
          </Card>
        ) : count === 0 ? (
          <Card>
            <EmptyState
              icon={DoorOpen}
              title="No gates yet"
              body="Create your first gate above. You'll set its PIN yourself and it appears here right away."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {gates.map((gate) => (
                <GateCard
                  key={gate.id}
                  gate={gate}
                  revealedPin={revealedPins[gate.id]}
                  onDismissReveal={() =>
                    setRevealedPins((p) => {
                      const next = { ...p };
                      delete next[gate.id];
                      return next;
                    })
                  }
                  rotateState={rotating[gate.id]}
                  rotateDraft={rotateDraft[gate.id] ?? ''}
                  onRotateDraftChange={(v) =>
                    setRotateDraft((p) => ({ ...p, [gate.id]: v }))
                  }
                  onBeginRotate={() => beginRotate(gate)}
                  onCancelRotate={() => cancelRotate(gate.id)}
                  onConfirmRotate={() => void confirmRotate(gate)}
                  toggling={!!toggling[gate.id]}
                  onToggleActive={() => void toggleActive(gate)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

/* ================================================================== */
/* Create                                                               */
/* ================================================================== */

function CreateGateCard({
  onCreated,
}: {
  onCreated: (gate: GateSummary, pin: string) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [pin, setPin] = useState(() => randomPin());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; code?: string; pin?: string }>(
    {},
  );

  const handleNameChange = (v: string) => {
    setName(v);
    setErrors((e) => ({ ...e, name: undefined }));
    // Keep the code in sync with the name until the admin edits it directly —
    // after that, their choice wins even if they keep changing the name.
    if (!codeTouched) setCode(suggestGateCode(v));
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();

    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = 'Name is required.';
    if (!code.trim()) nextErrors.code = 'Gate code is required.';
    if (pin.length < GATE_PIN_MIN_LENGTH || pin.length > GATE_PIN_MAX_LENGTH) {
      nextErrors.pin = `${GATE_PIN_MIN_LENGTH}–${GATE_PIN_MAX_LENGTH} digits.`;
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    try {
      const created = await apiPost<{ id: string; gateCode: string }>(
        '/admin/gates',
        { gate_code: code, name: name.trim(), pin },
      );

      // The server confirms an id and the normalised code; everything else
      // in the row is exactly what was just submitted or a sane default —
      // it did not come from anywhere else.
      onCreated(
        {
          id: created.id,
          gateCode: created.gateCode,
          name: name.trim(),
          divisionName: null,
          isActive: true,
          pinRotatedAt: new Date().toISOString(),
          pinValidOn: null,
        },
        pin,
      );

      toast.success('Gate created', { description: name.trim() });

      setName('');
      setCode('');
      setCodeTouched(false);
      setPin(randomPin());
    } catch (err) {
      if (errorStatus(err) === 409) {
        setErrors((e) => ({ ...e, code: 'That gate code is already in use.' }));
        toast.error('Gate code already in use', {
          description: 'Pick a different code.',
        });
      } else {
        toast.error('Could not create the gate', {
          description: errorMessage(err),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={submit} className="p-5 sm:p-6">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ backgroundColor: `${NAVY}12` }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} style={{ color: NAVY }} />
          </span>
          <p className="text-[15px] font-semibold text-gray-900">Add a gate</p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1.2fr_1fr]">
          <LabelledInput
            label="Gate Name"
            value={name}
            onChange={handleNameChange}
            placeholder="Main Entrance"
            error={errors.name}
          />

          <LabelledInput
            label="Gate Code"
            hint="Shown to volunteers"
            value={code}
            onChange={(v) => {
              setCodeTouched(true);
              setCode(v.toUpperCase());
            }}
            placeholder="MAIN-ENTRANCE"
            error={errors.code}
          />

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-gray-700">
                Gate PIN
              </span>
              <button
                type="button"
                onClick={() => setPin(randomPin())}
                className="text-[11px] font-medium text-gray-400 transition-colors hover:text-gray-700"
              >
                Shuffle
              </button>
            </div>
            {/* Not masked: the admin's whole job here is reading this value
                back to a volunteer, so hiding it would be self-defeating. */}
            <input
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, '').slice(0, GATE_PIN_MAX_LENGTH))
              }
              inputMode="numeric"
              className={`${inputClass(!!errors.pin)} font-mono tracking-[0.2em]`}
            />
            {errors.pin && (
              <p className="mt-2 text-[12px] text-red-500">{errors.pin}</p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="mt-5 inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: NAVY }}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          )}
          {busy ? 'Creating…' : 'Create Gate'}
        </button>
      </form>
    </Card>
  );
}

function LabelledInput({
  label,
  hint,
  value,
  onChange,
  placeholder,
  error,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  error?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-gray-700">{label}</span>
        {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputClass(!!error)}
      />
      {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
    </div>
  );
}

/* ================================================================== */
/* Gate card                                                            */
/* ================================================================== */

function GateCard({
  gate,
  revealedPin,
  onDismissReveal,
  rotateState,
  rotateDraft,
  onRotateDraftChange,
  onBeginRotate,
  onCancelRotate,
  onConfirmRotate,
  toggling,
  onToggleActive,
}: {
  gate: GateSummary;
  revealedPin?: string;
  onDismissReveal: () => void;
  rotateState?: 'confirm' | 'busy';
  rotateDraft: string;
  onRotateDraftChange: (v: string) => void;
  onBeginRotate: () => void;
  onCancelRotate: () => void;
  onConfirmRotate: () => void;
  toggling: boolean;
  onToggleActive: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={springSurface}
    >
      <Card>
        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-gray-900">
                {gate.name}
              </p>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.1em] text-gray-400">
                {gate.gateCode}
                {gate.divisionName ? ` · ${gate.divisionName}` : ''}
              </p>
            </div>

            <button
              type="button"
              onClick={onToggleActive}
              disabled={toggling}
              aria-label={gate.isActive ? 'Deactivate gate' : 'Reactivate gate'}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-200 disabled:opacity-50 ${
                gate.isActive
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {toggling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Power className="h-3 w-3" strokeWidth={2.5} />
              )}
              {gate.isActive ? 'Active' : 'Closed'}
            </button>
          </div>

          {/* PIN reveal — local-only, evaporates on refresh */}
          <AnimatePresence initial={false}>
            {revealedPin && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={springSnappy}
                className="overflow-hidden"
              >
                <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-emerald-700">
                      PIN — write this down
                    </p>
                    <p className="font-mono text-[18px] font-bold tracking-[0.25em] text-emerald-900">
                      {revealedPin}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(revealedPin);
                        toast.success('PIN copied');
                      }}
                      className="rounded-full p-1.5 text-emerald-700 transition-colors hover:bg-emerald-100"
                      aria-label="Copy PIN"
                    >
                      <Copy className="h-3.5 w-3.5" strokeWidth={2.25} />
                    </button>
                    <button
                      type="button"
                      onClick={onDismissReveal}
                      className="rounded-full p-1.5 text-emerald-700 transition-colors hover:bg-emerald-100"
                      aria-label="Hide PIN"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.25} />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <p className="mt-3 text-[11px] text-gray-400">
            PIN last set {formatWhen(gate.pinRotatedAt)}
            {gate.pinValidOn ? ` · expires ${gate.pinValidOn}` : ''}
          </p>

          {/* Rotate — two-tap, with the warning inline */}
          <div className="mt-4">
            <AnimatePresence mode="wait" initial={false}>
              {rotateState ? (
                <motion.div
                  key="confirm"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={springSnappy}
                  className="space-y-3"
                >
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50 p-3">
                    <ShieldAlert
                      className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                      strokeWidth={2.25}
                    />
                    <p className="text-[12px] font-medium leading-snug text-amber-800">
                      Warning: this drops every active scanner at this gate.
                      Volunteers must sign in again with the new PIN.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      value={rotateDraft}
                      onChange={(e) =>
                        onRotateDraftChange(
                          e.target.value
                            .replace(/\D/g, '')
                            .slice(0, GATE_PIN_MAX_LENGTH),
                        )
                      }
                      inputMode="numeric"
                      disabled={rotateState === 'busy'}
                      className={`${inputClass(false)} flex-1 font-mono tracking-[0.2em]`}
                    />
                    <button
                      type="button"
                      onClick={() => onRotateDraftChange(randomPin())}
                      disabled={rotateState === 'busy'}
                      className="rounded-xl border border-gray-200 p-3 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50"
                      aria-label="Generate a new random PIN"
                    >
                      <RefreshCw className="h-4 w-4" strokeWidth={2.25} />
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onConfirmRotate}
                      disabled={rotateState === 'busy'}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-all duration-200 hover:bg-amber-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {rotateState === 'busy' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" strokeWidth={2.75} />
                      )}
                      Confirm Rotate
                    </button>
                    <button
                      type="button"
                      onClick={onCancelRotate}
                      disabled={rotateState === 'busy'}
                      className="rounded-xl px-3 py-2.5 text-[13px] font-medium text-gray-500 transition-colors hover:text-gray-800 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.button
                  key="trigger"
                  type="button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={springSnappy}
                  onClick={onBeginRotate}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700 transition-all duration-200 hover:bg-gray-50 active:scale-[0.97]"
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={2.25} />
                  Rotate PIN
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

/** Cryptographically random, not just Math.random — this guards a real door. */
function randomPin(length: number = GATE_PIN_MIN_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b % 10).join('');
}

function suggestGateCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

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
