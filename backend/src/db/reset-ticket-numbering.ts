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

async function wipe(forceScanned: boolean): Promise<Counts> {
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
     * the event that must stop this.
     *
     * `--force-scanned` exists because "some codes are scanned" is ALSO the
     * normal state of a database someone has been testing the gate against,
     * which is exactly when this script is wanted. The override is a
     * separate, explicit flag rather than a weakening of the check: the
     * default still refuses, and choosing to proceed is a deliberate act
     * recorded in the audit row below. Confirm with db:inspect-scans that
     * every purchaser is test data before reaching for it. */
    const { rows: scanned } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n FROM qr_codes WHERE status = 'SCANNED'`,
    );
    const scannedCount = Number(scanned[0]?.n ?? 0);
    removed.scannedCodes = scannedCount;

    if (scannedCount > 0 && !forceScanned) {
      throw new Error(
        `${scannedCount} QR code(s) have been SCANNED — the gate may be live. ` +
          `Refusing to delete tickets. Run db:inspect-scans to see what they ` +
          `are; if they are all test scans, re-run with --yes --force-scanned.`,
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
          // Recorded so a later reader can tell this was overridden, not
          // that the database merely happened to have no scans.
          scanned_codes_discarded: removed.scannedCodes,
          forced: forceScanned,
        }),
      ],
    );

    return removed;
  });
}

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const forceScanned = args.includes('--force-scanned');

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
        `\n  ⛔ BLOCKED: ${counts.scannedCodes} QR code(s) are already SCANNED.` +
          `\n\n     That is either a live gate, or your own testing.` +
          `\n     Check which, before deciding:` +
          `\n       npm run db:inspect-scans -w @pravasi/backend` +
          `\n\n     If every purchaser listed there is test data:` +
          `\n       npm run db:reset-ticket-numbers -w @pravasi/backend -- --yes --force-scanned`,
      );
    } else {
      console.log(`\n  To apply, re-run with --yes`);
    }
    console.log(`\n${line}\n`);
    return;
  }

  const counts = await wipe(forceScanned);
  console.log(`\n${line}`);
  console.log('  TICKET NUMBERING RESET');
  console.log(line);
  console.log(`\n  tickets deleted ..... ${counts.tickets}`);
  console.log(`  qr codes deleted .... ${counts.qrCodes}`);
  console.log(`  scan logs deleted ... ${counts.scanLogs}`);
  console.log(`  client records kept . ${counts.clientLinks} (ticket link cleared)`);
  if (counts.scannedCodes > 0) {
    console.log(
      `\n  ⚠ ${counts.scannedCodes} SCANNED code(s) were discarded via ` +
        `--force-scanned.\n    Recorded in audit_logs as a forced reset.`,
    );
  }
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
