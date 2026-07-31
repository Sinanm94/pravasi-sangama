'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * Entry point. Resolves the verified session, then sends the user to the one
 * screen their role can actually use.
 */
export default function RootPage() {
  const router = useRouter();
  const role = useAuthStore((s) => s.role);
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    if (status === 'idle') void hydrate();
  }, [status, hydrate]);

  useEffect(() => {
    if (status !== 'ready') return;

    if (role === 'SUPERUSER') router.replace('/dashboard');
    else if (role === 'AGENT') router.replace('/agent/dashboard');
    else router.replace('/login');
  }, [status, role, router]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50">
      <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
    </div>
  );
}
