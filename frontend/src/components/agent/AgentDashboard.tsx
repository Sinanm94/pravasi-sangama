'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { Check, Plus, Share2 } from 'lucide-react';
import {
  EVENT_DATE_LABEL,
  ORGANISATION_NAME,
  EVENT_NAME,
  type IssueTicketInput,
  type IssueTicketResponse,
} from '@pravasi/shared';
import NewRegistrationForm, {
  type AgentContext,
} from '@/components/registration/NewRegistrationForm';
import TicketReceipt, {
  type TicketData,
} from '@/components/ticket/TicketReceipt';
import { captureTicket } from '@/lib/shareTicket';
import { screenVariants, springSurface } from '@/lib/motion';
import ShareTicketModal from './ShareTicketModal';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

type Phase = 'form' | 'issued';

interface AgentDashboardProps {
  agent: AgentContext;
  onBack?: () => void;
}

/* ------------------------------------------------------------------ */

export default function AgentDashboard({ agent, onBack }: AgentDashboardProps) {
  const [phase, setPhase] = useState<Phase>('form');
  const [issued, setIssued] = useState<IssueTicketResponse | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const ticketRef = useRef<HTMLElement | null>(null);
  /** Pre-rendered image, so the share tap does not have to wait. */
  const blobRef = useRef<Blob | null>(null);

  /* ---------------------------------------------------------------- */
  /* Issue                                                             */
  /* ---------------------------------------------------------------- */

  const handleSubmit = useCallback(async (payload: IssueTicketInput) => {
    let res: Response;

    try {
      res = await fetch(`${API_BASE}/tickets/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
    } catch {
      // Distinct from a rejection: nothing reached the server, so the agent
      // should retry rather than change the data.
      toast.error('No connection to the server', {
        description: 'The registration was not saved. Try again.',
      });
      throw new Error('Network error');
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string; code?: string; details?: unknown };
      } | null;

      /* Server rejections — duplicate mobile, unit quota, expired session —
       * surface here rather than failing silently. */
      if (body?.error?.code === 'AGENT_NOT_BOUND') {
        toast.error('Session expired', {
          description: 'Sign in again to continue issuing tickets.',
          duration: 8000, // requires an action, so it stays longer
        });
      } else if (body?.error?.code === 'VALIDATION_ERROR') {
        toast.error('Check the form', {
          description:
            (body.error.details as Array<{ message?: string }> | undefined)?.[0]
              ?.message ?? 'Some fields need attention.',
        });
      } else {
        toast.error('Could not issue the ticket', {
          description: body?.error?.message ?? 'Please try again.',
        });
      }

      // Rethrow so the form clears its own submitting state.
      throw new Error(body?.error?.message ?? 'Issue failed');
    }

    const data = (await res.json()) as IssueTicketResponse;

    blobRef.current = null;
    setIssued(data);
    setPhase('issued');

    toast.success('Ticket issued', { description: data.ticket.ticket_number });
  }, []);

  const handleReset = useCallback(() => {
    blobRef.current = null;
    setIssued(null);
    setShareOpen(false);
    setPhase('form');
  }, []);

  /* ---------------------------------------------------------------- */
  /* Share                                                             */
  /* ---------------------------------------------------------------- */

  /* Pre-render the image as soon as the pass is on screen.
   *
   * iOS Safari ties navigator.share to user activation — an await between
   * the tap and the call drops it and the sheet throws NotAllowedError. By
   * the time the agent reaches for the button the blob is usually ready, so
   * the tap can share immediately. */
  useEffect(() => {
    if (phase !== 'issued') return;

    let cancelled = false;
    const timer = setTimeout(() => {
      const node = ticketRef.current;
      if (!node) return;

      void captureTicket(node)
        .then((blob) => {
          if (!cancelled) blobRef.current = blob;
        })
        .catch(() => {
          // Not fatal — the share handler will render on demand instead.
          blobRef.current = null;
        });
    }, 350); // let fonts settle and the pass paint first

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, issued]);

  /**
   * The one source of the captured image for every share option. Returns the
   * pre-warmed blob when ready, renders on demand when not, and caches either
   * way — so PDF, email and download never re-rasterise the same pass.
   */
  const getImageBlob = useCallback(async (): Promise<Blob> => {
    if (blobRef.current) return blobRef.current;

    const node = ticketRef.current;
    if (!node) throw new Error('Ticket is not rendered');

    const blob = await captureTicket(node);
    blobRef.current = blob;
    return blob;
  }, []);

  /* ---------------------------------------------------------------- */

  if (phase === 'form' || !issued) {
    return (
      /* mode="wait" — the form must finish leaving before the pass arrives.
         Two full-width screens cross-fading on top of each other reads as a
         glitch, not a transition. */
      <AnimatePresence mode="wait">
        <motion.div
          key="form"
          variants={screenVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={springSurface}
        >
          <NewRegistrationForm
            agent={agent}
            onBack={onBack}
            onSubmit={handleSubmit}
          />
        </motion.div>
      </AnimatePresence>
    );
  }

  const ticket = toTicketData(issued);

  return (
    <motion.div
      key="issued"
      variants={screenVariants}
      initial="hidden"
      animate="visible"
      transition={springSurface}
      className="min-h-dvh bg-gray-50 px-4 pb-12 pt-8 font-sans antialiased sm:px-6 sm:pt-12 print:bg-white print:pb-0"
    >
      <div className="mx-auto w-full max-w-5xl">
        {/* Confirmation */}
        <motion.div
          className="flex items-center justify-center gap-2 print:hidden"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...springSurface, delay: 0.08 }}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100">
            <Check className="h-3.5 w-3.5 text-emerald-700" strokeWidth={3} />
          </span>
          <p className="text-[14px] font-medium text-emerald-700">
            Ticket issued — {issued.ticket.ticket_number}
          </p>
        </motion.div>

        {/* The pass */}
        <motion.div
          className="mt-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSurface, delay: 0.12 }}
        >
          <TicketReceipt
            ticket={ticket}
            qrPayloads={issued.qr_codes}
            embedded
            ticketRef={ticketRef}
          />
        </motion.div>

        {/* Actions */}
        <motion.div
          className="mt-8 space-y-3 print:hidden"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springSurface, delay: 0.18 }}
        >
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-emerald-600 px-6 py-4 text-[14px] font-semibold uppercase tracking-[0.06em] text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/20 active:scale-[0.98]"
          >
            <Share2 className="h-[18px] w-[18px]" strokeWidth={2.25} />
            Share Ticket
          </button>

          <button
            type="button"
            onClick={handleReset}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-100 px-6 py-4 text-[14px] font-semibold uppercase tracking-[0.06em] text-gray-700 transition-all duration-200 hover:bg-gray-200/80 hover:text-gray-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-gray-900/10 active:scale-[0.98]"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} />
            Issue Another Ticket
          </button>

          {/* The raw payloads exist only in this response (§4.4). Once the
              agent leaves this screen they are gone, and a lost ticket means
              reissuing with new codes. */}
          <p className="pt-2 text-center text-[11px] leading-relaxed text-gray-400">
            Share or save this ticket before issuing another — the QR codes
            cannot be recovered afterwards.
          </p>
        </motion.div>
      </div>

      <ShareTicketModal
        open={shareOpen}
        meta={{
          ticketId: issued.ticket.id,
          ticketNumber: issued.ticket.ticket_number,
          purchaserName: issued.ticket.purchaser_name,
          purchaserMobile: issued.ticket.purchaser_mobile,
          purchaserEmail: issued.ticket.purchaser_email,
        }}
        getImageBlob={getImageBlob}
        onClose={() => setShareOpen(false)}
        onDone={handleReset}
      />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

/** API wire shape (snake_case) → the pass's display model. */
function toTicketData(response: IssueTicketResponse): TicketData {
  const t = response.ticket;

  return {
    requestNumber: t.request_number,
    ticketNumber: t.ticket_number,
    ticketType: t.ticket_type,
    purchaserName: t.purchaser_name,
    mobile: t.purchaser_mobile,
    email: t.purchaser_email,
    eventDate: EVENT_DATE_LABEL,
    organization: ORGANISATION_NAME,
    eventName: EVENT_NAME,
  };
}
