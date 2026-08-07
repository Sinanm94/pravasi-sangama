import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool, healthcheck } from './db/index.js';
import { isMailConfigured } from './lib/mailer.js';
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

/* Same posture as the database check: say it at boot rather than let the
 * first agent discover it.
 *
 * Emailing a ticket is the one feature that fails ONLY when someone tries to
 * use it — sendMail() throws 503 EMAIL_NOT_CONFIGURED in production, which
 * surfaces at a registration desk with a purchaser waiting, long after the
 * deploy that caused it. SMTP is legitimately optional (a deployment may
 * choose print/WhatsApp only), so this warns rather than refusing to start. */
if (!isMailConfigured()) {
  const detail =
    'set SMTP_HOST and MAIL_FROM (plus SMTP_PORT/SMTP_SECURE/SMTP_USER/' +
    'SMTP_PASS as your provider requires)';

  if (env.NODE_ENV === 'production') {
    console.error(
      `[server] EMAIL DISABLED — "Send Email" on the share sheet will return ` +
        `503 for every ticket. To enable it, ${detail}.`,
    );
  } else {
    console.warn(
      `[server] email not configured — sends are logged, not delivered. To ` +
        `deliver for real, ${detail}.`,
    );
  }
}

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
