import { hashSecret } from '../lib/crypto.js';
import { PASSWORD_ALPHABET, randomChar } from '../lib/passwordGen.js';
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

const SUFFIX_LENGTH = 3;

/** BAT01 -> Bat01. Every unit_admins.username is already exactly this
 *  shape — 3-letter sector + 2 digits for the 30 unit-scoped accounts,
 *  ZON0N for the 3 zone accounts — so no separate unit-code lookup is
 *  needed, the username IS the code (provision-unit-admins.ts's own
 *  design). */
function titleCase(code: string): string {
  return code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
}

/**
 * TitleCasedUnitCode-XXX, e.g. `Bat01-7kX`. The previous fully-random 6
 * characters were unpredictable but hard for a volunteer to remember or
 * recover from a typo. Prefixing with the account's own username — already
 * public, already printed on the unit roster and every dashboard — buys
 * memorability for free without weakening the password: the entire security
 * budget is carried by the 3-character suffix.
 *
 * The suffix is 3 independent picks from the full alphabet, not a
 * guaranteed one-of-each-class triple like generateSecurePassword() uses —
 * at only 3 characters, forcing a fixed class per position would narrow the
 * search space and telegraph the pattern more than it would help anyone
 * remember it.
 */
function generateMemorablePassword(code: string): string {
  const suffix = Array.from({ length: SUFFIX_LENGTH }, () =>
    randomChar(PASSWORD_ALPHABET),
  ).join('');
  return `${titleCase(code)}-${suffix}`;
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
      const password = generateMemorablePassword(row.username);
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
