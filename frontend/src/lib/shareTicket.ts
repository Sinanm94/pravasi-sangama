import { EVENT_NAME } from '@pravasi/shared';

/**
 * Turn the rendered pass into an image and hand it to the OS share sheet.
 *
 * The event is paperless: the agent issues a ticket and sends it to the
 * purchaser over WhatsApp before they walk away from the desk. That makes this
 * the last step of issuance, not a nice-to-have.
 */

export type ShareMethod = 'shared' | 'downloaded' | 'cancelled';

export interface ShareResult {
  method: ShareMethod;
  /** Set when the share sheet was unavailable and we fell back to download. */
  reason?: string;
}

/**
 * PNG, not JPEG. The recipient presents this at a gate, and JPEG's ringing
 * artefacts around the hard black/white edges of a QR module measurably hurt
 * decode rates on a phone screen at arm's length. A larger file is the right
 * trade when the alternative is a code that will not scan.
 */
const MIME = 'image/png';

/** Cap the raster so a 900px pass does not become a 40MB canvas on desktop. */
const MAX_SCALE = 3;

/* ------------------------------------------------------------------ */
/* Capture                                                             */
/* ------------------------------------------------------------------ */

export async function captureTicket(node: HTMLElement): Promise<Blob> {
  // Dynamic import: html2canvas is heavy and only ever needed on this action.
  const { default: html2canvas } = await import('html2canvas');

  const canvas = await html2canvas(node, {
    // Retina-sharp without unbounded memory.
    scale: Math.min(MAX_SCALE, Math.max(2, window.devicePixelRatio || 1)),
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    // The pass sits inside an overflow-x-auto container. Without these it is
    // captured clipped to the viewport on a phone — which is exactly the
    // device this feature exists for.
    width: node.scrollWidth,
    height: node.scrollHeight,
    windowWidth: Math.max(node.scrollWidth, document.documentElement.clientWidth),
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, MIME),
  );

  if (!blob) throw new Error('Could not render the ticket image');
  return blob;
}

/* ------------------------------------------------------------------ */
/* Share                                                               */
/* ------------------------------------------------------------------ */

export function ticketFileName(ticketNumber: string): string {
  return `PRAVASI-SANGAMA-2026-${ticketNumber}.png`;
}

/**
 * Share a pre-rendered blob.
 *
 * **Call this synchronously from the click handler with an already-generated
 * blob.** iOS Safari ties `navigator.share` to user activation, and an `await`
 * between the tap and the call drops that activation — the sheet then throws
 * NotAllowedError. AgentDashboard pre-renders the image when the ticket
 * appears so the tap has nothing to wait for.
 */
export async function shareTicketBlob(
  blob: Blob,
  meta: { ticketNumber: string; purchaserName: string },
): Promise<ShareResult> {
  const file = new File([blob], ticketFileName(meta.ticketNumber), {
    type: MIME,
  });

  const payload: ShareData = {
    files: [file],
    title: `${EVENT_NAME} — ${meta.ticketNumber}`,
    text: `${meta.purchaserName}, here is your ${EVENT_NAME} e-ticket (${meta.ticketNumber}). Please present the QR code at the gate.`,
  };

  // canShare with the actual files — some browsers expose navigator.share
  // but reject file payloads, and only this check catches that.
  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare(payload);

  if (!canShareFiles) {
    downloadBlob(blob, ticketFileName(meta.ticketNumber));
    return { method: 'downloaded', reason: 'Sharing is not available on this device' };
  }

  try {
    await navigator.share(payload);
    return { method: 'shared' };
  } catch (err) {
    // The user closing the sheet is a normal outcome, not a failure.
    if ((err as Error)?.name === 'AbortError') {
      return { method: 'cancelled' };
    }

    downloadBlob(blob, ticketFileName(meta.ticketNumber));
    return {
      method: 'downloaded',
      reason: 'Share sheet unavailable — saved to your device instead',
    };
  }
}

/** Capture then share. Convenient, but see the activation warning above. */
export async function shareTicket(
  node: HTMLElement,
  meta: { ticketNumber: string; purchaserName: string },
): Promise<ShareResult> {
  const blob = await captureTicket(node);
  return shareTicketBlob(blob, meta);
}

/* ------------------------------------------------------------------ */

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Text-only WhatsApp fallback for desktop, where the share sheet does not
 * exist. Cannot attach the image — WhatsApp's URL scheme takes text only —
 * so it is paired with the download, not a replacement for it.
 */
export function whatsappTextUrl(params: {
  mobile: string;
  ticketNumber: string;
  purchaserName: string;
}): string {
  const text = `${params.purchaserName}, your ${EVENT_NAME} e-ticket ${params.ticketNumber} has been issued. The ticket image follows.`;
  // Saudi numbers; adjust the country code with the deployment.
  const intl = params.mobile.length === 10 ? `966${params.mobile}` : params.mobile;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}
