import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Namespace } from 'socket.io';
import {
  LIVE_EVENTS,
  LIVE_NAMESPACE,
  SESSION_COOKIE_NAME,
  type LiveScanEvent,
} from '@pravasi/shared';
import { env } from './config/env.js';
import { verifySession } from './lib/jwt.js';

/**
 * Live gate feed for the superuser dashboard (CLAUDE.md §10.5).
 *
 * Two channels, deliberately:
 *
 *   scan:alert   Exceptions only (duplicate / invalid / post-sync duplicate).
 *                Emitted immediately — an alert that arrives a second late is
 *                a worse alert.
 *
 *   scan:feed    Everything, batched on a 1s tick. Streaming every admission
 *                individually is how the socket layer becomes the bottleneck
 *                instead of the database.
 *
 * Everything here is emitted AFTER commit. A dashboard must never show an
 * admission that later rolls back.
 */

let io: SocketIOServer | null = null;
let live: Namespace | null = null;
let flushTimer: NodeJS.Timeout | null = null;

/** Single tier for now. Division-scoped rooms land with division admins. */
const SUPERUSER_ROOM = 'superusers';

const FLUSH_INTERVAL_MS = 1000;
/** Ceiling on a single flush. A backlog past this is shed, not queued. */
const MAX_FLUSH_BATCH = 100;

let buffer: LiveScanEvent[] = [];

/* ------------------------------------------------------------------ */

/** Minimal cookie header parse — avoids pulling cookie-parser off Express. */
function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};

  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return acc;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

/* ------------------------------------------------------------------ */

export function initSocket(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    },
    // A gate venue's wifi drops long-poll upgrades; allow the fallback.
    transports: ['websocket', 'polling'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  live = io.of(LIVE_NAMESPACE);

  /* --- Handshake authentication ---------------------------------- *
   * Rejects everything that is not a valid SUPERUSER token. This is the
   * only gate — there is no per-event authorization below it, so it has
   * to be strict. */
  live.use((socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);

      // Cookie first (the browser sends it automatically with
      // withCredentials). auth.token is the fallback for non-browser
      // clients and for cross-site deployments where the cookie is blocked.
      const token =
        cookies[SESSION_COOKIE_NAME] ??
        (typeof socket.handshake.auth?.token === 'string'
          ? socket.handshake.auth.token
          : undefined);

      if (!token) {
        return next(new Error('UNAUTHORIZED'));
      }

      const claims = verifySession(token); // throws on bad signature/expiry

      if (claims.role !== 'SUPERUSER') {
        return next(new Error('FORBIDDEN'));
      }

      socket.data.superuserId = claims.superuserId;
      return next();
    } catch {
      return next(new Error('UNAUTHORIZED'));
    }
  });

  live.on('connection', (socket) => {
    void socket.join(SUPERUSER_ROOM);

    console.log(
      `[socket] superuser ${socket.data.superuserId} connected (${live?.sockets.size ?? 0} online)`,
    );

    socket.on('disconnect', (reason) => {
      console.log(`[socket] superuser disconnected: ${reason}`);
    });
  });

  startFlushLoop();

  return io;
}

/* ------------------------------------------------------------------ */
/* Emission                                                            */
/* ------------------------------------------------------------------ */

function startFlushLoop() {
  if (flushTimer) return;

  flushTimer = setInterval(() => {
    if (buffer.length === 0 || !live) return;

    const batch = buffer.slice(0, MAX_FLUSH_BATCH);
    const shed = buffer.length - batch.length;
    buffer = [];

    if (shed > 0) {
      console.warn(`[socket] shed ${shed} feed events (flush ceiling)`);
    }

    live.to(SUPERUSER_ROOM).emit(LIVE_EVENTS.FEED, batch);
  }, FLUSH_INTERVAL_MS);

  // Never hold the process open on the flush timer alone.
  flushTimer.unref();
}

/**
 * The single entry point for the scanning module.
 *
 * Every event joins the coalesced feed. Exceptions additionally fire an
 * immediate alert, so a duplicate at a gate reaches the dashboard now rather
 * than up to a second later.
 *
 * Safe to call before initSocket — it is a no-op without a server, so tests
 * and CLI scripts do not need a socket layer.
 */
export function broadcastScanAlert(event: LiveScanEvent): void {
  if (!live) return;

  if (
    event.alertType === 'DUPLICATE' ||
    event.alertType === 'POST_SYNC_DUPLICATE' ||
    event.alertType === 'INVALID'
  ) {
    live.to(SUPERUSER_ROOM).emit(LIVE_EVENTS.ALERT, event);
  }

  buffer.push(event);
}

export async function closeSocket(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  buffer = [];
  await io?.close();
  io = null;
  live = null;
}
