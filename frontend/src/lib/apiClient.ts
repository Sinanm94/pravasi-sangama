const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface ApiErrorBody {
  error?: { message?: string; code?: string; details?: unknown };
}

/**
 * Carries the server's machine `code` alongside the message.
 *
 * Callers branch on the code, never on message text — `AGENT_PENDING_APPROVAL`
 * and a bad password are both "sign in failed" to a string matcher, and they
 * need completely different words in front of an agent.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Omit, not intersect: RequestInit already declares `body: BodyInit`, and an
// intersection with `unknown` collapses to something fetch will not accept.
async function request<T>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown },
): Promise<T> {
  const { body, ...rest } = init;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      // The session JWT rides in an httpOnly cookie, so every call needs this.
      credentials: 'include',
      headers:
        body === undefined
          ? rest.headers
          : { 'Content-Type': 'application/json', ...(rest.headers ?? {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    // Distinct from a rejection: nothing reached the server.
    throw new ApiError('No connection to the server.', 0, 'NETWORK_ERROR');
  }

  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => null)) as (T & ApiErrorBody) | null;

  if (!res.ok) {
    throw new ApiError(
      data?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      data?.error?.code,
      data?.error?.details,
    );
  }

  return data as T;
}

export const apiGet = <T>(path: string) => request<T>(path, { method: 'GET' });

export const apiPost = <T = unknown>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body });

/**
 * For an endpoint that returns a file (CSV, ...) rather than JSON —
 * `request()`/`apiGet` always call `res.json()`, which would throw on a CSV
 * body and swallow it via the `.catch(() => null)` fallback, silently
 * discarding the whole download.
 *
 * Reads the filename from `Content-Disposition` rather than hardcoding it a
 * second time on the client — the server is the one place that decides what
 * the file is called. `fallbackFilename` only covers a response that is
 * missing the header entirely, which should not happen against this API.
 */
export async function apiDownload(
  path: string,
  fallbackFilename: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  } catch {
    throw new ApiError('No connection to the server.', 0, 'NETWORK_ERROR');
  }

  if (!res.ok) {
    // A failed export still returns the same { error: {...} } JSON shape as
    // every other endpoint — only a 200 here is actually a CSV body.
    const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      data?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      data?.error?.code,
      data?.error?.details,
    );
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="?([^"; ]+)"?/i.exec(disposition)?.[1] ?? fallbackFilename;

  // The standard trick for a JS-triggered download: an off-DOM anchor with
  // `download` set, clicked programmatically, then torn down immediately.
  // No React state involved — this element never renders.
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

/** Message for a toast. Never assume the caller checked the type. */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Something went wrong.';

export const errorCode = (err: unknown): string | undefined =>
  err instanceof ApiError ? err.code : undefined;

/** 0 for a request that never reached the server. */
export const errorStatus = (err: unknown): number =>
  err instanceof ApiError ? err.status : -1;
