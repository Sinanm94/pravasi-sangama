/**
 * Print / Save-as-PDF for the pass.
 *
 * This replaces the html2canvas → jsPDF path, which rasterised the ticket and
 * embedded it as a single PNG. That produced a PDF whose text was pixels: it
 * did not scale, could not be selected or searched, and — because html2canvas
 * approximates line boxes rather than implementing CSS layout — clipped
 * descenders and mis-centred every badge no matter how the padding was tuned.
 *
 * `window.print()` hands the job to the browser's own layout and PDF engine.
 * Text stays vector, the QR codes stay vector SVG (which is what actually
 * matters at a gate, since a rasterised code loses module edges when the
 * printer halftones it), and nothing needs compensating for.
 *
 * html2canvas is still the right tool for the PNG the agent sends over
 * WhatsApp — there the output IS an image, so a rasteriser is not a
 * compromise. See lib/shareTicket.ts.
 */

/** Marks the document while printing; the @media print rules key off this. */
const PRINTING_ATTR = 'data-printing';

export interface PrintTicketMeta {
  ticketNumber: string;
  purchaserName: string;
}

/** Keep the suggested filename readable in a file picker. */
const MAX_NAME_CHARS = 40;

/**
 * Build the string the browser will offer as the PDF filename.
 *
 * Chrome, Firefox and Safari all seed "Save as PDF" from `document.title`,
 * so the title IS the filename — which means it has to survive being written
 * to a filesystem:
 *
 *   - `\ / : * ? " < > |` are illegal on Windows and would be silently
 *     mangled or dropped. A purchaser named `Anand K/V` is not exotic.
 *   - Leading dots produce hidden files on Unix.
 *   - Spaces are legal but make a shell-hostile filename, and the ticket
 *     number is already hyphenated, so hyphens keep it consistent.
 *
 * Non-Latin scripts are preserved deliberately: this event's purchasers are
 * Kannada and Malayalam speakers, and every modern filesystem is UTF-8. The
 * filter removes only what is genuinely unsafe, not everything unfamiliar.
 */
export function printTitleFor(meta: PrintTicketMeta): string {
  const clean = (value: string) =>
    value
      // Filesystem-reserved characters, plus control characters.
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
      // Before the control-char strip, so a tab or newline separates words
      // rather than silently joining them ("Ravi\tKumar" -> "Ravi-Kumar").
      .replace(/\s+/g, '-')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      // Collapse runs of separators left behind by the removals above.
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '');

  const name = clean(meta.purchaserName).slice(0, MAX_NAME_CHARS);
  const number = clean(meta.ticketNumber);

  // A ticket with an unnamed or fully-stripped purchaser still gets a unique
  // filename — the ticket number is the part that identifies the booking.
  return ['PRAVASI-SANGAMA', number, name].filter(Boolean).join('-');
}

/**
 * Isolate the pass and open the browser's print dialog.
 *
 * Pass `meta` so the saved PDF is named for its ticket. Without it every
 * download lands as the page's own title, so a desk that issues fifty passes
 * ends up with fifty files of the same name.
 *
 * Resolves once printing is done or dismissed. There is no way to learn
 * whether the user actually saved a file — the browser deliberately does not
 * report that — so callers must not claim success, only that the dialog was
 * opened.
 */
export function printTicket(meta?: PrintTicketMeta): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  const root = document.documentElement;
  root.setAttribute(PRINTING_ATTR, 'ticket');

  /* Captured BEFORE the swap and restored in cleanup, which runs on both the
   * afterprint path and the timeout fallback. If this leaked, the tab would
   * keep a ticket number as its title for the rest of the session. */
  const originalTitle = document.title;
  if (meta) document.title = printTitleFor(meta);

  return new Promise<void>((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      document.title = originalTitle;
      root.removeAttribute(PRINTING_ATTR);
      window.removeEventListener('afterprint', cleanup);
      resolve();
    };

    window.addEventListener('afterprint', cleanup);

    /* Two frames before printing. One is not enough: the attribute flips a
     * stylesheet that re-lays-out the whole page, and Chrome will snapshot
     * mid-recalculation if print() is called in the same frame — which shows
     * up as a blank first page. */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          window.print();
        } finally {
          /* Safari fires afterprint unreliably, and not at all if the dialog
           * is dismissed with Escape. Without this the page would stay in its
           * print-isolated state — everything invisible but the ticket. */
          setTimeout(cleanup, 1000);
        }
      });
    });
  });
}
