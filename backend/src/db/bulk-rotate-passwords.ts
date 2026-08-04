import { randomInt } from 'node:crypto';
import { hashSecret } from '../lib/crypto.js';
import { closePool, withTransaction } from './index.js';

/**
 * One-off bulk rotation for every unit_admins account — the 30 unit-scoped
 * logins plus the 3 Zone Supervisors, all of them still on the guessable
 * `<code>PW` password provision-unit-admins.ts committed to this repo in
 * plaintext (CLAUDE.md §3.3). This replaces all of them in a single run,
 * ahead of the event.
 *
 * Not `db:seed`: this is a production action against real accounts, so
 * there is no NODE_ENV guard — same reasoning as provision-unit-admins.ts
 * and rotate-credentials.ts.
 *
 * Unlike rotate-credentials.ts, this DOES print secrets to the console —
 * deliberately: the printed table *is* the deliverable, the distribution
 * list handed to volunteers on event day. Treat that output as sensitive
 * once printed — it is 33 live credentials in one place. Copy it straight
 * into wherever it's being distributed from and don't leave it sitting in
 * shell scrollback or a saved terminal log any longer than necessary.
 *
 * Run with: npm run db:bulk-rotate-passwords -w @pravasi/backend
 */

/* ------------------------------------------------------------------ */
/* Password generation                                                 */
/* ------------------------------------------------------------------ */

const PASSWORD_LENGTH = 6;

// 0/O, 1/l/I stripped — a volunteer misreading one of these at a gate is
// the exact failure this script exists to reduce, not just the guessable
// default password.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const ALL = UPPER + LOWER + DIGITS;

function randomChar(pool: string): string {
  return pool[randomInt(0, pool.length)]!;
}

/**
 * 6 characters, guaranteed at least one upper/lower/digit rather than left
 * to chance — "a mix" is the requirement, not merely a large enough pool
 * that a mix is likely. The three guaranteed picks are placed at random
 * positions among the six, via a Fisher–Yates shuffle using randomInt
 * (crypto-secure), not Math.random.
 */
function generatePassword(): string {
  const chars = [randomChar(UPPER), randomChar(LOWER), randomChar(DIGITS)];
  while (chars.length < PASSWORD_LENGTH) {
    chars.push(randomChar(ALL));
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join('');
}

/* ------------------------------------------------------------------ */

interface RotatedAccount {
  username: string;
  password: string;
}

async function bulkRotate(): Promise<RotatedAccount[]> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; username: string }>(
      `SELECT id, username FROM unit_admins WHERE is_active ORDER BY username`,
    );

    if (rows.length === 0) {
      throw new Error(
        'No active unit_admins rows found — run db:provision-units first.',
      );
    }

    const results: RotatedAccount[] = [];

    for (const row of rows) {
      const password = generatePassword();
      // Same hashing path as everywhere else in the system — hashSecret()
      // is bcrypt at 12 rounds (lib/crypto.ts), the one place that decision
      // is made.
      const hash = await hashSecret(password);

      await client.query(
        `UPDATE unit_admins SET password_hash = $2 WHERE id = $1`,
        [row.id, hash],
      );

      results.push({ username: row.username, password });
    }

    await client.query(
      `INSERT INTO audit_logs (actor_role, action, metadata)
            VALUES ('SUPERUSER', 'UNIT_ADMIN_PASSWORDS_BULK_ROTATED', $1)`,
      [JSON.stringify({ count: results.length })],
    );

    return results;
  });
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

function printDistributionList(accounts: RotatedAccount[]): void {
  const idWidth = Math.max(7, ...accounts.map((a) => a.username.length));
  const line = '─'.repeat(idWidth + 18);

  console.log(`\n${line}`);
  console.log('  NEW UNIT ADMIN PASSWORDS — event-day distribution list');
  console.log(line);
  console.log(`\n  ${accounts.length} accounts rotated.\n`);

  console.log(`  ${'User_ID'.padEnd(idWidth)}  New_Password`);
  console.log(`  ${'-'.repeat(idWidth)}  ------------`);
  for (const a of accounts) {
    console.log(`  ${a.username.padEnd(idWidth)}  ${a.password}`);
  }

  console.log('\n  CSV (copy from the line below):\n');
  console.log('  User_ID,New_Password');
  for (const a of accounts) {
    console.log(`  ${a.username},${a.password}`);
  }

  console.log(
    `\n${line}` +
      '\n  This is the only time these passwords are printed anywhere — they' +
      '\n  are not written to any file by this script. Save this output now.' +
      `\n${line}\n`,
  );
}

/* ------------------------------------------------------------------ */

bulkRotate()
  .then(printDistributionList)
  .catch((err: unknown) => {
    console.error(
      `[bulk-rotate-passwords] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(closePool);
