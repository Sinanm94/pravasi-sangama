import { closePool, withTransaction } from './index.js';

/**
 * Deletes the TEST tickets accumulated during development, keeps the real
 * ones, and restarts numbering so the next ticket issued is TKT-0001.
 *
 *   npm run db:reset-ticket-numbers -w @pravasi/backend                     # dry run
 *   npm run db:reset-ticket-numbers -w @pravasi/backend -- --yes            # apply
 *   npm run db:reset-ticket-numbers -w @pravasi/backend -- --yes --wipe-all # apply, keeping nothing
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DESTRUCTIVE, AND THERE IS NO UNDO. Read this before running it.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Why it exists: migration 016 starts each sequence ABOVE the highest
 * number already in the table, so a database full of test tickets pushes
 * real ones to TKT-687223-and-up. Clearing the test rows is the only way
 * to get a clean TKT-0001.
 *
 * ── KEEP is an allowlist, and that direction is deliberate ────────────
 *
 * Everything NOT named in KEEP_MOBILES is deleted. The alternative — a
 * denylist of test rows — fails dangerously: a real ticket someone forgot
 * to add to the list gets destroyed silently. With an allowlist the
 * failure mode is inverted and harmless: a real ticket someone forgot
 * survives as an extra row, which is noticed and fixed, not lost.
 *
 * The kept tickets RETAIN THEIR EXISTING NUMBERS. They are not renumbered
 * into the new series, because a pass already handed to a guest prints the
 * old number and reprinting it is a real-world errand. So the ledger will
 * hold two or three 6-digit numbers alongside the clean 0001, 0002 series.
 * That is the intended trade.
 *
 * ── FK order, one transaction ─────────────────────────────────────────
 *
 *   scan_logs.ticket_id  → SET NULL, but deleted anyway for removed tickets
 *   qr_codes.ticket_id   → CASCADE from tickets
 *   clients.ticket_id    → SET NULL; the client RECORD survives, since the
 *                          conversation with a VIP is not the sale
 *   tickets              → the target
 *
 * Sequences are reset with `setval(…, 1, FALSE)` — "1, not yet used" — so
 * the next nextval() returns 1 itself rather than 2.
 */

/**
 * Tickets to PRESERVE, by purchaser mobile number.
 *
 * Mobile rather than name: names collide and are re-typed inconsistently
 * ('Nizam' appeared on four different numbers), whereas the mobile is what
 * actually identifies a buyer.
 *
 * DELIBERATELY EMPTY — on 2026-08-17 the project owner confirmed that every
 * ticket then in the database, including the Ashraf / Hamza / Maryam rows
 * that had looked genuine, was test data from pre-event development. An
 * empty list means a full wipe, which is why `--wipe-all` is required
 * separately below: an allowlist that silently became empty through a typo
 * must never be indistinguishable from one that is empty on purpose.
 *
 * If a real ticket ever needs preserving, add its mobile here and the
 * `--wipe-all` requirement disappears on its own.
 */
const KEEP_MOBILES: readonly string[] = [] as const;

interface TicketSummary {
  ticket_number: string;
  purchaser_name: string;
  purchaser_mobile: string;
  scanned: number;
}

interface Plan {
  keep: TicketSummary[];
  remove: TicketSummary[];
  qrCodesToRemove: number;
  scanLogsToRemove: number;
  scannedToDiscard: number;
  clientLinks: number;
}

async function buildPlan(): Promise<Plan> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<TicketSummary & { keep: boolean }>(
      `SELECT t.ticket_number, t.purchaser_name, t.purchaser_mobile,
              COUNT(q.id) FILTER (WHERE q.status = 'SCANNED')::INT AS scanned,
              (t.purchaser_mobile = ANY($1::text[]))               AS keep
         FROM tickets t
         LEFT JOIN qr_codes q ON q.ticket_id = t.id
        GROUP BY t.id, t.ticket_number, t.purchaser_name, t.purchaser_mobile
        ORDER BY keep DESC, t.created_at ASC`,
      [KEEP_MOBILES],
    );

    const one = async (sql: string): Promise<number> => {
      const { rows: r } = await client.query<{ n: string }>(sql, [
        KEEP_MOBILES,
      ]);
      return Number(r[0]?.n ?? 0);
    };

    return {
      keep: rows.filter((r) => r.keep),
      remove: rows.filter((r) => !r.keep),
      qrCodesToRemove: await one(
        `SELECT COUNT(*)::TEXT AS n
           FROM qr_codes q JOIN tickets t ON t.id = q.ticket_id
          WHERE NOT (t.purchaser_mobile = ANY($1::text[]))`,
      ),
      scanLogsToRemove: await one(
        `SELECT COUNT(*)::TEXT AS n
           FROM scan_logs s
           LEFT JOIN tickets t ON t.id = s.ticket_id
          WHERE t.id IS NULL
             OR NOT (t.purchaser_mobile = ANY($1::text[]))`,
      ),
      scannedToDiscard: await one(
        `SELECT COUNT(*)::TEXT AS n
           FROM qr_codes q JOIN tickets t ON t.id = q.ticket_id
          WHERE q.status = 'SCANNED'
            AND NOT (t.purchaser_mobile = ANY($1::text[]))`,
      ),
      clientLinks: await one(
        `SELECT COUNT(*)::TEXT AS n FROM clients c
          WHERE c.ticket_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM tickets t
               WHERE t.id = c.ticket_id
                 AND t.purchaser_mobile = ANY($1::text[])
            )`,
      ),
    };
  });
}

interface Applied {
  tickets: number;
  qrCodes: number;
  scanLogs: number;
  clientLinks: number;
  kept: number;
  seqStart: number;
}

async function apply(): Promise<Applied> {
  return withTransaction(async (client) => {
    /* Two distinct guards, because "nothing will be kept" has two very
     * different causes and only one of them is intended. */
    const { rows: keepRows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n FROM tickets
        WHERE purchaser_mobile = ANY($1::text[])`,
      [KEEP_MOBILES],
    );
    const keptCount = Number(keepRows[0]?.n ?? 0);

    /* (a) The list names numbers, but none of them exist. That is a typo,
     * and running would delete the very tickets the list was written to
     * protect. Always refuse. */
    if (KEEP_MOBILES.length > 0 && keptCount === 0) {
      throw new Error(
        `KEEP_MOBILES lists ${KEEP_MOBILES.length} number(s) but none match ` +
          `any ticket. Refusing to run — this would delete everything the ` +
          `list was meant to protect. Check them against db:inspect-scans.`,
      );
    }

    /* (b) The list is empty, meaning a deliberate full wipe. Allowed, but
     * only when said out loud on the command line — an allowlist that
     * became empty by accident must not be able to wipe the ledger just
     * because --yes was passed. */
    if (KEEP_MOBILES.length === 0 && !wipeAll) {
      throw new Error(
        `KEEP_MOBILES is empty, so EVERY ticket would be deleted. If that ` +
          `is intended, re-run with --yes --wipe-all.`,
      );
    }

    const { rows: qrRows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n
         FROM qr_codes q JOIN tickets t ON t.id = q.ticket_id
        WHERE NOT (t.purchaser_mobile = ANY($1::text[]))`,
      [KEEP_MOBILES],
    );
    const qrCodes = Number(qrRows[0]?.n ?? 0);

    /* scan_logs first. Its FKs are SET NULL, so rows for deleted tickets
     * would otherwise survive as orphans cluttering /admin/scans. Rows with
     * no ticket at all (UNKNOWN_CODE) go too — they are test noise by
     * definition here. */
    /* NOT a `USING (kept) … WHERE s.ticket_id <> kept.id` join: with two
     * kept tickets that pairs every scan row against each of them, so a
     * row belonging to kept ticket A still matches the B pairing and the
     * predicate is true for almost everything. NOT IN / NOT EXISTS states
     * the intent directly and is immune to the row count of the subquery. */
    const scanLogs = await client.query(
      `DELETE FROM scan_logs s
        WHERE s.ticket_id IS NULL
           OR NOT EXISTS (
                SELECT 1 FROM tickets t
                 WHERE t.id = s.ticket_id
                   AND t.purchaser_mobile = ANY($1::text[])
              )`,
      [KEEP_MOBILES],
    );

    const unlinked = await client.query(
      `UPDATE clients SET ticket_id = NULL
        WHERE ticket_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM tickets t
             WHERE t.id = clients.ticket_id
               AND t.purchaser_mobile = ANY($1::text[])
          )`,
      [KEEP_MOBILES],
    );

    // qr_codes cascade from tickets.
    const tickets = await client.query(
      `DELETE FROM tickets WHERE NOT (purchaser_mobile = ANY($1::text[]))`,
      [KEEP_MOBILES],
    );

    /* Restart at 1. The kept tickets keep their existing (6-digit) numbers
     * and are NOT renumbered, so there is no risk of the new series
     * colliding with them — TKT-0001 and TKT-742901 are different strings.
     * The unique constraint is the backstop if that ever stops being true. */
    await client.query(`SELECT setval('request_number_seq', 1, FALSE)`);
    await client.query(`SELECT setval('ticket_number_seq', 1, FALSE)`);

    await client.query(
      `INSERT INTO audit_logs (actor_role, action, metadata)
            VALUES ('SUPERUSER', 'TICKET_NUMBERING_RESET', $1)`,
      [
        JSON.stringify({
          tickets_deleted: tickets.rowCount ?? 0,
          qr_codes_deleted: qrCodes,
          tickets_kept: keptCount,
          kept_mobiles: KEEP_MOBILES,
        }),
      ],
    );

    return {
      tickets: tickets.rowCount ?? 0,
      qrCodes,
      scanLogs: scanLogs.rowCount ?? 0,
      clientLinks: unlinked.rowCount ?? 0,
      kept: keptCount,
      seqStart: 1,
    };
  });
}

/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const confirmed = argv.includes('--yes');
const wipeAll = argv.includes('--wipe-all');
const LINE = '─'.repeat(66);

async function main(): Promise<void> {
  if (!confirmed) {
    const plan = await buildPlan();

    console.log(`\n${LINE}`);
    console.log('  DRY RUN — nothing has been changed');
    console.log(LINE);

    console.log(`\n  KEEPING ${plan.keep.length} ticket(s):\n`);
    if (plan.keep.length === 0) {
      console.log(
        KEEP_MOBILES.length === 0
          ? '    (none — KEEP_MOBILES is empty, this is a FULL WIPE)'
          : '    (none — KEEP_MOBILES names numbers that match nothing!)',
      );
    }
    for (const t of plan.keep) {
      console.log(
        `    ${t.ticket_number.padEnd(14)} ${t.purchaser_name.padEnd(20)} ` +
          `${t.purchaser_mobile}`,
      );
    }

    console.log(`\n  DELETING ${plan.remove.length} ticket(s):\n`);
    for (const t of plan.remove) {
      const mark = t.scanned > 0 ? ` (${t.scanned} scanned)` : '';
      console.log(
        `    ${t.ticket_number.padEnd(14)} ${t.purchaser_name.padEnd(20)} ` +
          `${t.purchaser_mobile}${mark}`,
      );
    }

    console.log(`\n  Also removing:\n`);
    console.log(`    qr codes ........ ${plan.qrCodesToRemove}`);
    console.log(`    scan logs ....... ${plan.scanLogsToRemove}`);
    console.log(`    of which SCANNED  ${plan.scannedToDiscard}`);
    console.log(`\n  Client records unlinked (kept): ${plan.clientLinks}`);
    if (plan.keep.length > 0) {
      console.log(`\n  Kept tickets RETAIN their current numbers.`);
    }
    console.log(`  Next NEW ticket will be REQ-0001 / TKT-0001.`);

    console.log(`\n  To apply:`);
    console.log(
      `    npm run db:reset-ticket-numbers -w @pravasi/backend -- --yes` +
        (KEEP_MOBILES.length === 0 ? ' --wipe-all' : ''),
    );
    console.log(`\n${LINE}\n`);
    return;
  }

  const r = await apply();
  console.log(`\n${LINE}`);
  console.log('  TICKET NUMBERING RESET');
  console.log(LINE);
  console.log(`\n  tickets kept ........ ${r.kept}`);
  console.log(`  tickets deleted ..... ${r.tickets}`);
  console.log(`  qr codes deleted .... ${r.qrCodes}`);
  console.log(`  scan logs deleted ... ${r.scanLogs}`);
  console.log(`  client links cleared  ${r.clientLinks}`);
  console.log(`\n  The next ticket issued will be REQ-0001 / TKT-0001.`);
  console.log(`\n${LINE}\n`);
}

main()
  .catch((err: unknown) => {
    console.error(
      `[reset-ticket-numbering] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(closePool);
