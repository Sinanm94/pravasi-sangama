import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool, healthcheck } from './db/index.js';
import { closeSocket, initSocket } from './socket.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(
    `[server] pravasi-sangama api listening on :${env.PORT} (${env.NODE_ENV})`,
  );
});

// Live gate feed for the superuser dashboard (§10.5). Shares the HTTP server,
// so there is one port and one TLS termination point.
initSocket(server);

// Warn loudly rather than crashing — the API can serve cached reads while
// the database comes back up.
void healthcheck().then((ok) => {
  if (!ok) console.error('[server] database unreachable at boot');
});

async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, draining`);

  // Sockets first: connected dashboards get a clean disconnect and reconnect
  // to the next instance instead of hanging on a half-closed server.
  await closeSocket();

  server.close(async () => {
    await closePool();
    process.exit(0);
  });

  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
