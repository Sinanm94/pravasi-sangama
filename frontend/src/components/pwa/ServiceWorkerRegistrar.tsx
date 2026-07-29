'use client';

import { useEffect } from 'react';

/**
 * Registers the gate service worker. Renders nothing.
 *
 * Production only. A cached shell in front of the dev server breaks fast
 * refresh in ways that look like application bugs and cost an afternoon to
 * diagnose.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    /* --- Development: actively tear down ---------------------------
     * Not just "skip registration". Anyone who has run a production
     * build on localhost has a worker still installed on that origin,
     * and it will keep serving a stale shell over the dev server
     * indefinitely. Unregister and clear on every dev boot. */
    if (process.env.NODE_ENV !== 'production') {
      void (async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));

        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys.filter((k) => k.startsWith('ps26-')).map((k) => caches.delete(k)),
          );
        }

        if (registrations.length > 0) {
          console.info('[pwa] unregistered service worker for development');
        }
      })();
      return;
    }

    /* --- Production ------------------------------------------------ */
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        // A new worker is waiting. sw.js already calls skipWaiting on
        // install, so this is belt-and-braces for browsers that hold it.
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              installing.postMessage('SKIP_WAITING');
            }
          });
        });

        // Check for a new build periodically. A gate phone can stay open
        // for the whole event without ever being reloaded.
        setInterval(() => void registration.update(), 60 * 60 * 1000);
      } catch (err) {
        // Never fatal — the app works without a service worker, it just
        // loses its offline shell.
        console.warn('[pwa] service worker registration failed', err);
      }
    };

    // Wait for load so registration never competes with first paint.
    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', () => void register(), { once: true });
    }
  }, []);

  return null;
}
