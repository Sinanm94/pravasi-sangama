'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Clock, X, MapPin, WifiOff } from 'lucide-react';
import type { ScanStatus } from '@pravasi/shared';
import { springVerdict, verdictVariants } from '@/lib/motion';

export interface ScanOutcome {
  status: ScanStatus;
  headline: string;
  detail?: string;
  /** Shown when the verdict came from the local queue, not the server. */
  pending?: boolean;
  /** Location passes get their own icon — they are not admissions. */
  isLocation?: boolean;
}

export const OVERLAY_DURATION_MS = 2500;

/**
 * Full-bleed verdict. Deliberately unmissable: a gate agent reads this at
 * arm's length, in daylight, while a queue builds behind the guest. Colour
 * carries the meaning; text confirms it.
 *
 * Now driven by `outcome` being present rather than a mount flag, so
 * AnimatePresence can play the exit before the node leaves the tree.
 */
export default function ScanResultOverlay({
  outcome,
  onDismiss,
}: {
  outcome: ScanOutcome | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!outcome) return;
    const timer = setTimeout(onDismiss, OVERLAY_DURATION_MS);
    return () => clearTimeout(timer);
  }, [outcome, onDismiss]);

  return (
    <AnimatePresence>
      {outcome && (
        <motion.button
          type="button"
          onClick={onDismiss}
          aria-live="assertive"
          variants={verdictVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.18 }}
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center px-8 text-center ${
            THEMES[outcome.status].bg
          }`}
        >
          <VerdictBody outcome={outcome} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */

function VerdictBody({ outcome }: { outcome: ScanOutcome }) {
  const theme = THEMES[outcome.status];
  const Icon = outcome.pending
    ? WifiOff
    : outcome.isLocation
      ? MapPin
      : theme.icon;

  return (
    <>
      {/* Icon with a pulse ring */}
      <div className="relative flex h-32 w-32 items-center justify-center">
        <motion.span
          className={`absolute inset-0 rounded-full ${theme.ring}`}
          initial={{ scale: 0.9, opacity: 0.5 }}
          animate={{ scale: 1.55, opacity: 0 }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
        />
        <motion.span
          className="relative flex h-32 w-32 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={springVerdict}
        >
          <Icon className="h-16 w-16 text-white" strokeWidth={3} />
        </motion.span>
      </div>

      <motion.h2
        className="mt-10 text-[34px] font-bold uppercase leading-none tracking-tight text-white"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springVerdict, delay: 0.05 }}
      >
        {outcome.headline}
      </motion.h2>

      {outcome.detail && (
        <motion.p
          className="mt-4 max-w-sm text-[17px] font-medium leading-snug text-white/85"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springVerdict, delay: 0.1 }}
        >
          {outcome.detail}
        </motion.p>
      )}

      {outcome.pending && (
        <motion.span
          className="mt-6 rounded-full bg-white/20 px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-white"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...springVerdict, delay: 0.16 }}
        >
          Pending sync
        </motion.span>
      )}

      {/* Countdown — tells the agent the overlay clears itself */}
      <span className="absolute bottom-0 left-0 h-1 w-full bg-white/20">
        <motion.span
          className="block h-full bg-white/70"
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: OVERLAY_DURATION_MS / 1000, ease: 'linear' }}
        />
      </span>

      <span className="absolute bottom-8 text-[12px] font-medium uppercase tracking-[0.16em] text-white/50">
        Tap to dismiss
      </span>
    </>
  );
}

const THEMES: Record<
  ScanStatus,
  { bg: string; ring: string; icon: typeof Check }
> = {
  SUCCESS: { bg: 'bg-emerald-600', ring: 'bg-emerald-300', icon: Check },
  DUPLICATE: { bg: 'bg-amber-500', ring: 'bg-amber-200', icon: Clock },
  INVALID: { bg: 'bg-red-700', ring: 'bg-red-300', icon: X },
};
