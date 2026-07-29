import { captureTicket, ticketFileName } from './shareTicket';

/**
 * PDF export.
 *
 * The page is sized to the captured image exactly — no A4 letterboxing. A
 * ticket printed with 40mm of white above it looks like a screenshot someone
 * pasted into a document; a page cut to the pass looks like a pass.
 */

export interface TicketMeta {
  ticketNumber: string;
  purchaserName: string;
}

/** Same reasoning as the share image: PNG keeps QR module edges hard. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read ticket image'));
    reader.readAsDataURL(blob);
  });
}

/* ------------------------------------------------------------------ */

export async function ticketPdfBlob(
  blob: Blob,
  meta: TicketMeta,
): Promise<Blob> {
  // Dynamic import — jsPDF is ~350kB and only needed on this action.
  const { jsPDF } = await import('jspdf');

  const dataUrl = await blobToDataUrl(blob);

  // Read the true raster size; the capture is scaled by devicePixelRatio.
  const { width, height } = await new Promise<{
    width: number;
    height: number;
  }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not measure ticket image'));
    img.src = dataUrl;
  });

  const doc = new jsPDF({
    orientation: width >= height ? 'landscape' : 'portrait',
    unit: 'px',
    // Page IS the ticket. hotfix keeps px units honest across jsPDF versions.
    format: [width, height],
    hotfixes: ['px_scaling'],
    compress: true,
  });

  doc.setProperties({
    title: `Pravasi Sangama 2026 — ${meta.ticketNumber}`,
    subject: 'E-Ticket',
    author: 'Karnataka Cultural Foundation',
    creator: 'Pravasi Sangama 2026',
  });

  // FAST compression would re-encode and soften the QR edges. NONE keeps the
  // modules crisp; the file is a single image either way.
  doc.addImage(dataUrl, 'PNG', 0, 0, width, height, undefined, 'NONE');

  return doc.output('blob');
}

/** Capture → PDF → download, in one call. */
export async function downloadTicketPDF(
  node: HTMLElement,
  meta: TicketMeta,
): Promise<void> {
  const image = await captureTicket(node);
  await downloadTicketPDFFromBlob(image, meta);
}

/** Same, when the image has already been captured (the usual case). */
export async function downloadTicketPDFFromBlob(
  image: Blob,
  meta: TicketMeta,
): Promise<void> {
  const pdf = await ticketPdfBlob(image, meta);
  const filename = ticketFileName(meta.ticketNumber).replace(/\.png$/, '.pdf');

  const url = URL.createObjectURL(pdf);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
