'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import GateScanner from '@/components/scanner/GateScanner';
import { useAuthStore } from '@/store/useAuthStore';

/** Served at `/scanner`. Supports `?gate=GATE-2` to label the post. */
export default function ScannerPage() {
  return (
    <ProtectedRoute allow={['AGENT']}>
      <Suspense fallback={null}>
        <ScannerScreen />
      </Suspense>
    </ProtectedRoute>
  );
}

function ScannerScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const user = useAuthStore((s) => s.userData);

  const unitName = [user?.unitSector, user?.unitName]
    .filter(Boolean)
    .join(' · ');

  /* Gate label comes from the URL, not the profile: one unit can staff
   * several gates, and `scan_logs.gate_label` is what makes a duplicate
   * burst traceable to a physical door (§10.1). */
  const gateLabel = params.get('gate') ?? undefined;

  return (
    <GateScanner
      unitName={unitName || (user?.unitName ?? 'Gate')}
      gateLabel={gateLabel}
      onExit={() => router.push('/ticketing')}
    />
  );
}
