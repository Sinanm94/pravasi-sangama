'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CloudUpload,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { VerifyScanResponse } from '@pravasi/shared';
import { ScanNetworkError, bulkSync, verifyScan } from '@/lib/scanApi';
import {
  dropSettled,
  enqueue,
  localAdmitAt,
  markAttempted,
  queueSize,
  readQueue,
  recordLocalAdmit,
} from '@/lib/scanQueue';
import ScanResultOverlay, {
  OVERLAY_DURATION_MS,
  type ScanOutcome,
} from './ScanResultOverlay';

/* ------------------------------------------------------------------ */

const QR_REGION_ID = 'ps-qr-region';
const SYNC_INTERVAL_MS = 5_000;
/** Ignore the same code re-read by the camera within this window. */
const REPEAT_SUPPRESS_MS = 4_000;

type NetworkState = 'online' | 'offline' | 'syncing';

interface GateScannerProps {
  unitName: string;
  gateLabel?: string;
  onExit?: () => void;
}

/* ------------------------------------------------------------------ */

export default function GateScanner({
  unitName,
  gateLabel,
  onExit,
}: GateScannerProps) {
  const [network, setNetwork] = useState<NetworkState>('online');
  const [pending, setPending] = useState(0);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  // Refs, not state: the html5-qrcode callback closes over these and must
  // never see a stale render.
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef<{ payload: string; at: number } | null>(null);

  const refreshQueueCount = useCallback(async () => {
    setPending(await queueSize());
  }, []);

  /* ---------------------------------------------------------------- */
  /* Scan handling                                                     */
  /* ---------------------------------------------------------------- */

  const handleScan = useCallback(
    async (payload: string) => {
      // The camera fires continuously while a code is in frame.
      if (busyRef.current) return;
      const last = lastScanRef.current;
      if (
        last &&
        last.payload === payload &&
        Date.now() - last.at < REPEAT_SUPPRESS_MS
      ) {
        return;
      }

      busyRef.current = true;
      lastScanRef.current = { payload, at: Date.now() };

      const clientScanId = crypto.randomUUID();
      const capturedAt = new Date().toISOString();

      try {
        /* Online path.
         *
         * Note we do NOT gate this on navigator.onLine (§10.3). That flag
         * reports "online" on captive venue wifi where every request hangs.
         * The timeout is the real signal. */
        const result = await verifyScan({
          payload,
          client_scan_id: clientScanId,
          ...(gateLabel ? { gate_label: gateLabel } : {}),
        });

        setNetwork('online');
        show(toOutcome(result));
        if (result.status === 'SUCCESS' && !result.replay) {
          void recordLocalAdmit(payload);
        }
      } catch (err) {
        if (!(err instanceof ScanNetworkError)) {
          // Settled rejection (auth expired, bad request). Not queueable.
          show({
            status: 'INVALID',
            headline: 'Error',
            detail: err instanceof Error ? err.message : 'Scan failed',
          });
          return;
        }

        /* Offline fallback. The gate ADMITS on a pending scan — holding a
         * queue at the door to wait for wifi is worse than the failure it
         * prevents (§10.3). */
        setNetwork('offline');

        const seenAt = await localAdmitAt(payload);
        if (seenAt) {
          show({
            status: 'DUPLICATE',
            headline: 'Already Scanned',
            detail: `Admitted on this device at ${formatTime(seenAt)}`,
            pending: true,
          });
          return;
        }

        await enqueue({
          client_scan_id: clientScanId,
          payload,
          offline_scanned_at: capturedAt,
          ...(gateLabel ? { gate_label: gateLabel } : {}),
          attempts: 0,
        });
        await recordLocalAdmit(payload);
        await refreshQueueCount();

        show({
          status: 'SUCCESS',
          headline: 'Admitted',
          detail: 'Saved locally — will verify when the network returns',
          pending: true,
        });
      } finally {
        // Hold the camera until the overlay clears, so the next guest is not
        // scanned behind the previous verdict.
        setTimeout(() => {
          busyRef.current = false;
        }, OVERLAY_DURATION_MS);
      }
    },
    [gateLabel, refreshQueueCount],
  );

  const show = (next: ScanOutcome) => {
    setOutcome(next);
    vibrate(next.status);
  };

  /* ---------------------------------------------------------------- */
  /* Camera                                                            */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    // Typed from the library itself rather than a hand-written shape, so a
    // version bump that changes the signature fails the build instead of at
    // a gate.
    let instance: import('html5-qrcode').Html5Qrcode | null = null;

    (async () => {
      try {
        // Dynamic import: html5-qrcode touches `window` at module scope and
        // cannot be evaluated during SSR.
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;

        instance = new Html5Qrcode(QR_REGION_ID);
        scannerRef.current = instance;

        await instance.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1 },
          (text) => void handleScan(text),
          // Per-frame decode misses are normal; swallow them.
          () => {},
        );

        if (!cancelled) setStarting(false);
      } catch {
        if (!cancelled) {
          setStarting(false);
          setCameraError(
            'Camera unavailable. Grant camera permission and reload.',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      // stop() throws if the camera never started; that is not an error here.
      void instance?.stop().catch(() => {});
    };
  }, [handleScan]);

  /* ---------------------------------------------------------------- */
  /* Background sync                                                   */
  /* ---------------------------------------------------------------- */

  const drainQueue = useCallback(async () => {
    const queue = await readQueue();
    if (queue.length === 0) {
      setNetwork('online');
      return;
    }

    setNetwork('syncing');
    const batch = queue.slice(0, 200); // §10.4 — oldest first

    try {
      const response = await bulkSync(batch);

      // Delete only what the server settled. Items carrying an error stay
      // queued and are retried on the next tick.
      const settled = response.results
        .filter((r) => !r.error)
        .map((r) => r.clientScanId);

      await dropSettled(settled);
      await markAttempted(
        response.results.filter((r) => r.error).map((r) => r.clientScanId),
      );
      await refreshQueueCount();
      setNetwork('online');
    } catch {
      await markAttempted(batch.map((b) => b.client_scan_id));
      setNetwork('offline');
    }
  }, [refreshQueueCount]);

  useEffect(() => {
    void refreshQueueCount();

    const timer = setInterval(() => void drainQueue(), SYNC_INTERVAL_MS);
    const onOnline = () => void drainQueue();
    const onOffline = () => setNetwork('offline');

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [drainQueue, refreshQueueCount]);

  /* ---------------------------------------------------------------- */

  return (
    <div className="fixed inset-0 flex flex-col bg-black font-sans antialiased">
      {/* Header */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 border-b border-white/10 bg-black/40 px-4 py-3 backdrop-blur-xl">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
            {gateLabel ?? 'Gate'}
          </p>
          <h1 className="truncate text-[15px] font-semibold text-white">
            {unitName}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <NetworkBadge state={network} />
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              aria-label="Exit scanner"
              className="rounded-full bg-white/10 p-2 text-white/70 transition-colors hover:bg-white/20 hover:text-white active:scale-95"
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </header>

      {/* Camera */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <div id={QR_REGION_ID} className="h-full w-full [&_video]:object-cover" />

        {/* Reticle */}
        {!cameraError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-64 w-64">
              {CORNERS.map((corner) => (
                <span
                  key={corner}
                  className={`absolute h-10 w-10 border-white/80 ${CORNER_CLASSES[corner]}`}
                />
              ))}
            </div>
          </div>
        )}

        {starting && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black">
            <Loader2 className="h-6 w-6 animate-spin text-white/60" />
            <p className="text-[13px] text-white/60">Starting camera…</p>
          </div>
        )}

        {cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black px-10 text-center">
            <p className="text-[15px] font-medium text-white">{cameraError}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/20 active:scale-95"
            >
              <RefreshCw className="h-4 w-4" strokeWidth={2.25} />
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-white/10 bg-black/40 px-4 py-4 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <CloudUpload
            className={`h-[18px] w-[18px] ${
              pending > 0 ? 'text-amber-400' : 'text-white/35'
            }`}
            strokeWidth={2.25}
          />
          <span
            className={`text-[13px] font-medium ${
              pending > 0 ? 'text-amber-400' : 'text-white/45'
            }`}
          >
            {pending === 0
              ? 'All scans synced'
              : `${pending} pending sync${pending === 1 ? '' : 's'}`}
          </span>
        </div>

        {pending > 0 && (
          <button
            type="button"
            onClick={() => void drainQueue()}
            disabled={network === 'syncing'}
            className="rounded-full bg-white/10 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-white/20 disabled:opacity-50 active:scale-95"
          >
            {network === 'syncing' ? 'Syncing…' : 'Sync now'}
          </button>
        )}
      </footer>

      {/* Always mounted — the overlay owns its own enter/exit via
          AnimatePresence, so unmounting here would cut the exit short. */}
      <ScanResultOverlay outcome={outcome} onDismiss={() => setOutcome(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function NetworkBadge({ state }: { state: NetworkState }) {
  const config = {
    online: { icon: Wifi, label: 'Online', tone: 'text-emerald-400' },
    offline: { icon: WifiOff, label: 'Offline', tone: 'text-amber-400' },
    syncing: { icon: Loader2, label: 'Syncing', tone: 'text-sky-400' },
  }[state];

  const Icon = config.icon;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
      <Icon
        className={`h-3.5 w-3.5 ${config.tone} ${
          state === 'syncing' ? 'animate-spin' : ''
        }`}
        strokeWidth={2.5}
      />
      <span className={`text-[11px] font-semibold ${config.tone}`}>
        {config.label}
      </span>
    </span>
  );
}

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

const CORNER_CLASSES: Record<(typeof CORNERS)[number], string> = {
  tl: 'left-0 top-0 rounded-tl-xl border-l-4 border-t-4',
  tr: 'right-0 top-0 rounded-tr-xl border-r-4 border-t-4',
  bl: 'bottom-0 left-0 rounded-bl-xl border-b-4 border-l-4',
  br: 'bottom-0 right-0 rounded-br-xl border-b-4 border-r-4',
};

/* ------------------------------------------------------------------ */

function toOutcome(result: VerifyScanResponse): ScanOutcome {
  if (result.status === 'SUCCESS') {
    if (result.reason === 'LOCATION_INFO') {
      return {
        status: 'SUCCESS',
        headline: 'Location Pass',
        detail: 'Not an admission — venue information only',
        isLocation: true,
      };
    }

    return {
      status: 'SUCCESS',
      headline: 'Admitted',
      detail: result.ticket
        ? `${result.ticket.ticketType} — ${result.ticket.admittedCount} of ${result.ticket.countedPersons}`
        : undefined,
    };
  }

  if (result.status === 'DUPLICATE') {
    const prior = result.priorScan;
    return {
      status: 'DUPLICATE',
      headline: 'Already Scanned',
      detail: prior
        ? `${formatTime(prior.scannedAt)}${
            prior.agentName ? ` by ${prior.agentName}` : ''
          }${prior.gateLabel ? ` at ${prior.gateLabel}` : ''}`
        : undefined,
    };
  }

  return {
    status: 'INVALID',
    headline: result.reason === 'UNKNOWN_CODE' ? 'Invalid' : 'Revoked',
    detail: result.message,
  };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Gates are loud. Distinct patterns are read through the hand, not the ear. */
function vibrate(status: ScanOutcome['status']) {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  const pattern = {
    SUCCESS: [40],
    DUPLICATE: [30, 60, 30],
    INVALID: [90, 60, 90],
  }[status];
  navigator.vibrate(pattern);
}
