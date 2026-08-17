import { closePool, withTransaction } from './index.js';

/**
 * Deletes ALL tickets and restarts the numbering sequences at 1, so the
 * first ticket issued afterwards is REQ-0001 / TKT-0001.
 *
 *   npm run db:reset-ticket-numbers -w @pravasi/backend -- --dry-run
 *   npm run db:reset-ticket-numbers -w @pravasi/backend -- --yes
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DESTRUCTIVE, AND THERE IS NO UNDO. Read this before running it.
 * ─────────────────────────────────────────────────────────────────────
 *
 * This exists for exactly one situation: a database still holding TEST
 * tickets from before the event, where the numbering should start clean.
 * Migration 016 deliberately starts each sequence ABOVE the highest number
 * already present, so those test rows push real tickets to
 * TKT-687223-and-up. Clearing them is the only way to get TKT-0001.
 *
 * ⚠ Running this after real tickets have been sold destroys the ledger,
 *   the revenue totals, and every QR code that would have admitted a
 *   paying guest. `--dry-run` is the default for that reason: it reports
 *   what WOULD go and changes nothing. `--yes` is required to actually
 *   delete, and it refuses if any ticket has ever been scanned — a scanned
 *   ticket means the gate is live, and at that point this script is
 *   categorically the wrong tool.
 *
 * Deletion order follows the FKs, all in one transaction — the same
 * reasoning as provision-demo-agent.ts's teardown:
 *
 *   scan_logs.ticket_id     → SET NULL  (deleted anyway; they are test noise)
 *   qr_codes.ticket_id      → CASCADE   (goes with the ticket)
 *   clients.ticket_id       → SET NULL  (a premium client record SURVIVES;
 *                                        the conversation is not the sale)
 *   tickets                 → the target
 *
 * The sequences are reset with `setval(…, 1, FALSE)` — "1, not yet used" —
 * so the very next nextval() returns 1 rather than 2.
 */

interface Counts {
  tickets: number;
  qrCodes: number;
  scanLogs: number;
  scannedCodes: number;
  clientLinks: number;
}

async function survey(): Promise<Counts> {
  return withTransaction(async (client) => {
    const one = async (sql: string): Promise<number> => {
      const { rows } = await client.query<{ n: string }>(sql);
      return Number(rows[0]?.n ?? 0);
    };

    return {
      tickets: await one(`SELECT COUNT(*)::TEXT AS n FROM tickets`),
      qrCodes: await one(`SELECT COUNT(*)::TEXT AS n FROM qr_codes`),
      scanLogs: await one(`SELECT COUNT(*)::TEXT AS n FROM scan_logs`),
      // The safety interlock: has anything actually been admitted?
      scannedCodes: await one(
        `SELECT COUNT(*)::TEXT AS n FROM qr_codes WHERE status = 'SCANNED'`,
      ),
      clientLinks: await one(
        `SELECT COUNT(*)::TEXT AS n FROM clients WHERE ticket_id IS NOT NULL`,
      ),
    };
  });
}

async function wipe(): Promise<Counts> {
  return withTransaction(async (client) => {
    const removed = {
      tickets: 0,
      qrCodes: 0,
      scanLogs: 0,
      scannedCodes: 0,
      clientLinks: 0,
    };

    const { rows: qrRows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n FROM qr_codes`,
    );
    removed.qrCodes = Number(qrRows[0]?.n ?? 0);

    /* Re-checked INSIDE the transaction, not just in the survey above: a
     * scan could land between the two, and admitting a guest is exactly
     * the event that must stop this. */
    const { rows: scanned } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n FROM qr_codes WHERE status = 'SCANNED'`,
    );
    if (Number(scanned[0]?.n ?? 0) > 0) {
      throw new Error(
        `${scanned[0]?.n} QR code(s) have been SCANNED — the gate is live. ` +
          `Refusing to delete tickets.`,
      );
    }

    const scanLogs = await client.query(`DELETE FROM scan_logs`);
    removed.scanLogs = scanLogs.rowCount ?? 0;

    /* Unlink premium client records rather than letting them go. The
     * conversation with a VIP is not the same object as the ticket they
     * eventually bought, and it has its own timeline worth keeping. */
    const unlinked = await client.query(
      `UPDATE clients SET ticket_id = NULL WHERE ticket_id IS NOT NULL`,
    );
    removed.clientLinks = unlinked.rowCount ?? 0;

    // qr_codes cascade from tickets.
    const tickets = await client.query(`DELETE FROM tickets`);
    removed.tickets = tickets.rowCount ?? 0;

    /* `false` = "not yet called", so the next nextval() returns 1 itself.
     * Passing true would make the first ticket 0002. */
    await client.query(`SELECT setval('request_number_seq', 1, FALSE)`);
    await client.query(`SELECT setval('ticket_number_seq', 1, FALSE)`);

    await client.query(
      `INSERT INTO audit_logs (actor_role, action, metadata)
            VALUES ('SUPERUSER', 'TICKET_NUMBERING_RESET', $1)`,
      [
        JSON.stringify({
          tickets_deleted: removed.tickets,
          qr_codes_deleted: removed.qrCodes,
        }),
      ],
    );

    return removed;
  });
}

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');

async function main(): Promise<void> {
  const line = '─'.repeat(60);

  if (!confirmed) {
    const counts = await survey();
    console.log(`\n${line}`);
    console.log('  DRY RUN — nothing has been changed');
    console.log(line);
    console.log(`\n  Would DELETE:\n`);
    console.log(`    tickets ......... ${counts.tickets}`);
    console.log(`    qr codes ........ ${counts.qrCodes}`);
    console.log(`    scan logs ....... ${counts.scanLogs}`);
    console.log(`\n  Would KEEP (unlinked, not deleted):\n`);
    console.log(`    client records .. ${counts.clientLinks} linked to a ticket`);
    console.log(`\n  Then restart numbering at REQ-0001 / TKT-0001.`);

    if (counts.scannedCodes > 0) {
      console.log(
        `\n  ⛔ BLOCKED: ${counts.scannedCodes} QR code(s) are already ` +
          `SCANNED.\n     The gate is live. This script will refuse to run.`,
      );
    } else {
      console.log(`\n  To apply, re-run with --yes`);
    }
    console.log(`\n${line}\n`);
    return;
  }

  const counts = await wipe();
  console.log(`\n${line}`);
  console.log('  TICKET NUMBERING RESET');
  console.log(line);
  console.log(`\n  tickets deleted ..... ${counts.tickets}`);
  console.log(`  qr codes deleted .... ${counts.qrCodes}`);
  console.log(`  scan logs deleted ... ${counts.scanLogs}`);
  console.log(`  client records kept . ${counts.clientLinks} (ticket link cleared)`);
  console.log(`\n  The next ticket issued will be REQ-0001 / TKT-0001.`);
  console.log(`\n${line}\n`);
}

main()
  .catch((err: unknown) => {
    console.error(
      `[reset-ticket-numbering] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(closePool);
