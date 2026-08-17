import { closePool, withTransaction } from '../index.js';

/**
 * Deletes test agents, and optionally the demo unit created for the
 * recording, leaving only the accounts named in KEEP_MOBILES.
 *
 *   npm run db:purge-test-agents -w @pravasi/backend                      # dry run
 *   npm run db:purge-test-agents -w @pravasi/backend -- --yes             # apply
 *   npm run db:purge-test-agents -w @pravasi/backend -- --yes --wipe-all  # keep nobody
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DESTRUCTIVE, AND THERE IS NO UNDO.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Same allowlist discipline as reset-ticket-numbering.ts, and for the same
 * reason: a denylist of "test" accounts silently destroys any real agent
 * somebody forgot to list, whereas a forgotten agent on an allowlist merely
 * survives and gets noticed. `--wipe-all` is required when the list is
 * empty, so a typo cannot be mistaken for an intentional clean-out.
 *
 * ── ORDER MATTERS: run the ticket reset FIRST ─────────────────────────
 *
 * `tickets.agent_id` and `unit_sessions.agent_id` are ON DELETE RESTRICT,
 * so an agent who has issued even one ticket CANNOT be deleted while that
 * ticket exists. This script does not delete tickets — that is
 * `db:reset-ticket-numbers`'s job, and quietly destroying a sale as a side
 * effect of tidying up accounts would be exactly the wrong behaviour.
 *
 * Instead it reports the blockage and refuses. Run:
 *
 *   1. npm run db:reset-ticket-numbers -w @pravasi/backend -- --yes --wipe-all
 *   2. npm run db:purge-test-agents    -w @pravasi/backend -- --yes --wipe-all
 *
 * ── The demo fixture ──────────────────────────────────────────────────
 *
 * `--with-demo-unit` also removes the DEMO01 unit created by
 * provision-demo-agent.ts. That script's own `--destroy` does the same job
 * and is the better tool when only the demo needs clearing; the flag exists
 * here so a single pass can clean everything at once.
 */

/**
 * Agents to PRESERVE, by mobile number (the Agent ID — §2).
 *
 * Empty on purpose: as of 2026-08-17 every account in the directory is a
 * pre-event test registration, including the demo agent. Add a mobile here
 * to spare it, and the --wipe-all requirement lifts automatically.
 */
const KEEP_MOBILES: readonly string[] = [] as const;

/** The unit provision-demo-agent.ts creates. Removed only with the flag. */
const DEMO_UNIT_CODE = 'DEMO01';

interface AgentSummary {
  mobile_number: string;
  name: string;
  unit_code: string;
  tickets: number;
  keep: boolean;
}

async function survey(): Promise<AgentSummary[]> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<AgentSummary>(
      `SELECT a.mobile_number, a.name, u.unit_code,
              COUNT(t.id)::INT                          AS tickets,
              (a.mobile_number = ANY($1::text[]))       AS keep
         FROM agents a
         JOIN units u   ON u.id = a.unit_id
         LEFT JOIN tickets t ON t.agent_id = a.id
        GROUP BY a.id, a.mobile_number, a.name, u.unit_code
        ORDER BY keep DESC, a.name ASC`,
      [KEEP_MOBILES],
    );
    return rows;
  });
}

interface Applied {
  agents: number;
  sessions: number;
  resetTokens: number;
  demoUnit: number;
  kept: number;
}

async function apply(withDemoUnit: boolean): Promise<Applied> {
  return withTransaction(async (client) => {
    const { rows: keepRows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n FROM agents
        WHERE mobile_number = ANY($1::text[])`,
      [KEEP_MOBILES],
    );
    const kept = Number(keepRows[0]?.n ?? 0);

    if (KEEP_MOBILES.length > 0 && kept === 0) {
      throw new Error(
        `KEEP_MOBILES names ${KEEP_MOBILES.length} number(s) but none match ` +
          `an agent. Refusing — this would delete the accounts the list was ` +
          `written to protect.`,
      );
    }

    if (KEEP_MOBILES.length === 0 && !wipeAll) {
      throw new Error(
        `KEEP_MOBILES is empty, so EVERY agent would be deleted. If that is ` +
          `intended, re-run with --yes --wipe-all.`,
      );
    }

    /* tickets.agent_id is ON DELETE RESTRICT. Checked explicitly so the
     * failure is a sentence naming the fix, rather than a raw FK violation
     * from Postgres that a non-DBA has to decode. */
    const { rows: blocked } = await client.query<{
      mobile_number: string;
      name: string;
      tickets: string;
    }>(
      `SELECT a.mobile_number, a.name, COUNT(t.id)::TEXT AS tickets
         FROM agents a
         JOIN tickets t ON t.agent_id = a.id
        WHERE NOT (a.mobile_number = ANY($1::text[]))
        GROUP BY a.id, a.mobile_number, a.name`,
      [KEEP_MOBILES],
    );

    if (blocked.length > 0) {
      const list = blocked
        .map((b) => `${b.name} (${b.mobile_number}): ${b.tickets}`)
        .join(', ');
      throw new Error(
        `${blocked.length} agent(s) still have tickets and cannot be ` +
          `deleted — ${list}. Clear the tickets first:\n  ` +
          `npm run db:reset-ticket-numbers -w @pravasi/backend -- --yes --wipe-all`,
      );
    }

    /* password_reset_tokens CASCADEs, but count it before it disappears so
     * the report is honest about what went. */
    const { rows: tokenRows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n
         FROM password_reset_tokens p JOIN agents a ON a.id = p.agent_id
        WHERE NOT (a.mobile_number = ANY($1::text[]))`,
      [KEEP_MOBILES],
    );

    /* unit_sessions.agent_id is RESTRICT too, so sessions go first. These
     * are login audit rows for accounts that are about to stop existing. */
    const sessions = await client.query(
      `DELETE FROM unit_sessions s
        WHERE s.agent_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM agents a
             WHERE a.id = s.agent_id
               AND a.mobile_number = ANY($1::text[])
          )`,
      [KEEP_MOBILES],
    );

    const agents = await client.query(
      `DELETE FROM agents WHERE NOT (mobile_number = ANY($1::text[]))`,
      [KEEP_MOBILES],
    );

    /* The demo unit last: agents referenced it with ON DELETE RESTRICT, so
     * it only becomes deletable once they are gone. */
    let demoUnit = 0;
    if (withDemoUnit) {
      const res = await client.query(
        `DELETE FROM units WHERE unit_code = $1`,
        [DEMO_UNIT_CODE],
      );
      demoUnit = res.rowCount ?? 0;
    }

    await client.query(
      `INSERT INTO audit_logs (actor_role, action, metadata)
            VALUES ('SUPERUSER', 'TEST_AGENTS_PURGED', $1)`,
      [
        JSON.stringify({
          agents_deleted: agents.rowCount ?? 0,
          agents_kept: kept,
          demo_unit_removed: demoUnit > 0,
        }),
      ],
    );

    return {
      agents: agents.rowCount ?? 0,
      sessions: sessions.rowCount ?? 0,
      resetTokens: Number(tokenRows[0]?.n ?? 0),
      demoUnit,
      kept,
    };
  });
}

/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const confirmed = argv.includes('--yes');
const wipeAll = argv.includes('--wipe-all');
const withDemoUnit = argv.includes('--with-demo-unit');
const LINE = '─'.repeat(70);

async function main(): Promise<void> {
  if (!confirmed) {
    const rows = await survey();
    const keep = rows.filter((r) => r.keep);
    const remove = rows.filter((r) => !r.keep);
    const withTickets = remove.filter((r) => r.tickets > 0);

    console.log(`\n${LINE}`);
    console.log('  DRY RUN — nothing has been changed');
    console.log(LINE);

    console.log(`\n  KEEPING ${keep.length} agent(s):\n`);
    if (keep.length === 0) {
      console.log(
        KEEP_MOBILES.length === 0
          ? '    (none — KEEP_MOBILES is empty, this is a FULL WIPE)'
          : '    (none — KEEP_MOBILES matches no agent!)',
      );
    }
    for (const a of keep) {
      console.log(
        `    ${a.mobile_number.padEnd(13)} ${a.name.padEnd(22)} ${a.unit_code}`,
      );
    }

    console.log(`\n  DELETING ${remove.length} agent(s):\n`);
    for (const a of remove) {
      const mark = a.tickets > 0 ? `  ⛔ ${a.tickets} ticket(s)` : '';
      console.log(
        `    ${a.mobile_number.padEnd(13)} ${a.name.padEnd(22)} ` +
          `${a.unit_code}${mark}`,
      );
    }

    console.log(
      `\n  Demo unit ${DEMO_UNIT_CODE}: ` +
        (withDemoUnit ? 'WILL be removed' : 'kept (pass --with-demo-unit)'),
    );

    if (withTickets.length > 0) {
      console.log(
        `\n  ⛔ BLOCKED: ${withTickets.length} agent(s) have issued tickets.` +
          `\n     tickets.agent_id is ON DELETE RESTRICT, so they cannot be` +
          `\n     removed while those tickets exist. Clear tickets first:` +
          `\n       npm run db:reset-ticket-numbers -w @pravasi/backend -- --yes --wipe-all`,
      );
    } else {
      console.log(`\n  To apply:`);
      console.log(
        `    npm run db:purge-test-agents -w @pravasi/backend -- --yes` +
          (KEEP_MOBILES.length === 0 ? ' --wipe-all' : '') +
          ' --with-demo-unit',
      );
    }
    console.log(`\n${LINE}\n`);
    return;
  }

  const r = await apply(withDemoUnit);
  console.log(`\n${LINE}`);
  console.log('  TEST AGENTS PURGED');
  console.log(LINE);
  console.log(`\n  agents kept ......... ${r.kept}`);
  console.log(`  agents deleted ...... ${r.agents}`);
  console.log(`  login sessions ...... ${r.sessions}`);
  console.log(`  reset tokens ........ ${r.resetTokens}  (cascaded)`);
  console.log(
    `  demo unit ........... ${r.demoUnit > 0 ? `${DEMO_UNIT_CODE} removed` : 'kept'}`,
  );
  console.log(
    `\n  Agents register themselves at /login with their unit's invite PIN,` +
      `\n  so real staff can sign up whenever they are ready.`,
  );
  console.log(`\n${LINE}\n`);
}

main()
  .catch((err: unknown) => {
    console.error(
      `[purge-test-agents] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(closePool);
