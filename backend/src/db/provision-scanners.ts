import { randomInt } from 'node:crypto';
import { hashSecret } from '../lib/crypto.js';
import { closePool, withTransaction } from './index.js';

/**
 * Provisions 20 Gate Scanner accounts (`SCAN01`–`SCAN20`) — the physical
 * entry-point channels gate volunteers sign into on the scanner PWA.
 *
 * These are rows in `gates`, not a new table. A gate is a place, not a
 * person (migration 003's own words) — the same shared-PIN model already
 * used for every gate in this system, `GateLoginSchema` (packages/shared)
 * validates the PIN as digits-only, and the scanner login page's keypad
 * (`inputMode="numeric"`) strips anything else as it's typed. This
 * deliberately generates 6-DIGIT numeric PINs, not the mixed-case
 * alphanumeric format bulk-rotate-passwords.ts uses for unit-admin accounts —
 * an alphanumeric password would be silently untypeable on that screen and
 * rejected by the schema even if it wasn't. See the chat history for this
 * decision; widening the gate-login system to alphanumeric passwords is a
 * real UX change (schema regex + the login page's input handling and copy),
 * not something to do as a side effect of a provisioning script.
 *
 * A pure numeric PIN has no letter/digit look-alike problem to strip
 * (`0`/`O`, `1`/`I`/`l` only collide when letters and digits share the same
 * string) — every digit is unambiguous on its own, so unlike
 * bulk-rotate-passwords.ts's alphabet this one is simply `0`–`9`.
 *
 * NOT `db:seed`: real event infrastructure, meant to run once (maybe twice)
 * against production, not disposable dev fixtures — same reasoning as
 * provision-unit-admins.ts. No `NODE_ENV` guard, but idempotent: re-running
 * upserts on `gate_code` and issues a FRESH set of 20 PINs each time. That
 * last part matters — re-running this after the first distribution has gone
 * out invalidates it. This is a provisioning tool, not a rotation tool; use
 * it once per real batch of 20, and treat a second run as replacing the
 * first, not adding to it.
 *
 * Run with: npm run db:provision-scanners -w @pravasi/backend
 */

const DIVISION = { code: 'RIYADH', name: 'Riyadh' };

const GATE_COUNT = 20;
const PIN_LENGTH = 6;

function randomPin(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += randomInt(0, 10).toString();
  }
  return out;
}

interface ProvisionedGate {
  gateCode: string;
  pin: string;
}

async function provision(): Promise<ProvisionedGate[]> {
  return withTransaction(async (client) => {
    const { rows: divRows } = await client.query<{ id: string }>(
      `INSERT INTO divisions (code, name)
            VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE
            SET name      = EXCLUDED.name,
                is_active = TRUE
         RETURNING id`,
      [DIVISION.code, DIVISION.name],
    );
    const divisionId = divRows[0]!.id;

    const gates: ProvisionedGate[] = [];

    for (let n = 1; n <= GATE_COUNT; n += 1) {
      const gateCode = `SCAN${String(n).padStart(2, '0')}`;
      const name = `Gate Scanner ${String(n).padStart(2, '0')}`;
      const pin = randomPin(PIN_LENGTH);
      const pinHash = await hashSecret(pin);

      await client.query(
        `INSERT INTO gates (division_id, gate_code, name, pin_hash, pin_rotated_at)
              VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (gate_code) DO UPDATE
              -- Every run reissues the PIN — see the header comment. A stale
              -- PIN left untouched here would mean the printed list lies
              -- about what's actually in the database.
              SET division_id    = EXCLUDED.division_id,
                  name            = EXCLUDED.name,
                  pin_hash        = EXCLUDED.pin_hash,
                  pin_rotated_at  = NOW(),
                  is_active       = TRUE`,
        [divisionId, gateCode, name, pinHash],
      );

      gates.push({ gateCode, pin });
    }

    await client.query(
      `INSERT INTO audit_logs (actor_role, action, metadata)
            VALUES ('SUPERUSER', 'GATES_PROVISIONED', $1)`,
      [JSON.stringify({ count: gates.length })],
    );

    return gates;
  });
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

function printDistributionList(gates: ProvisionedGate[]): void {
  const idWidth = Math.max(7, ...gates.map((g) => g.gateCode.length));
  const line = '─'.repeat(idWidth + 20);

  console.log(`\n${line}`);
  console.log('  GATE SCANNER PINS — event-day distribution list');
  console.log(line);
  console.log(`\n  ${gates.length} gate accounts provisioned (SCAN01–SCAN${GATE_COUNT}).\n`);

  console.log(`  ${'User_ID'.padEnd(idWidth)}  Plaintext_Password`);
  console.log(`  ${'-'.repeat(idWidth)}  -------------------`);
  for (const g of gates) {
    console.log(`  ${g.gateCode.padEnd(idWidth)}  ${g.pin}`);
  }

  console.log('\n  CSV (copy from the line below):\n');
  console.log('  User_ID,Plaintext_Password');
  for (const g of gates) {
    console.log(`  ${g.gateCode},${g.pin}`);
  }

  console.log(
    `\n${line}` +
      '\n  These PINs are typed at a physical gate under a numeric keypad —' +
      '\n  sign in on /scanner/login with the User_ID above as the gate code.' +
      '\n  This is the only time they are printed anywhere; save this output' +
      '\n  now. Re-running this script issues a NEW set of 20 and invalidates' +
      `\n  every PIN above.` +
      `\n${line}\n`,
  );
}

/* ------------------------------------------------------------------ */

provision()
  .then(printDistributionList)
  .catch((err: unknown) => {
    console.error(
      `[provision-scanners] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(closePool);
