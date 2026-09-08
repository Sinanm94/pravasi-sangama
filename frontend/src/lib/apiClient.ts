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

/** PATCH sends only the fields the caller means to change — see the client
 *  update endpoint, where a full replace would let one editor silently undo
 *  another's change to a field they never touched. */
export const apiPatch = <T = unknown>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body });

export const apiDelete = <T = unknown>(path: string) =>
  request<T>(path, { method: 'DELETE' });

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
/** How the file reached the user, so the caller can say something true. */
export interface DownloadOutcome {
  filename: string;
  /** `share` — handed to the OS share sheet. `download` — written to the
   *  browser's download location. `cancelled` — user dismissed the sheet. */
  via: 'share' | 'download' | 'cancelled';
  /** A WhatsApp share tab was opened alongside a fallback download, so the
   *  user can attach the file that just landed (see `whatsappOnFallback`). */
  whatsappTab?: boolean;
}

export interface ApiDownloadOptions {
  /** Used only when the response carries no `Content-Disposition` filename. */
  fallbackFilename: string;
  /** Title on the OS share sheet. Defaults to the filename. */
  shareTitle?: string;
  /** Message on the OS share sheet, and — when the sheet is unavailable —
   *  the text pre-filled into the WhatsApp tab. */
  shareText?: string;
  /**
   * When the OS share sheet cannot take a file — desktop has none, and iOS
   * refuses some types — download the file and open WhatsApp with the
   * message pre-filled so the user attaches it themselves. `wa.me` takes
   * text only, never a file; this is the same two-step `ShareTicketModal`
   * uses for the ticket image on desktop.
   */
  whatsappOnFallback?: boolean;
}

export async function apiDownload(
  path: string,
  options: ApiDownloadOptions,
): Promise<DownloadOutcome> {
  const { fallbackFilename, shareTitle, shareText, whatsappOnFallback } =
    options;

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

  /* On a phone, an anchor download drops the file somewhere the user cannot
   * easily reach — Android Chrome writes it to /Download with a system
   * notification that is gone the moment it is dismissed, and iOS buries it
   * in Files. The Web Share sheet instead lets them put it where they
   * actually want it: Drive, WhatsApp, Mail, Files.
   *
   * `canShare({ files })` is checked rather than assumed — desktop Chrome
   * exposes `navigator.share` but refuses file payloads, so testing only for
   * `share` would throw there. */
  const file = new File([blob], filename, {
    type: blob.type || 'text/csv',
  });

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] }) &&
    typeof navigator.share === 'function'
  ) {
    try {
      await navigator.share({
        files: [file],
        title: shareTitle ?? filename,
        ...(shareText ? { text: shareText } : {}),
      });
      return { filename, via: 'share' };
    } catch (err) {
      /* AbortError means the user dismissed the sheet — that is a decision,
       * not a failure, and must NOT silently fall through to a hidden
       * download they did not ask for. Anything else (no target app, a
       * platform quirk) falls back so the export is never simply lost. */
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { filename, via: 'cancelled' };
      }
    }
  }

  // Fallback: an off-DOM anchor with `download`, clicked programmatically.
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);

  /* Desktop has no file share sheet and no way to attach a file to a wa.me
   * link. Open WhatsApp (Web on desktop, the app on mobile) with the message
   * pre-filled so the user attaches the file that just downloaded — clunky,
   * but the only path that exists off a phone. `wa.me/?text=` with no number
   * lets them pick any chat or group, which is the point here. */
  let whatsappTab = false;
  if (whatsappOnFallback && typeof window !== 'undefined') {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(shareText ?? filename)}`,
      '_blank',
      'noopener,noreferrer',
    );
    whatsappTab = true;
  }

  return { filename, via: 'download', whatsappTab };
}

/** Message for a toast. Never assume the caller checked the type. */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Something went wrong.';

export const errorCode = (err: unknown): string | undefined =>
  err instanceof ApiError ? err.code : undefined;

/** 0 for a request that never reached the server. */
export const errorStatus = (err: unknown): number =>
  err instanceof ApiError ? err.status : -1;
