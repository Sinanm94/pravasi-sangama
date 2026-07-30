'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import GateScanner from '@/components/scanner/GateScanner';
import { useAuthStore } from '@/store/useAuthStore';
import { apiPost } from '@/lib/apiClient';

/** Served at `/scanner`. Supports `?gate=GATE-2` to label the post. */
export default function ScannerPage() {
  return (
    <ProtectedRoute allow={['AGENT', 'SCANNER']}>
      <Suspense fallback={null}>
        <ScannerScreen />
      </Suspense>
    </ProtectedRoute>
  );
}

function ScannerScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.userData);
  const logout = useAuthStore((s) => s.logout);

  const isGateSession = role === 'SCANNER';

  /* A gate session already knows which door it is — that is the whole point
   * of the gate account. An agent scanning between registrations does not,
   * so `?gate=GATE-2` still labels their scans. Either way `gate_label` is
   * what makes a duplicate burst traceable to a physical door (§10.1). */
  const gateLabel = isGateSession
    ? (user?.gateCode ?? undefined)
    : (params.get('gate') ?? undefined);

  const heading = isGateSession
    ? (user?.gateName ?? 'Gate')
    : [user?.unitSector, user?.unitName].filter(Boolean).join(' · ') ||
      (user?.unitName ?? 'Gate');

  return (
    <GateScanner
      unitName={heading}
      gateLabel={gateLabel}
      /* A gate account has nowhere else in the app to go, so its exit is a
         sign-out back to the gate door — not a jump to /ticketing, which it
         cannot open. */
      onExit={async () => {
        if (!isGateSession) {
          router.push('/ticketing');
          return;
        }
        await apiPost('/auth/logout').catch(() => {});
        logout();
        router.replace('/scanner/login');
      }}
    />
  );
}
