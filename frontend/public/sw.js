/* eslint-disable no-restricted-globals */
/**
 * PRAVASI SANGAMA 2026 — gate service worker.
 *
 * Raw JS on purpose: no build step, no plugin, no surprises on event day.
 *
 * Scope of responsibility is narrow and worth stating plainly, because getting
 * this wrong is how a gate stops working:
 *
 *   The service worker caches the SHELL. It does NOT handle offline scanning.
 *
 * Scan durability lives in the app (IndexedDB queue + bulk-sync, CLAUDE.md
 * §10.3–10.4). Every /api/* request passes straight through untouched. A
 * service worker that replayed or cached an admission would corrupt the
 * headcount in ways the queue is specifically designed to prevent.
 *
 * Bump CACHE_VERSION on any change to this file or the precache list.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `ps26-shell-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

/** Navigation waits this long for the network before falling back to cache. */
const NAVIGATION_TIMEOUT_MS = 3000;

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/* ------------------------------------------------------------------ */
/* Install — precache the offline shell                                */
/* ------------------------------------------------------------------ */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // allSettled, not addAll: addAll is atomic, so one missing icon would
      // fail the whole install and leave the gate with no offline shell.
      const results = await Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })),
        ),
      );

      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          console.warn('[sw] precache miss:', PRECACHE_URLS[i]);
        }
      });

      // Take over immediately. A half-updated gate app is worse than a
      // one-refresh interruption.
      await self.skipWaiting();
    })(),
  );
});

/* ------------------------------------------------------------------ */
/* Activate — drop previous versions                                   */
/* ------------------------------------------------------------------ */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('ps26-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );

      await self.clients.claim();
    })(),
  );
});

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only GET is ever cacheable. POST /api/scan/verify must never be touched.
  if (request.method !== 'GET') return;

  // Cross-origin: let the network handle it.
  if (url.origin !== self.location.origin) return;

  /* --- API: total bypass ----------------------------------------- *
   * Not network-first, not stale-while-revalidate — no respondWith at
   * all. The app's own queue owns offline behaviour for these. */
  if (url.pathname.startsWith('/api/')) return;

  // Next.js dev/HMR endpoints, if a SW ever runs in development.
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isStaticAsset(url, request)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

/* ------------------------------------------------------------------ */
/* Strategies                                                          */
/* ------------------------------------------------------------------ */

/**
 * Stale-while-revalidate: serve the cached copy instantly, refresh in the
 * background for next time.
 *
 * Right for hashed build output and fonts — the content at a given URL never
 * changes, so "stale" is never actually wrong.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Do not await: the whole point is returning the cached copy now.
    event_waitUntilSafe(network);
    return cached;
  }

  const response = await network;
  return response ?? Response.error();
}

/**
 * Navigations are network-first with a timeout, NOT stale-while-revalidate.
 *
 * Deliberate deviation. Serving a stale HTML document that references
 * build-hashed chunks which the new deploy has already purged produces a white
 * screen — the single worst failure mode for a gate. Freshness wins while the
 * network is up; cache and the offline page cover it when it is not.
 */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
    if (isCacheable(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isStaticAsset(url, request) {
  if (url.pathname.startsWith('/_next/static/')) return true;
  if (url.pathname.startsWith('/icons/')) return true;
  if (url.pathname.startsWith('/assets/')) return true;

  const destination = request.destination;
  return (
    destination === 'script' ||
    destination === 'style' ||
    destination === 'font' ||
    destination === 'image'
  );
}

/** Only same-origin 200s. Opaque and partial responses poison the cache. */
function isCacheable(response) {
  return Boolean(
    response &&
      response.status === 200 &&
      (response.type === 'basic' || response.type === 'default'),
  );
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ]);
}

/**
 * The background refresh in staleWhileRevalidate has no FetchEvent in scope,
 * so it cannot be kept alive with waitUntil. Swallowing the rejection is
 * enough — a failed refresh just means the cached copy stays current.
 */
function event_waitUntilSafe(promise) {
  promise.catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
