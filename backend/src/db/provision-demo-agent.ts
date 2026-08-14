import { hashSecret } from '../lib/crypto.js';
import { closePool, withTransaction } from './index.js';

/**
 * Provisions ONE throwaway unit + ONE throwaway agent for recording a demo
 * video, and tears the whole lot down again afterwards.
 *
 *   npm run db:demo-agent -w @pravasi/backend            # create
 *   npm run db:demo-agent -w @pravasi/backend -- --destroy   # remove
 *
 * ─────────────────────────────────────────────────────────────────────
 *  THIS IS A TEMPORARY FIXTURE THAT RUNS AGAINST PRODUCTION.
 * ─────────────────────────────────────────────────────────────────────
 *
 * It is deliberately NOT part of `db:seed`. The seed is disposable dev
 * fixtures behind a NODE_ENV guard; this has to run against the real
 * database, because the point is to film the real system. That means it
 * carries the same "no guard, but idempotent" contract as the other
 * provisioning scripts (§3.3) — and one extra obligation they do not have:
 *
 *   **it must be removable.** An account created for a video that cannot
 *   be deleted afterwards is a permanent hole in a live event system, and
 *   the invite PIN below is published to whoever watches the recording.
 *
 * Hence `--destroy`, and hence the naming: everything this script creates
 * is prefixed so a human reading the units list, the agent directory or
 * the ticket ledger can tell at a glance that it is not real.
 *
 * ── Why a dedicated unit rather than an agent on a real one ───────────
 *
 * Three reasons, all of which are about the teardown, not the setup:
 *
 *   1. Tickets issued on camera are written against `unit_id`. On a real
 *      unit they would land in that unit head's ledger and in the
 *      superuser's sector analytics as genuine sales, and would have to be
 *      picked back out by hand.
 *   2. `agents.unit_id` is ON DELETE RESTRICT, so the delete order matters
 *      regardless; owning the unit makes that order knowable.
 *   3. Filming a real unit's gateway means publishing a PIN that a real
 *      unit head has already distributed to real agents, and rotating it
 *      afterwards means re-distributing it to all of them. The demo unit's
 *      PIN is disposable by construction.
 */

const DIVISION = { code: 'RIYADH', name: 'Riyadh' };

/**
 * Fixed values, not generated ones. A demo has to be re-runnable and
 * re-recordable — if a retake needed a fresh set of credentials the script
 * printed once, the take would be blocked on finding that scrollback.
 *
 * The mobile number is inside the 10-digit CHECK on `agents` and starts
 * `0000` so it cannot collide with a real Saudi mobile that a genuine agent
 * might later register.
 */
const DEMO = {
  unitCode: 'DEMO01',
  unitName: 'Demo Unit (test only)',
  /* Its own sector, deliberately not a real one. `units.sector` is free
   * text and the superuser's sector filter is built from DISTINCT sector
   * (Known debt 7), so putting the demo unit in BATHA would fold demo
   * tickets into a real sector's totals. As 'DEMO' it shows up as its own
   * dropdown entry — obvious in the UI, and trivially excluded. */
  sector: 'DEMO',
  invitePin: '2026',

  agentMobile: '0000000001',
  agentName: 'Demo Agent',
  agentEmail: 'demo@pravasisangama.com',
  agentPassword: 'demo1234',
} as const;

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

async function create(): Promise<void> {
  await withTransaction(async (client) => {
    const { rows: divRows } = await client.query<{ id: string }>(
      `INSERT INTO divisions (code, name)
            VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, is_active = TRUE
         RETURNING id`,
      [DIVISION.code, DIVISION.name],
    );
    const divisionId = divRows[0]!.id;

    /* Both invite-PIN columns written from the same literal, in one
     * statement — the hash is what the gateway verifies, the plaintext is
     * what the unit dashboard displays, and setting one without the other
     * is the drift documented as Known debt 8. */
    const invitePinHash = await hashSecret(DEMO.invitePin);

    const { rows: unitRows } = await client.query<{ id: string }>(
      `INSERT INTO units
            (division_id, unit_code, name, sector,
             agent_invite_pin_hash, agent_invite_pin)
            VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (division_id, unit_code) DO UPDATE
            SET name                  = EXCLUDED.name,
                sector                = EXCLUDED.sector,
                agent_invite_pin_hash = EXCLUDED.agent_invite_pin_hash,
                agent_invite_pin      = EXCLUDED.agent_invite_pin,
                is_active             = TRUE
         RETURNING id`,
      [
        divisionId,
        DEMO.unitCode,
        DEMO.unitName,
        DEMO.sector,
        invitePinHash,
        DEMO.invitePin,
      ],
    );
    const unitId = unitRows[0]!.id;

    /* APPROVED and self_registered TRUE — the same row shape
     * createSelfRegisteredAgent() writes (§3.4 auto-approval), so the demo
     * account behaves identically to one that signed itself up on camera
     * rather than being a privileged variant that works differently. */
    const passwordHash = await hashSecret(DEMO.agentPassword);

    await client.query(
      `INSERT INTO agents
            (unit_id, mobile_number, name, email, pin_hash,
             self_registered, approval_status, is_active)
            VALUES ($1, $2, $3, $4, $5, TRUE, 'APPROVED', TRUE)
       ON CONFLICT (mobile_number) DO UPDATE
            SET unit_id         = EXCLUDED.unit_id,
                name            = EXCLUDED.name,
                email           = EXCLUDED.email,
                pin_hash        = EXCLUDED.pin_hash,
                approval_status = 'APPROVED',
                is_active       = TRUE`,
      [
        unitId,
        DEMO.agentMobile,
        DEMO.agentName,
        DEMO.agentEmail,
        passwordHash,
      ],
    );

    await client.query(
      `INSERT INTO audit_logs (actor_role, action, metadata)
            VALUES ('SUPERUSER', 'DEMO_FIXTURE_CREATED', $1)`,
      [JSON.stringify({ unit: DEMO.unitCode, agent: DEMO.agentMobile })],
    );
  });
}

/* ------------------------------------------------------------------ */
/* Destroy                                                             */
/* ------------------------------------------------------------------ */

interface TeardownReport {
  scanLogs: number;
  qrCodes: number;
  tickets: number;
  sessions: number;
  agents: number;
  units: number;
}

/**
 * Deletes in dependency order, because almost every FK pointing at the rows
 * we want gone is ON DELETE RESTRICT rather than CASCADE:
 *
 *   scan_logs.unit_id / .scanned_by  → SET NULL (harmless, but the rows are
 *                                      demo noise in the scan log screen, so
 *                                      they go too)
 *   qr_codes.ticket_id               → CASCADE from tickets
 *   tickets.agent_id / .unit_id      → RESTRICT  ← must go before the agent
 *   unit_sessions.agent_id / .unit_id→ RESTRICT  ← must go before the agent
 *   agents.unit_id                   → RESTRICT  ← must go before the unit
 *
 * Doing this in the wrong order does not corrupt anything — Postgres simply
 * refuses — but it does mean a half-finished teardown leaves the demo agent
 * live on a production system, which is exactly the state this script
 * exists to prevent. One transaction: all of it, or none of it.
 *
 * Deleting the tickets is the deliberate choice over revoking them. A demo
 * ticket is not a real sale that was cancelled; it never should have been
 * in the ledger, the analytics or the totals at all, and leaving REVOKED
 * rows behind would mean every revenue figure carries a footnote forever.
 */
async function destroy(): Promise<TeardownReport> {
  return withTransaction(async (client) => {
    const { rows: unitRows } = await client.query<{ id: string }>(
      `SELECT u.id FROM units u
         JOIN divisions d ON d.id = u.division_id
        WHERE u.unit_code = $1 AND d.code = $2`,
      [DEMO.unitCode, DIVISION.code],
    );

    if (unitRows.length === 0) {
      return {
        scanLogs: 0,
        qrCodes: 0,
        tickets: 0,
        sessions: 0,
        agents: 0,
        units: 0,
      };
    }
    const unitId = unitRows[0]!.id;

    const { rows: agentRows } = await client.query<{ id: string }>(
      `SELECT id FROM agents WHERE unit_id = $1`,
      [unitId],
    );
    const agentIds = agentRows.map((a) => a.id);

    const { rows: ticketRows } = await client.query<{ id: string }>(
      `SELECT id FROM tickets WHERE unit_id = $1`,
      [unitId],
    );
    const ticketIds = ticketRows.map((t) => t.id);

    /* scan_logs first: its FKs are SET NULL, so it would survive the ticket
     * delete as orphaned rows cluttering /admin/scans with demo traffic. */
    const scanLogs = await client.query(
      `DELETE FROM scan_logs
        WHERE unit_id = $1
           OR ($2::uuid[] <> '{}' AND ticket_id  = ANY($2::uuid[]))
           OR ($3::uuid[] <> '{}' AND scanned_by = ANY($3::uuid[]))`,
      [unitId, ticketIds, agentIds],
    );

    /* qr_codes cascade from tickets; counted first so the report is honest
     * about what went with them. */
    const { rows: qrRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM qr_codes
        WHERE $1::uuid[] <> '{}' AND ticket_id = ANY($1::uuid[])`,
      [ticketIds],
    );

    const tickets = await client.query(
      `DELETE FROM tickets WHERE unit_id = $1`,
      [unitId],
    );

    const sessions = await client.query(
      `DELETE FROM unit_sessions WHERE unit_id = $1`,
      [unitId],
    );

    const agents = await client.query(`DELETE FROM agents WHERE unit_id = $1`, [
      unitId,
    ]);

    /* Any unit_admins row pointed here is SET NULL, and supervisor
     * assignments CASCADE, so the unit itself can go last unconditionally. */
    const units = await client.query(`DELETE FROM units WHERE id = $1`, [
      unitId,
    ]);

    await client.query(
      `INSERT INTO audit_logs (actor_role, action, metadata)
            VALUES ('SUPERUSER', 'DEMO_FIXTURE_DESTROYED', $1)`,
      [
        JSON.stringify({
          unit: DEMO.unitCode,
          tickets: tickets.rowCount ?? 0,
          agents: agents.rowCount ?? 0,
        }),
      ],
    );

    return {
      scanLogs: scanLogs.rowCount ?? 0,
      qrCodes: Number(qrRows[0]?.count ?? 0),
      tickets: tickets.rowCount ?? 0,
      sessions: sessions.rowCount ?? 0,
      agents: agents.rowCount ?? 0,
      units: units.rowCount ?? 0,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

function printCreated(): void {
  const line = '─'.repeat(58);
  console.log(`\n${line}`);
  console.log('  DEMO FIXTURE — for video recording only');
  console.log(line);
  console.log('\n  UNIT GATEWAY  (first screen at /login)\n');
  console.log(`    Unit code .......... ${DEMO.unitCode}`);
  console.log(`    Invite PIN ......... ${DEMO.invitePin}`);
  console.log('\n  AGENT LOGIN  (the tab that unlocks behind it)\n');
  console.log(`    Mobile number ...... ${DEMO.agentMobile}`);
  console.log(`    Password ........... ${DEMO.agentPassword}`);
  console.log(`\n  Unit name .......... ${DEMO.unitName}`);
  console.log(`  Sector ............. ${DEMO.sector}`);
  console.log(
    `\n${line}` +
      '\n  The agent is APPROVED and can issue tickets immediately.' +
      '\n  Tickets issued during filming are real rows — they appear in' +
      '\n  the superuser ledger and analytics until this is torn down.' +
      '\n' +
      '\n  DELETE IT AFTERWARDS:' +
      '\n    npm run db:demo-agent -w @pravasi/backend -- --destroy' +
      '\n' +
      '\n  That removes the unit, the agent, and every ticket, QR code' +
      '\n  and scan log they produced — so nothing demo-related is left' +
      '\n  in the ledger or the revenue totals.' +
      `\n${line}\n`,
  );
}

function printDestroyed(r: TeardownReport): void {
  const line = '─'.repeat(58);
  console.log(`\n${line}`);
  console.log('  DEMO FIXTURE REMOVED');
  console.log(line);

  if (r.units === 0) {
    console.log('\n  Nothing to remove — the demo unit does not exist.');
    console.log(`\n${line}\n`);
    return;
  }

  console.log(`\n  units ........... ${r.units}`);
  console.log(`  agents .......... ${r.agents}`);
  console.log(`  tickets ......... ${r.tickets}`);
  console.log(`  qr codes ........ ${r.qrCodes}  (cascaded with the tickets)`);
  console.log(`  scan logs ....... ${r.scanLogs}`);
  console.log(`  unit sessions ... ${r.sessions}`);
  console.log(
    `\n${line}` +
      `\n  ${DEMO.unitCode} and ${DEMO.agentMobile} no longer exist. The` +
      '\n  audit_logs rows recording the fixture are kept on purpose — an' +
      '\n  audit trail that deletes itself is not an audit trail.' +
      `\n${line}\n`,
  );
}

/* ------------------------------------------------------------------ */

const shouldDestroy = process.argv.includes('--destroy');

const run = shouldDestroy
  ? destroy().then(printDestroyed)
  : create().then(printCreated);

run
  .catch((err: unknown) => {
    console.error(
      `[provision-demo-agent] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(closePool);
