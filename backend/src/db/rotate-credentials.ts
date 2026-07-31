import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { hashSecret, verifySecret } from '../lib/crypto.js';
import { closePool, query } from './index.js';

/**
 * Credential rotation for a live deployment.
 *
 * `db:seed` writes credentials that are committed to this repository
 * (DEPLOYMENT.md §1.4). If it was ever run against production, every one of
 * them is public. This tool finds those rows and replaces the secrets.
 *
 * Unlike the seeder, this is *meant* to run against production, so there is
 * no NODE_ENV guard. What it does have:
 *
 *   - Secrets are read from stdin, never from argv. A password on the command
 *     line lands in shell history and is visible in `ps` to every other
 *     process on the box.
 *   - Nothing is ever echoed or logged. Output names the row that changed and
 *     nothing else.
 *   - `audit` bcrypt-compares each row against the published seed values, so
 *     you learn exactly what is exposed instead of guessing.
 *
 * Usage:
 *   npm run db:rotate -w @pravasi/backend -- audit
 *   npm run db:rotate -w @pravasi/backend -- superuser admin1
 *   npm run db:rotate -w @pravasi/backend -- agent 8888999955
 *   npm run db:rotate -w @pravasi/backend -- gate GATE1
 */

/* The values in seed.ts. Kept here so `audit` can prove whether a given row
 * is still using one, rather than assuming from the row's existence. */
const SEEDED_SECRETS = {
  superuser: 'SuperAdmin@2026',
  agent: 'agent1234',
  gate: '4321',
} as const;

/* No `unit` entry: migration 004 dropped units.access_code_hash. Units are a
 * posting, not a login, so there is no unit secret left to audit or rotate. */

const MIN_LENGTH = 10;

/** Reads a secret without echoing it. Falls back to a pipe when not a TTY. */
async function readSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').trim();
  }

  process.stdout.write(label);

  // readline echoes to `output`; a sink that discards keeps the terminal clean.
  const sink = new Writable({ write: (_c, _e, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: sink, terminal: true });

  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function promptNewSecret(what: string): Promise<string> {
  const first = await readSecret(`New ${what}: `);
  if (first.length < MIN_LENGTH) {
    throw new Error(`Too short — use at least ${MIN_LENGTH} characters.`);
  }
  const second = await readSecret(`Confirm ${what}: `);
  if (first !== second) throw new Error('Entries did not match.');
  return first;
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

interface HashRow {
  label: string;
  hash: string | null;
}

async function auditTable(
  kind: keyof typeof SEEDED_SECRETS,
  rows: HashRow[],
): Promise<number> {
  let exposed = 0;

  for (const row of rows) {
    if (!row.hash) continue;
    if (await verifySecret(SEEDED_SECRETS[kind], row.hash)) {
      console.log(`  EXPOSED  ${kind.padEnd(10)} ${row.label}`);
      exposed += 1;
    }
  }

  return exposed;
}

async function audit(): Promise<void> {
  console.log('\nChecking every credential against the values in seed.ts.\n');

  const superusers = await query<{ username: string; password_hash: string }>(
    `SELECT username, password_hash FROM superusers WHERE is_active`,
  );
  const agents = await query<{ mobile_number: string; pin_hash: string | null }>(
    `SELECT mobile_number, pin_hash FROM agents WHERE is_active`,
  );
  const gates = await query<{ gate_code: string; pin_hash: string }>(
    `SELECT gate_code, pin_hash FROM gates WHERE is_active`,
  );

  const exposed =
    (await auditTable(
      'superuser',
      superusers.rows.map((r) => ({ label: r.username, hash: r.password_hash })),
    )) +
    (await auditTable(
      'agent',
      agents.rows.map((r) => ({ label: r.mobile_number, hash: r.pin_hash })),
    )) +
    (await auditTable(
      'gate',
      gates.rows.map((r) => ({ label: r.gate_code, hash: r.pin_hash })),
    ));

  if (exposed === 0) {
    console.log('  No credential matches a seeded value.\n');
    return;
  }

  console.log(
    `\n  ${exposed} credential(s) are public — anyone with the repo can use them.` +
      '\n  Rotate each one, then re-run `audit` to confirm.\n',
  );
  process.exitCode = 1;
}

/* ------------------------------------------------------------------ */
/* Rotation                                                            */
/* ------------------------------------------------------------------ */

/** Every rotation is one UPDATE returning the row, so a typo'd identifier
 *  reports "no such row" instead of silently changing nothing. */
async function rotate(
  kind: keyof typeof SEEDED_SECRETS,
  identifier: string,
): Promise<void> {
  const statements = {
    superuser: {
      sql: `UPDATE superusers SET password_hash = $2 WHERE username = $1
            RETURNING username AS label`,
      what: 'superuser password',
    },
    agent: {
      sql: `UPDATE agents SET pin_hash = $2 WHERE mobile_number = $1
            RETURNING mobile_number AS label`,
      what: 'agent PIN',
    },
    gate: {
      sql: `UPDATE gates SET pin_hash = $2, pin_rotated_at = NOW()
             WHERE gate_code = $1
            RETURNING gate_code AS label`,
      what: 'gate PIN',
    },
  }[kind];

  const secret = await promptNewSecret(statements.what);
  const hash = await hashSecret(secret);

  const { rows } = await query<{ label: string }>(statements.sql, [
    identifier,
    hash,
  ]);

  if (rows.length === 0) {
    throw new Error(`No ${kind} matching ${JSON.stringify(identifier)}.`);
  }

  console.log(`Rotated ${statements.what} for ${rows[0]!.label}.`);
}

/* ------------------------------------------------------------------ */

const USAGE = `
Usage:
  db:rotate audit
  db:rotate superuser <username>
  db:rotate agent     <mobile_number>
  db:rotate gate      <gate_code>
`;

async function main(): Promise<void> {
  const [command, identifier] = process.argv.slice(2);

  if (command === 'audit') {
    await audit();
    return;
  }

  if (command === 'superuser' || command === 'agent' || command === 'gate') {
    if (!identifier) throw new Error(`${command} needs an identifier.${USAGE}`);
    await rotate(command, identifier);
    return;
  }

  throw new Error(`Unknown command ${JSON.stringify(command ?? '')}.${USAGE}`);
}

main()
  .catch((err: unknown) => {
    console.error(`[rotate] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(closePool);
