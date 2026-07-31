'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  LIVE_EVENTS,
  LIVE_NAMESPACE,
  type LiveScanEvent,
  type RecentScanEntry,
} from '@pravasi/shared';

/**
 * Live gate feed (§10.5).
 *
 * The dashboard is a CONSUMER, not a source of truth. The socket streams
 * events; `reconcile()` replaces the list wholesale from the REST snapshot on
 * a slower cadence, so a dropped event or a missed reconnect cannot leave the
 * feed permanently drifted.
 */

/** Hard ceiling on retained events — an all-day dashboard must not grow. */
const MAX_FEED_ITEMS = 50;

/**
 * Origin for the socket handshake.
 *
 * socket.io-client only recognises a scheme when it sees a full `://`. Given
 * `https:/host` (one slash) or a bare `host`, it silently prepends the page
 * protocol, so `https:/api.example.com` becomes `https://https:/api.example.com`
 * and the handshake goes to `wss://https/socket.io/`. That failure mode is
 * invisible in the env var and only shows up as a dead live feed, so validate
 * here instead of trusting the value.
 *
 * Order: explicit socket URL → derived from the API URL (which carries the
 * `/api` suffix the socket must NOT have) → same origin.
 */
function resolveSocketUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
  const fromApi = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/api\/?$/, '');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  for (const candidate of [explicit, fromApi]) {
    if (!candidate) continue;
    if (/^https?:\/\/[^/]+/.test(candidate)) return candidate.replace(/\/+$/, '');
    console.warn(
      `[live] Ignoring malformed socket origin ${JSON.stringify(candidate)} — ` +
        'expected a full origin like https://api.example.com (note the "//").',
    );
  }

  return origin;
}

const SOCKET_URL = resolveSocketUrl();

export interface LiveScansState {
  scans: RecentScanEntry[];
  alerts: LiveScanEvent[];
  connected: boolean;
  dismissAlert: (id: string) => void;
  /** Seed or re-seed from an authoritative REST snapshot. */
  reconcile: (snapshot: RecentScanEntry[]) => void;
}

export function useLiveScans(): LiveScansState {
  const [scans, setScans] = useState<RecentScanEntry[]>([]);
  const [alerts, setAlerts] = useState<LiveScanEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const pushEvents = useCallback((incoming: LiveScanEvent[]) => {
    if (incoming.length === 0) return;

    setScans((prev) => {
      // Newest first, then truncate. Slicing on every batch keeps the array
      // bounded regardless of how long the dashboard stays open.
      const seen = new Set(prev.map((s) => s.id));
      const fresh = incoming.filter((e) => !seen.has(e.id));
      if (fresh.length === 0) return prev;
      return [...fresh.reverse(), ...prev].slice(0, MAX_FEED_ITEMS);
    });
  }, []);

  useEffect(() => {
    const socket = io(`${SOCKET_URL}${LIVE_NAMESPACE}`, {
      // The superuser JWT lives in an httpOnly cookie; the browser attaches
      // it to the handshake only with credentials enabled.
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    // Coalesced batch — the feed body.
    socket.on(LIVE_EVENTS.FEED, (batch: LiveScanEvent[]) => {
      pushEvents(Array.isArray(batch) ? batch : []);
    });

    /* Exceptions arrive here immediately, ahead of the 1s feed flush. This
     * channel drives toasts only — the same event lands in the feed on the
     * next tick, so inserting it here too would double the row. */
    socket.on(LIVE_EVENTS.ALERT, (event: LiveScanEvent) => {
      setAlerts((prev) => [event, ...prev].slice(0, 3));
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [pushEvents]);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const reconcile = useCallback((snapshot: RecentScanEntry[]) => {
    setScans(snapshot.slice(0, MAX_FEED_ITEMS));
  }, []);

  return { scans, alerts, connected, dismissAlert, reconcile };
}
