'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { AuthRole } from '@pravasi/shared';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * The second protection layer.
 *
 * `middleware.ts` decides quickly from an *unverified* cookie payload. This
 * one waits for `GET /api/auth/session`, which the API validated against the
 * real signature, and redirects on mismatch. It also covers client-side
 * navigations, which middleware does not always intercept.
 *
 * Neither layer protects data — the API does. Both exist so a user never sits
 * looking at a screen they cannot use.
 */
export default function ProtectedRoute({
  allow,
  children,
}: {
  allow: AuthRole[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const role = useAuthStore((s) => s.role);
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    if (status === 'idle') void hydrate();
  }, [status, hydrate]);

  const permitted = role !== null && allow.includes(role);

  useEffect(() => {
    if (status !== 'ready' || permitted) return;

    const url = new URL('/login', window.location.origin);
    url.searchParams.set('next', window.location.pathname);
    if (role === 'UNIT_PENDING') url.searchParams.set('step', 'agent');

    router.replace(`${url.pathname}${url.search}`);
  }, [status, permitted, role, router]);

  // Render nothing decisive until the verified session is known — flashing a
  // dashboard and yanking it away is worse than a moment of spinner.
  if (status !== 'ready' || !permitted) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  return <>{children}</>;
}
