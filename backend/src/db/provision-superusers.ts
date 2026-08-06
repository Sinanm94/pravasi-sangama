import { hashSecret } from '../lib/crypto.js';
import { generateSecurePassword } from '../lib/passwordGen.js';
import { closePool, withTransaction } from './index.js';

/**
 * Provisions 3 real Super User accounts (`ADMIN01`–`ADMIN03`) — full system
 * access, the top of §2's hierarchy, "exactly three superusers" per spec §4.
 *
 * NOT db:seed's `admin1`/`admin2`/`admin3`. Those are disposable dev
 * fixtures sharing one hardcoded password (`SUPERUSER_PASSWORD` in seed.ts),
 * guarded against production. These are real accounts, each with its own
 * generated password, meant to run once against production — no `NODE_ENV`
 * guard, same reasoning as provision-unit-admins.ts and
 * provision-scanners.ts.
 *
 * ⚠ This script DEACTIVATES every superuser that is not ADMIN01–ADMIN03,
 * including those dev fixtures — see the note above that UPDATE below. It
 * used to leave them alone and let the two sets coexist; that was the hole
 * that kept `admin1` / `SuperAdmin@2026` (a password committed to this
 * repository) working against a live deployment. If you need an extra
 * superuser beyond these three, add it to this file rather than creating it
 * by hand, or the next run of this script will switch it off.
 *
 * Idempotent (`ON CONFLICT (username) DO UPDATE`) but not a rotation tool:
 * every run reissues all 3 passwords, so a second run invalidates whatever
 * was already printed and handed out from the first — same caveat as
 * provision-scanners.ts.
 *
 * `email` is left NULL. Nobody has told this script what these three
 * people's real addresses are, and a fabricated one would be worse than
 * none — `auth.repository.ts`'s `findSuperuserByUsername` accepts a bare
 * username just fine, so login works either way.
 *
 * Passwords are 8 characters from the same unambiguous alphabet and
 * guaranteed upper/lower/digit mix as every other generated credential in
 * this codebase (`lib/passwordGen.ts`), hashed with the same `hashSecret()`
 * bcrypt path.
 *
 * Run with: npm run db:provision-superusers -w @pravasi/backend
 */

const SUPERUSER_COUNT = 3;
const PASSWORD_LENGTH = 8;

interface ProvisionedSuperuser {
  username: string;
  password: string;
}

/** Filled in by provision(), reported afterwards. */
let retiredUsernames: string[] = [];

async function provision(): Promise<ProvisionedSuperuser[]> {
  return withTransaction(async (client) => {
    const accounts: ProvisionedSuperuser[] = [];

    for (let n = 1; n <= SUPERUSER_COUNT; n += 1) {
      const username = `ADMIN${String(n).padStart(2, '0')}`;
      const name = `Administrator ${String(n).padStart(2, '0')}`;
      const password = generateSecurePassword(PASSWORD_LENGTH);
      const passwordHash = await hashSecret(password);

      await client.query(
        `INSERT INTO superusers (username, password_hash, name)
              VALUES ($1, $2, $3)
         ON CONFLICT (username) DO UPDATE
              -- Deliberately does not touch email: if one has since been set
              -- by hand, re-running this must not silently null it out.
              SET password_hash = EXCLUDED.password_hash,
                  name          = EXCLUDED.name,
                  is_active     = TRUE`,
        [username, passwordHash, name],
      );

      accounts.push({ username, password });
    }

    /* Everything that is not one of these three is switched off.
     *
     * Migration 012 disables the four known legacy names, but only those —
     * a migration cannot safely run "disable everything not on the
     * allowlist", because if it executes before this script has created
     * ADMIN01–03 it would leave zero active superusers and lock the system.
     * Here that risk does not exist: the allowlist was inserted moments ago
     * in this same transaction, so the rule is safe to apply in full and
     * catches any stray account the migration's name list does not know
     * about. Re-running this script re-asserts it. */
    const { rows: retired } = await client.query<{ username: string }>(
      `UPDATE superusers
          SET is_active = FALSE
        WHERE is_active
          AND username <> ALL($1::text[])
        RETURNING username`,
      [accounts.map((a) => a.username)],
    );

    await client.query(
      `INSERT INTO audit_logs (actor_role, action, metadata)
            VALUES ('SUPERUSER', 'SUPERUSERS_PROVISIONED', $1)`,
      [
        JSON.stringify({
          count: accounts.length,
          retired: retired.map((r) => r.username),
        }),
      ],
    );

    retiredUsernames = retired.map((r) => r.username);

    return accounts;
  });
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

function printDistributionList(accounts: ProvisionedSuperuser[]): void {
  const idWidth = Math.max(7, ...accounts.map((a) => a.username.length));
  const line = '─'.repeat(idWidth + 20);

  console.log(`\n${line}`);
  console.log('  NEW SUPER USER PASSWORDS — distribution list');
  console.log(line);
  console.log(`\n  ${accounts.length} accounts provisioned.\n`);

  console.log(`  ${'User_ID'.padEnd(idWidth)}  Plaintext_Password`);
  console.log(`  ${'-'.repeat(idWidth)}  -------------------`);
  for (const a of accounts) {
    console.log(`  ${a.username.padEnd(idWidth)}  ${a.password}`);
  }

  console.log('\n  CSV (copy from the line below):\n');
  console.log('  User_ID,Plaintext_Password');
  for (const a of accounts) {
    console.log(`  ${a.username},${a.password}`);
  }

  if (retiredUsernames.length > 0) {
    console.log(
      `\n  Deactivated ${retiredUsernames.length} other superuser account(s), ` +
        'so only the three above can sign in:',
    );
    for (const u of retiredUsernames) console.log(`      ${u}`);
  }

  console.log(
    `\n${line}` +
      '\n  Sign in at /login -> "Administrator sign in" with the User_ID above' +
      '\n  as the username. This is the only time these passwords are printed' +
      '\n  anywhere — they are not written to any file by this script. Save' +
      '\n  this output now. Re-running this script issues a NEW set of 3 and' +
      '\n  invalidates every password above.' +
      `\n${line}\n`,
  );
}

/* ------------------------------------------------------------------ */

provision()
  .then(printDistributionList)
  .catch((err: unknown) => {
    console.error(
      `[provision-superusers] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(closePool);
