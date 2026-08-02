'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Check,
  Download,
  Printer,
  Loader2,
  Mail,
  MessageCircle,
  Send,
  X,
} from 'lucide-react';
import { printTicket } from '@/lib/printTicket';
import { shareTicketBlob, ticketFileName, whatsappTextUrl } from '@/lib/shareTicket';
import {
  backdropVariants,
  fade,
  fieldErrorVariants,
  sheetVariants,
  springSnappy,
  springSurface,
} from '@/lib/motion';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export interface ShareTicketMeta {
  ticketId: string;
  ticketNumber: string;
  purchaserName: string;
  purchaserMobile: string;
  purchaserEmail?: string | null;
}

interface ShareTicketModalProps {
  open: boolean;
  meta: ShareTicketMeta;
  /** Resolves the captured PNG. Pre-warmed by AgentDashboard. */
  getImageBlob: () => Promise<Blob>;
  onClose: () => void;
  /** Close and reset the desk for the next customer. */
  onDone: () => void;
}

type Action = 'whatsapp' | 'pdf' | 'image' | null;
type EmailState = 'idle' | 'sending' | 'sent' | 'error';

/* ------------------------------------------------------------------ */

export default function ShareTicketModal({
  open,
  meta,
  getImageBlob,
  onClose,
  onDone,
}: ShareTicketModalProps) {
  const [busy, setBusy] = useState<Action>(null);

  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState(meta.purchaserEmail ?? '');
  const [emailState, setEmailState] = useState<EmailState>('idle');
  const [emailError, setEmailError] = useState<string | null>(null);

  const emailInputRef = useRef<HTMLInputElement>(null);

  /** Sheet below sm:, modal above. Drives which variant the panel uses. */
  const [isSheet, setIsSheet] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const sync = () => setIsSheet(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  /* --- Escape + body scroll lock ---------------------------------- */
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (emailOpen) emailInputRef.current?.focus();
  }, [emailOpen]);

  /* --- Actions ---------------------------------------------------- */

  const handleWhatsApp = useCallback(async () => {
    setBusy('whatsapp');

    try {
      const blob = await getImageBlob();
      const result = await shareTicketBlob(blob, {
        ticketNumber: meta.ticketNumber,
        purchaserName: meta.purchaserName,
      });

      if (result.method === 'downloaded') {
        /* Desktop has no share sheet and no way to attach a file to a wa.me
         * link. The image is downloaded, then WhatsApp Web opens with the
         * message pre-filled — the agent attaches the saved file. Clunky, but
         * it is the only path that exists on desktop. */
        window.open(
          whatsappTextUrl({
            mobile: meta.purchaserMobile,
            ticketNumber: meta.ticketNumber,
            purchaserName: meta.purchaserName,
          }),
          '_blank',
          'noopener,noreferrer',
        );
        toast.info('Image saved to your device', {
          description: 'Attach it in the WhatsApp tab that just opened.',
          duration: 6000, // a two-step instruction needs longer to read
        });
      } else if (result.method === 'shared') {
        toast.success('Ticket shared');
      }
      // 'cancelled' — the agent closed the sheet. Say nothing.
    } catch {
      toast.error('Could not prepare the ticket image');
    } finally {
      setBusy(null);
    }
  }, [getImageBlob, meta]);

  /**
   * Hands off to the browser's print dialog, where "Save as PDF" is a
   * destination. No capture, no jsPDF — the PDF is produced by the same
   * engine that laid the page out, so its text and QR codes stay vector.
   *
   * Deliberately no success toast: the browser does not report whether the
   * user saved, printed or cancelled, and claiming "PDF saved" after a
   * dismissed dialog would be a lie the agent acts on.
   */
  const handlePrint = useCallback(async () => {
    setBusy('pdf');
    try {
      // meta drives the suggested PDF filename via document.title.
      await printTicket({
        ticketNumber: meta.ticketNumber,
        purchaserName: meta.purchaserName,
      });
    } catch {
      toast.error('Could not open the print dialog');
    } finally {
      setBusy(null);
    }
  }, [meta]);

  const handleImage = useCallback(async () => {
    setBusy('image');
    try {
      const blob = await getImageBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = ticketFileName(meta.ticketNumber);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('Image saved', { description: meta.ticketNumber });
    } catch {
      toast.error('Could not save the image');
    } finally {
      setBusy(null);
    }
  }, [getImageBlob, meta]);

  const handleEmail = useCallback(async () => {
    if (!email.trim() || emailState === 'sending') return;

    setEmailState('sending');
    setEmailError(null);

    try {
      const blob = await getImageBlob();
      const base64 = await blobToBase64(blob);

      const res = await fetch(`${API_BASE}/tickets/share/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ticket_id: meta.ticketId,
          email_address: email.trim(),
          base64_image: base64,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? 'Could not send the email.');
      }

      setEmailState('sent');
      toast.success('Email sent', { description: email.trim() });
    } catch (err) {
      setEmailState('error');
      setEmailError((err as Error).message);
      toast.error('Could not send the email', {
        description: (err as Error).message,
      });
    }
  }, [email, emailState, getImageBlob, meta.ticketId]);

  /* ---------------------------------------------------------------- */

  return (
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Share ticket"
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        >
          {/* Backdrop */}
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={fade}
            className="absolute inset-0 bg-gray-900/25 backdrop-blur-[2px]"
          />

          {/* Sheet on mobile, modal on desktop */}
          <motion.div
            custom={isSheet}
            variants={sheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={springSurface}
            className="relative w-full max-w-md rounded-t-3xl border border-white/60 bg-white/80 shadow-[0_-8px_40px_rgb(0,0,0,0.12)] backdrop-blur-xl sm:rounded-3xl sm:shadow-[0_20px_60px_rgb(0,0,0,0.18)]"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
        {/* Grab handle — mobile affordance only */}
        <div className="flex justify-center pt-3 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        <header className="flex items-start justify-between gap-3 px-6 pb-1 pt-4 sm:pt-6">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-gray-900">
              Share Ticket
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-gray-500">
              {meta.purchaserName} · {meta.ticketNumber}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-900/5 hover:text-gray-700 active:scale-95"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </header>

        <div className="px-4 pb-4 pt-3">
          <div className="overflow-hidden rounded-2xl bg-white/70">
            <Option
              icon={MessageCircle}
              tint="bg-emerald-50 text-emerald-600"
              label="WhatsApp"
              hint="Opens your share sheet"
              busy={busy === 'whatsapp'}
              onClick={handleWhatsApp}
            />

            <Divider />

            {/* Email expands in place rather than pushing to a second screen —
                one less navigation at a busy desk. */}
            <div>
              <Option
                icon={emailState === 'sent' ? Check : Mail}
                tint={
                  emailState === 'sent'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-sky-50 text-sky-600'
                }
                label={emailState === 'sent' ? 'Sent!' : 'Send Email'}
                hint={
                  emailState === 'sent'
                    ? `Delivered to ${email}`
                    : 'Attach and send the ticket'
                }
                expanded={emailOpen}
                onClick={() => {
                  if (emailState === 'sent') return;
                  setEmailOpen((v) => !v);
                }}
              />

              {/* Height animates so the sheet grows into the field rather
                  than snapping — the layout shift is the interaction. */}
              <AnimatePresence initial={false}>
              {emailOpen && emailState !== 'sent' && (
                <motion.div
                  key="email-field"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springSurface}
                  className="overflow-hidden"
                >
                <div className="px-4 pb-4">
                  <div className="flex gap-2">
                    <input
                      ref={emailInputRef}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (emailState === 'error') setEmailState('idle');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleEmail();
                      }}
                      placeholder="name@example.com"
                      className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-[15px] text-gray-900 placeholder:text-gray-400 transition-all duration-200 focus:border-[#5E17EB]/40 focus:outline-none focus:ring-4 focus:ring-[#5E17EB]/10"
                    />
                    <button
                      type="button"
                      onClick={handleEmail}
                      disabled={!email.trim() || emailState === 'sending'}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#5E17EB] px-4 py-3 text-[13px] font-semibold text-white transition-all duration-200 hover:bg-[#2E0775] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
                    >
                      {emailState === 'sending' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" strokeWidth={2.25} />
                      )}
                      Send
                    </button>
                  </div>

                  <AnimatePresence initial={false}>
                    {emailError && (
                      <motion.p
                        key="email-error"
                        variants={fieldErrorVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        transition={springSnappy}
                        className="overflow-hidden text-[12px] text-red-600"
                      >
                        <span className="block pt-2">{emailError}</span>
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                </motion.div>
              )}
              </AnimatePresence>
            </div>

            <Divider />

            <Option
              icon={Printer}
              tint="bg-[#5E17EB]/[0.07] text-[#5E17EB]"
              label="Print / Save as PDF"
              hint="Opens the print dialog — choose Save as PDF"
              busy={busy === 'pdf'}
              onClick={handlePrint}
            />

            <Divider />

            <Option
              icon={Download}
              tint="bg-gray-100 text-gray-600"
              label="Save as Image"
              hint="PNG to this device"
              busy={busy === 'image'}
              onClick={handleImage}
            />
          </div>

          <button
            type="button"
            onClick={onDone}
            className="mt-4 w-full rounded-2xl bg-gray-900 px-6 py-3.5 text-[14px] font-semibold text-white transition-all duration-200 hover:bg-gray-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-gray-900/15 active:scale-[0.98]"
          >
            Done
          </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */

function Option({
  icon: Icon,
  tint,
  label,
  hint,
  busy,
  expanded,
  onClick,
}: {
  icon: typeof Mail;
  tint: string;
  label: string;
  hint: string;
  busy?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-expanded={expanded}
      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors duration-200 hover:bg-gray-900/[0.03] active:bg-gray-900/[0.05] disabled:opacity-60"
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tint}`}
      >
        {busy ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin" />
        ) : (
          <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-gray-900">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-gray-400">
          {hint}
        </span>
      </span>
    </button>
  );
}

function Divider() {
  return <div className="ml-[4.375rem] h-px bg-gray-900/[0.06]" />;
}

/* ------------------------------------------------------------------ */

/** Strips the `data:image/png;base64,` prefix — the API wants bare base64. */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the ticket image'));
    reader.readAsDataURL(blob);
  });
}
