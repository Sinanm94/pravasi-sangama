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

/**
 * Isolate the pass and open the browser's print dialog.
 *
 * Resolves once printing is done or dismissed. There is no way to learn
 * whether the user actually saved a file — the browser deliberately does not
 * report that — so callers must not claim success, only that the dialog was
 * opened.
 */
export function printTicket(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  const root = document.documentElement;
  root.setAttribute(PRINTING_ATTR, 'ticket');

  return new Promise<void>((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
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
