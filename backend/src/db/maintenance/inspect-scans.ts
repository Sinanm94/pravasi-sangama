import { closePool, query } from '../index.js';

/**
 * READ-ONLY. Prints what is actually in the tickets/scans tables so a human
 * can decide whether the data is test noise or a live event.
 *
 * Exists because `db:reset-ticket-numbers` refuses to run while any QR code
 * is SCANNED, and that refusal is only useful if you can then find out WHY
 * codes are scanned. Changes nothing; safe to run against production.
 *
 *   npm run db:inspect-scans -w @pravasi/backend
 */

async function main(): Promise<void> {
  const line = '─'.repeat(72);

  const { rows: scans } = await query<{
    ticket_number: string;
    purchaser_name: string;
    result: string;
    gate_label: string | null;
    created_at: Date;
  }>(
    `SELECT COALESCE(t.ticket_number, '(unknown code)') AS ticket_number,
            COALESCE(t.purchaser_name, '—')            AS purchaser_name,
            s.result,
            s.gate_label,
            s.created_at
       FROM scan_logs s
       LEFT JOIN tickets t ON t.id = s.ticket_id
      ORDER BY s.created_at DESC
      LIMIT 40`,
  );

  console.log(`\n${line}`);
  console.log('  SCAN LOG — most recent 40 (read-only)');
  console.log(line);

  if (scans.length === 0) {
    console.log('\n  No scans recorded.\n');
  } else {
    console.log(
      `\n  ${'WHEN (UTC)'.padEnd(20)} ${'TICKET'.padEnd(12)} ${'RESULT'.padEnd(18)} GATE / BUYER`,
    );
    console.log(`  ${'-'.repeat(20)} ${'-'.repeat(12)} ${'-'.repeat(18)} ${'-'.repeat(20)}`);
    for (const s of scans) {
      const when = s.created_at.toISOString().slice(0, 19).replace('T', ' ');
      console.log(
        `  ${when.padEnd(20)} ${s.ticket_number.padEnd(12)} ` +
          `${s.result.padEnd(18)} ${s.gate_label ?? '—'} / ${s.purchaser_name}`,
      );
    }
  }

  const { rows: buyers } = await query<{
    purchaser_name: string;
    purchaser_mobile: string;
    tickets: number;
    scanned: number;
  }>(
    `SELECT t.purchaser_name, t.purchaser_mobile,
            COUNT(DISTINCT t.id)::INT AS tickets,
            COUNT(q.id) FILTER (WHERE q.status = 'SCANNED')::INT AS scanned
       FROM tickets t
       LEFT JOIN qr_codes q ON q.ticket_id = t.id
      GROUP BY t.purchaser_name, t.purchaser_mobile
      ORDER BY tickets DESC`,
  );

  console.log(`\n${line}`);
  console.log('  PURCHASERS — every buyer currently in the ledger');
  console.log(line);
  console.log(
    `\n  ${'NAME'.padEnd(24)} ${'MOBILE'.padEnd(14)} ${'TICKETS'.padEnd(9)} SCANNED CODES`,
  );
  console.log(`  ${'-'.repeat(24)} ${'-'.repeat(14)} ${'-'.repeat(9)} ${'-'.repeat(13)}`);
  for (const b of buyers) {
    console.log(
      `  ${b.purchaser_name.slice(0, 24).padEnd(24)} ` +
        `${b.purchaser_mobile.padEnd(14)} ${String(b.tickets).padEnd(9)} ${b.scanned}`,
    );
  }

  console.log(
    `\n${line}` +
      '\n  If every name above is test data, the scans are test scans and' +
      '\n  db:reset-ticket-numbers can be run with --force-scanned.' +
      '\n  If ANY real guest is listed, do not reset — investigate first.' +
      `\n${line}\n`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(
      `[inspect-scans] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(closePool);
