import type {
  BulkSyncResponse,
  VerifyScanResponse,
} from '@pravasi/shared';
import type { QueuedScan } from './scanQueue';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/** Budget for the whole gate interaction is ~300ms; this is the hard ceiling. */
export const SCAN_TIMEOUT_MS = 1500;

/**
 * Thrown when no verdict was reached. Never for a rejection — a DUPLICATE or
 * an INVALID ticket is a settled 200 answer, not this.
 *
 * `kind` separates two cases that are both retryable but mean very different
 * things to whoever is standing at the gate:
 *
 *   OFFLINE       the request never landed — venue wifi, captive portal, a
 *                 dead uplink. Expected on event day; the queue handles it.
 *   SERVER_ERROR  the server WAS reached and answered 5xx. The network is
 *                 fine, something is broken server-side. Still queued (it may
 *                 recover), but staff must not be told "you're offline" when
 *                 they are not — that sends someone to check the router while
 *                 the real fault is elsewhere.
 */
export type ScanFailureKind = 'OFFLINE' | 'SERVER_ERROR';

export class ScanNetworkError extends Error {
  readonly kind: ScanFailureKind;

  constructor(message: string, kind: ScanFailureKind) {
    super(message);
    this.name = 'ScanNetworkError';
    this.kind = kind;
  }
}

async function post<T>(
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // JWT rides in the httpOnly cookie
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ScanNetworkError('Request did not complete', 'OFFLINE');
  } finally {
    clearTimeout(timer);
  }

  // 5xx is a server problem — retryable like a timeout, but NOT the same
  // thing as being offline, and the gate is told so. See ScanFailureKind.
  if (res.status >= 500) {
    throw new ScanNetworkError(`Server error ${res.status}`, 'SERVER_ERROR');
  }

  // 4xx is a settled answer (auth expired, malformed). Not retryable.
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const message =
      (detail as { error?: { message?: string } } | null)?.error?.message ??
      `Request failed (${res.status})`;
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export function verifyScan(body: {
  payload: string;
  client_scan_id: string;
  gate_label?: string;
}): Promise<VerifyScanResponse> {
  return post<VerifyScanResponse>('/scan/verify', body, SCAN_TIMEOUT_MS);
}

/** Batches get a longer ceiling — up to 200 scans resolve server-side. */
export function bulkSync(scans: QueuedScan[]): Promise<BulkSyncResponse> {
  return post<BulkSyncResponse>(
    '/scan/bulk-sync',
    {
      scans: scans.map(({ client_scan_id, payload, offline_scanned_at, gate_label }) => ({
        client_scan_id,
        payload,
        offline_scanned_at,
        ...(gate_label ? { gate_label } : {}),
      })),
    },
    15_000,
  );
}
