'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, KeyRound } from 'lucide-react';
import { AGENT_PASSWORD_MIN_LENGTH } from '@pravasi/shared';
import { apiPost, errorMessage } from '@/lib/apiClient';
import {
  AuthHeader,
  AuthOutcome,
  AuthShell,
  Field,
  Submit,
} from '@/components/ui/AuthShell';

/**
 * Landing page for the emailed reset link: `/login/reset?token=…`.
 *
 * The token is single-use and server-verified — this page never inspects it,
 * it only carries it back. A spent or forged token fails at submit, which is
 * the only place that can tell.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthShell />}>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();

    const next: Record<string, string> = {};
    if (password.length < AGENT_PASSWORD_MIN_LENGTH) {
      next.password = `At least ${AGENT_PASSWORD_MIN_LENGTH} characters.`;
    }
    if (confirm !== password) next.confirm = 'Passwords do not match.';

    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      await apiPost('/auth/reset-password', {
        token,
        password,
        confirm_password: confirm,
      });

      toast.success('Password updated', {
        description: 'Sign in with your new password.',
      });
      router.replace('/login');
    } catch (err) {
      toast.error('Could not reset your password', {
        description: errorMessage(err),
      });
    } finally {
      setBusy(false);
    }
  };

  /* A link pasted without its query string, or one a mail client wrapped and
   * truncated. Say so plainly rather than failing on submit. */
  if (!token) {
    return (
      <AuthShell>
        <AuthOutcome
          icon={AlertCircle}
          tone="error"
          title="Invalid reset link"
          body="This link is missing its token. Open the most recent email, or request a new link."
          actionLabel="Back to Sign In"
          onAction={() => router.replace('/login')}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={submit} noValidate className="space-y-4">
        <AuthHeader
          icon={KeyRound}
          title="Set a new password"
          subtitle="This link works once and expires in 60 minutes"
        />

        <Field
          label="New Password"
          hint={`Min ${AGENT_PASSWORD_MIN_LENGTH} characters`}
          type="password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            setErrors((e) => ({ ...e, password: '' }));
          }}
          autoComplete="new-password"
          error={errors.password || undefined}
          required
        />

        <Field
          label="Confirm Password"
          type="password"
          value={confirm}
          onChange={(v) => {
            setConfirm(v);
            setErrors((e) => ({ ...e, confirm: '' }));
          }}
          autoComplete="new-password"
          error={errors.confirm || undefined}
          required
        />

        <Submit busy={busy} busyLabel="Updating…">
          Update Password
        </Submit>
      </form>
    </AuthShell>
  );
}
