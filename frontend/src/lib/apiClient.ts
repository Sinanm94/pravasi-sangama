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

/** Message for a toast. Never assume the caller checked the type. */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Something went wrong.';

export const errorCode = (err: unknown): string | undefined =>
  err instanceof ApiError ? err.code : undefined;

/** 0 for a request that never reached the server. */
export const errorStatus = (err: unknown): number =>
  err instanceof ApiError ? err.status : -1;
