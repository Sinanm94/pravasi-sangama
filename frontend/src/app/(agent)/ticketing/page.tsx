'use client';

import { useRouter } from 'next/navigation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AgentDashboard from '@/components/agent/AgentDashboard';
import { useAuthStore } from '@/store/useAuthStore';

/** Served at `/ticketing` — `(agent)` is a route group, not a URL segment. */
export default function TicketingPage() {
  return (
    <ProtectedRoute allow={['AGENT']}>
      <TicketingScreen />
    </ProtectedRoute>
  );
}

function TicketingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.userData);

  // ProtectedRoute has already resolved a bound AGENT session, so these are
  // present. The fallbacks exist so a partial hydration renders a labelled
  // dash rather than "undefined" on a printed ticket.
  const agent = {
    name: user?.agentName ?? '—',
    mobile: user?.agentMobile ?? '—',
    sector: user?.unitSector ?? '—',
    unit: user?.unitName ?? '—',
  };

  /* Back belongs to the ledger the agent came from, not the gate scanner —
   * issuing a ticket and scanning one are different jobs, and /scanner is a
   * dead end for someone at a registration desk. */
  return (
    <AgentDashboard agent={agent} onBack={() => router.push('/agent/dashboard')} />
  );
}
