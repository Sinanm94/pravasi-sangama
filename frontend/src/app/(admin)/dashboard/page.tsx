'use client';

import ProtectedRoute from '@/components/auth/ProtectedRoute';
import SuperuserDashboard from '@/components/admin/SuperuserDashboard';

/**
 * `(admin)` is a route group — it produces no URL segment, so this page is
 * served at `/dashboard`. That is the path `middleware.ts` matches on.
 */
export default function DashboardPage() {
  return (
    <ProtectedRoute allow={['SUPERUSER']}>
      <SuperuserDashboard />
    </ProtectedRoute>
  );
}
