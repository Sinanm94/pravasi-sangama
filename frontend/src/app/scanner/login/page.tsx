'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ScanLine } from 'lucide-react';
import {
  GATE_PIN_MAX_LENGTH,
  GATE_PIN_MIN_LENGTH,
  type PublicGate,
  type SessionResponse,
} from '@pravasi/shared';
import { useAuthStore } from '@/store/useAuthStore';
import {
  apiGet,
  apiPost,
  errorCode,
  errorMessage,
  errorStatus,
} from '@/lib/apiClient';
import {
  AuthHeader,
  AuthShell,
  Field,
  SelectField,
  SubtleButton,
  Submit,
} from '@/components/ui/AuthShell';

/**
 * Event-day gate sign in.
 *
 * A volunteer, not an employee: they know their gate's name and a PIN a
 * supervisor read out. Two fields, no account, no recovery flow. Everything
 * else on this screen is a distraction at a queue.
 */
export default function ScannerLoginPage() {
  return (
    <Suspense fallback={<AuthShell />}>
      <GateLoginForm />
    </Suspense>
  );
}

function GateLoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const login = useAuthStore((s) => s.login);

  const [gates, setGates] = useState<PublicGate[]>([]);
  const [gateCode, setGateCode] = useState('');
  const [pin, setPin] = useState('');
  const [errors, setErrors] = useState<{ gate?: string; pin?: string }>({});
  const [busy, setBusy] = useState(false);

  const pinRef = useRef<HTMLInputElement>(null);

  /* The gate list is a convenience. If it fails, SelectField degrades to a
   * free-text code input — a venue with flaky wifi must not be unable to
   * open its own gates. */
  useEffect(() => {
    void apiGet<{ gates: PublicGate[] }>('/auth/gates')
      .then((d) => {
        setGates(d.gates);
        // One gate configured? Pick it. That is one less tap per shift change.
        if (d.gates.length === 1) setGateCode(d.gates[0]!.gateCode);
      })
      .catch(() => setGates([]));
  }, []);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();

    const nextErrors: typeof errors = {};
    if (!gateCode.trim()) nextErrors.gate = 'Select your gate.';
    if (pin.length < GATE_PIN_MIN_LENGTH || pin.length > GATE_PIN_MAX_LENGTH) {
      nextErrors.pin = `Enter the ${GATE_PIN_MIN_LENGTH}–${GATE_PIN_MAX_LENGTH} digit gate PIN.`;
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      if (nextErrors.pin) pinRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const session = await apiPost<SessionResponse>('/auth/gate-login', {
        gate_code: gateCode,
        pin,
      });

      login(session);
      toast.success('Gate open', { description: session.gate?.name });
      router.replace(next ?? '/scanner');
    } catch (err) {
      handleFailure(err);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Branches on HTTP status, not on invented error codes.
   *
   * The API deliberately returns the same "Invalid gate or PIN" for an unknown
   * gate and a wrong PIN — that is anti-enumeration, and the UI must not
   * undo it by guessing which one happened. What it *does* separate is worth
   * separating, and it already words those messages for a volunteer:
   *
   *   403  gate deactivated by an admin      → stop, fetch a supervisor
   *   401  wrong PIN, or a rotated/expired one → retype, or ask for today's
   *   429  rate limited                       → wait
   */
  const handleFailure = (err: unknown) => {
    const status = errorStatus(err);
    const description = errorMessage(err);
    setPin('');

    if (errorCode(err) === 'NETWORK_ERROR') {
      toast.error('No connection', {
        description: 'A gate cannot be opened offline. Check the network.',
        duration: 8000,
      });
    } else if (status === 403) {
      toast.error('Gate is closed', { description, duration: 8000 });
    } else if (status === 429) {
      toast.warning('Too many attempts', {
        description: 'Wait a moment before trying again.',
        duration: 8000,
      });
    } else {
      /* The server's own wording distinguishes a wrong PIN from an expired
       * one ("Ask for today's PIN"), so pass it through rather than
       * overwriting it with a guess. */
      toast.error('Could not open the gate', { description, duration: 6000 });
    }

    pinRef.current?.focus();
  };

  return (
    <AuthShell>
      <form onSubmit={submit} noValidate className="space-y-4">
        <AuthHeader
          icon={ScanLine}
          title="Gate scanner"
          subtitle="Sign in to start verifying tickets"
        />

        <SelectField
          label="Gate"
          value={gateCode}
          onChange={(v) => {
            setGateCode(v);
            setErrors((e) => ({ ...e, gate: undefined }));
          }}
          error={errors.gate}
          placeholder="Select your gate…"
          fallbackPlaceholder="GATE-1"
          options={gates.map((g) => ({
            value: g.gateCode,
            label: `${g.name} · ${g.gateCode}`,
          }))}
        />

        <Field
          ref={pinRef}
          label="Gate PIN"
          hint={`${GATE_PIN_MIN_LENGTH}–${GATE_PIN_MAX_LENGTH} digits`}
          /* type=password, not number: it hides the PIN from the queue behind
             the volunteer, and number inputs bring spinners and silently drop
             leading zeros. inputMode gives the numeric keypad anyway. */
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={pin}
          onChange={(v) => {
            setPin(v.replace(/\D/g, '').slice(0, GATE_PIN_MAX_LENGTH));
            setErrors((e) => ({ ...e, pin: undefined }));
          }}
          placeholder="••••"
          error={errors.pin}
          required
        />

        <Submit busy={busy} busyLabel="Opening gate…">
          Open Gate
        </Submit>

        <p className="pt-1 text-center text-[11px] leading-relaxed text-gray-400">
          The PIN is rotated by administrators. If it stops working, ask your
          supervisor for the current one.
        </p>

        <SubtleButton
          icon={ArrowLeft}
          onClick={() => router.push('/login')}
          className="pt-2"
        >
          Agent or administrator sign in
        </SubtleButton>
      </form>
    </AuthShell>
  );
}
