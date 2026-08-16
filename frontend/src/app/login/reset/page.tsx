'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { AGENT_PASSWORD_MIN_LENGTH } from '@pravasi/shared';
import { apiPost, errorMessage } from '@/lib/apiClient';
import {
  AuthHeader,
  AuthOutcome,
  AuthShell,
  Field,
  Submit,
  SubtleButton,
} from '@/components/ui/AuthShell';

/**
 * Where the emailed reset link lands: `/login/reset?token=…`.
 *
 * The token is read from the query string and posted straight back; it is
 * never stored, and no session is issued on success — the agent signs in
 * with the new password afterwards, so a stolen link cannot also hand over
 * a live session.
 *
 * Public by necessity (the agent cannot sign in — that is the whole
 * problem), so `/login/reset` sits in `PUBLIC_ROUTES` in middleware.ts.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthShell />}>
      <ResetFlow />
    </Suspense>
  );
}

function ResetFlow() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /* A link opened without a token is a mangled email, not a bad password.
   * Saying so plainly beats rendering a form that cannot possibly work. */
  if (!token) {
    return (
      <AuthShell>
        <AuthOutcome
          icon={KeyRound}
          tone="error"
          title="This link is incomplete"
          body="The reset link is missing its token — some email apps break long links across lines. Open it directly from the email, or request a new one."
          actionLabel="Back to Sign In"
          onAction={() => router.replace('/login')}
        />
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell>
        <AuthOutcome
          icon={CheckCircle2}
          tone="success"
          title="Password changed"
          body="Sign in with your mobile number and your new password."
          actionLabel="Go to Sign In"
          onAction={() => router.replace('/login')}
        />
      </AuthShell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    /* Checked here as a courtesy so the agent isn't told about a mismatch
     * only after a round trip. The server re-validates both this and the
     * length — client validation is never the control (§6.3). */
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await apiPost('/api/auth/reset-password', {
        token,
        password,
        confirm_password: confirm,
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <AuthHeader
        icon={KeyRound}
        title="Set a new password"
        subtitle="Choose a password for your agent account"
      />

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field
          label="New Password"
          type="password"
          value={password}
          onChange={setPassword}
          hint={`At least ${AGENT_PASSWORD_MIN_LENGTH} characters`}
          autoComplete="new-password"
          required
        />

        <Field
          label="Confirm Password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          error={error ?? undefined}
          autoComplete="new-password"
          required
        />

        <Submit busy={busy}>Change Password</Submit>

        <SubtleButton onClick={() => router.replace('/login')}>
          Back to Sign In
        </SubtleButton>
      </form>
    </AuthShell>
  );
}
