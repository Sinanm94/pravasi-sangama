import { get, set } from 'idb-keyval';

/**
 * The offline scan queue (CLAUDE.md §10.3).
 *
 * IndexedDB, not localStorage: it survives tab crashes, is not capped at 5MB,
 * and writes off the main thread. A gate phone that dies mid-shift must come
 * back with its queue intact.
 */

const QUEUE_KEY = 'ps.scan_queue';
const ADMITS_KEY = 'ps.local_admits';

export interface QueuedScan {
  client_scan_id: string;
  payload: string;
  offline_scanned_at: string;
  gate_label?: string;
  attempts: number;
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

export async function readQueue(): Promise<QueuedScan[]> {
  return (await get<QueuedScan[]>(QUEUE_KEY)) ?? [];
}

export async function enqueue(scan: QueuedScan): Promise<void> {
  const queue = await readQueue();
  // Same physical scan, already captured — never queue it twice.
  if (queue.some((q) => q.client_scan_id === scan.client_scan_id)) return;
  await set(QUEUE_KEY, [...queue, scan]);
}

/** Drop settled scans. Anything the server did not settle stays queued. */
export async function dropSettled(clientScanIds: string[]): Promise<void> {
  if (clientScanIds.length === 0) return;
  const settled = new Set(clientScanIds);
  const queue = await readQueue();
  await set(
    QUEUE_KEY,
    queue.filter((q) => !settled.has(q.client_scan_id)),
  );
}

export async function markAttempted(clientScanIds: string[]): Promise<void> {
  const attempted = new Set(clientScanIds);
  const queue = await readQueue();
  await set(
    QUEUE_KEY,
    queue.map((q) =>
      attempted.has(q.client_scan_id) ? { ...q, attempts: q.attempts + 1 } : q,
    ),
  );
}

export async function queueSize(): Promise<number> {
  return (await readQueue()).length;
}

/* ------------------------------------------------------------------ */
/* Local admissions — same-device offline dedupe                       */
/* ------------------------------------------------------------------ */

/**
 * Catches the same code being scanned twice on THIS device while offline.
 * It cannot catch a second device — that is the accepted limitation in §10.4,
 * resolved server-side at sync time.
 */
export async function recordLocalAdmit(payload: string): Promise<void> {
  const admits = (await get<Record<string, string>>(ADMITS_KEY)) ?? {};
  admits[payload] = new Date().toISOString();
  await set(ADMITS_KEY, admits);
}

export async function localAdmitAt(payload: string): Promise<string | null> {
  const admits = (await get<Record<string, string>>(ADMITS_KEY)) ?? {};
  return admits[payload] ?? null;
}
