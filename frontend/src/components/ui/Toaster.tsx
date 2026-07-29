'use client';

import { Toaster as Sonner } from 'sonner';

/**
 * Glassmorphic toasts.
 *
 * Positioned **top-center**: the agent screens put their primary action at the
 * bottom of the viewport (Save Registration, Share Ticket, the scanner's queue
 * bar), and a bottom toast would cover the control the user is reaching for.
 *
 * Toasts are for transient outcomes — a wrong PIN, an email sent. Persistent
 * state (offline, pending sync, reconnecting) stays inline where it can be
 * read at any moment, never in something that disappears.
 */
export default function Toaster() {
  return (
    <Sonner
      position="top-center"
      duration={3500}
      gap={10}
      visibleToasts={3}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-full items-start gap-3 rounded-2xl border border-white/60 bg-white/80 p-4 shadow-[0_12px_40px_rgb(0,0,0,0.10)] backdrop-blur-xl font-sans',
          title: 'text-[13px] font-semibold text-gray-900 leading-snug',
          description: 'mt-0.5 text-[12px] leading-snug text-gray-500',
          icon: 'shrink-0 mt-0.5',
          closeButton:
            'rounded-full bg-white/80 border border-gray-200 text-gray-500',
          // Tint the surface by intent while keeping the glass treatment.
          success: '!bg-emerald-50/85 !border-emerald-200/70',
          error: '!bg-red-50/90 !border-red-200/70',
          warning: '!bg-amber-50/90 !border-amber-200/70',
          info: '!bg-white/85',
        },
      }}
    />
  );
}
