import type {
  BulkSyncResponse,
  VerifyScanResponse,
} from '@pravasi/shared';
import type { QueuedScan } from './scanQueue';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/** Budget for the whole gate interaction is ~300ms; this is the hard ceiling. */
export const SCAN_TIMEOUT_MS = 1500;

/** Thrown when the network failed to produce a verdict. Never for a rejection. */
export class ScanNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanNetworkError';
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
    throw new ScanNetworkError('Request did not complete');
  } finally {
    clearTimeout(timer);
  }

  // 5xx is a server problem — retryable, same as a timeout.
  if (res.status >= 500) {
    throw new ScanNetworkError(`Server error ${res.status}`);
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
