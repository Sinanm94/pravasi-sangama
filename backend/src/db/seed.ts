import { hashSecret } from '../lib/crypto.js';
import { env } from '../config/env.js';
import { closePool, withTransaction } from './index.js';

/**
 * Development seed. Idempotent — every insert upserts on its natural key, so
 * re-running updates credentials in place rather than exploding on a unique
 * violation.
 *
 * Run with: npm run db:seed
 */

/* ------------------------------------------------------------------ */
/* Fixtures — plaintext here, hashed on the way in.                    */
/* ------------------------------------------------------------------ */

/**
 * Exactly three superusers (spec §4). There is no signup route for this role;
 * these rows are the only way such an account comes into existence.
 *
 * Development passwords only — DEPLOYMENT.md §1.4 covers creating the real
 * accounts without a password ever leaving your machine.
 */
const SUPERUSERS = [
  {
    username: 'admin1',
    email: 'admin1@pravasisangama.com',
    name: 'Administrator One',
  },
  {
    username: 'admin2',
    email: 'admin2@pravasisangama.com',
    name: 'Administrator Two',
  },
  {
    username: 'admin3',
    email: 'admin3@pravasisangama.com',
    name: 'Administrator Three',
  },
] as const;

const SUPERUSER_PASSWORD = 'SuperAdmin@2026';

const DIVISION = { code: 'RIYADH', name: 'Riyadh' };

/* db:seed no longer creates any gates. It originally seeded two
 * (GATE1/GATE2, PIN 4321) — retired by migration 008 once real gate
 * infrastructure existed via provision-scanners.ts (SCAN01–SCAN20). Adding
 * dev placeholders back here would just recreate the exact clutter that
 * migration existed to remove; there is no local-dev need for a seeded gate
 * that db:provision-scanners doesn't already cover for a real database. */

/* Units carry no login PIN of their own — migration 004 dropped
 * access_code_hash, and a unit is a posting, not an account. `agentInvitePin`
 * below is a DIFFERENT thing (migration 009, §3.2): the Unit Gateway a
 * volunteer clears before reaching the agent portal at all, not a unit
 * "logging in". Both dev units share the same memorable dev PIN — there is
 * no need for two different ones locally the way the 30 real units each get
 * their own (provision-unit-admins.ts).
 *
 * Codes are DEV-prefixed on purpose. The originals (5BUILDING, DEERA) shared
 * a namespace with the real production roster provisioned by
 * provision-unit-admins.ts (BAT01 = 5 Building, BAT04 = Deera in the same
 * BATHA sector) — db:seed got run against production once, and the two
 * ended up coexisting as duplicate phantom locations in the signup picker
 * until migration 006 retired them. A dev fixture and a real unit must never
 * be able to collide on unit_code again; the prefix is what guarantees that,
 * not discipline about when db:seed gets run. */
const DEV_AGENT_INVITE_PIN = '1234';

const UNITS = [
  { unit_code: 'DEV5BUILDING', name: '5 Building (Dev)', sector: 'BATHA' },
  { unit_code: 'DEVDEERA', name: 'Deera (Dev)', sector: 'BATHA' },
] as const;

const AGENTS = [
  {
    mobile_number: '8888999955',
    name: 'Rajesh Nair',
    email: 'rajesh.nair@example.com',
    password: 'agent1234',
    unit_code: 'DEV5BUILDING',
  },
  {
    mobile_number: '8888999956',
    name: 'Suma Bhat',
    email: 'suma.bhat@example.com',
    password: 'agent1234',
    unit_code: 'DEV5BUILDING',
  },
  {
    mobile_number: '8888999957',
    name: 'Praveen Shetty',
    email: 'praveen.shetty@example.com',
    password: 'agent1234',
    unit_code: 'DEVDEERA',
  },
] as const;

/* ------------------------------------------------------------------ */

async function seed() {
  // Seeding rewrites credentials. That must never happen by accident against
  // a live event database.
  if (env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    throw new Error(
      'Refusing to seed in production. Set ALLOW_PROD_SEED=true to override.',
    );
  }

  await withTransaction(async (client) => {
    /* --- superusers — exactly three (spec §4) --------------------- */
    const superuserHash = await hashSecret(SUPERUSER_PASSWORD);
    let superuserId = '';

    for (const su of SUPERUSERS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO superusers (username, email, password_hash, name)
              VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO UPDATE
              SET email         = EXCLUDED.email,
                  password_hash = EXCLUDED.password_hash,
                  name          = EXCLUDED.name,
                  is_active     = TRUE
           RETURNING id`,
        [su.username, su.email, superuserHash, su.name],
      );
      if (!superuserId) superuserId = rows[0]!.id;
    }

    // The pre-spec account. Left in place but disabled, so an existing
    // development database cannot still authenticate with it.
    await client.query(
      `UPDATE superusers SET is_active = FALSE WHERE username = 'superadmin'`,
    );

    /* --- division ------------------------------------------------- */
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

    /* --- units ---------------------------------------------------- */
    const unitIds = new Map<string, string>();
    const devInvitePinHash = await hashSecret(DEV_AGENT_INVITE_PIN);

    for (const unit of UNITS) {
      // Natural key is (division_id, unit_code) — unit codes are unique
      // within a division, not globally.
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO units
              (division_id, unit_code, name, sector,
               agent_invite_pin_hash, agent_invite_pin)
              VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (division_id, unit_code) DO UPDATE
              SET name                   = EXCLUDED.name,
                  sector                 = EXCLUDED.sector,
                  agent_invite_pin_hash  = EXCLUDED.agent_invite_pin_hash,
                  agent_invite_pin       = EXCLUDED.agent_invite_pin,
                  is_active              = TRUE
           RETURNING id`,
        [
          divisionId,
          unit.unit_code,
          unit.name,
          unit.sector,
          devInvitePinHash,
          DEV_AGENT_INVITE_PIN,
        ],
      );

      unitIds.set(unit.unit_code, rows[0]!.id);
    }

    /* --- agents --------------------------------------------------- */
    for (const agent of AGENTS) {
      const unitId = unitIds.get(agent.unit_code);
      if (!unitId) {
        throw new Error(`Agent ${agent.name} references unknown unit`);
      }

      const pinHash = await hashSecret(agent.password);

      // Seeded agents are APPROVED: an administrator created them, which is
      // the approval. Only self-registrations start PENDING.
      await client.query(
        `INSERT INTO agents
           (unit_id, mobile_number, name, email, pin_hash, approval_status)
              VALUES ($1, $2, $3, $4, $5, 'APPROVED')
         ON CONFLICT (mobile_number) DO UPDATE
              SET unit_id         = EXCLUDED.unit_id,
                  name            = EXCLUDED.name,
                  email           = EXCLUDED.email,
                  pin_hash        = EXCLUDED.pin_hash,
                  approval_status = 'APPROVED',
                  is_active       = TRUE`,
        [unitId, agent.mobile_number, agent.name, agent.email, pinHash],
      );
    }

    await client.query(
      `INSERT INTO audit_logs (actor_role, actor_id, action, metadata)
            VALUES ('SUPERUSER', $1, 'DATABASE_SEEDED', $2)`,
      [superuserId, JSON.stringify({ division: DIVISION.code })],
    );
  });

  report();
}

function report() {
  const line = '─'.repeat(64);

  console.log(`\n${line}`);
  console.log('  SEED COMPLETE — development credentials');
  console.log(line);

  // The login form's field is "Username"; the short form and the full
  // seeded email both work (findSuperuserByUsername matches either).
  console.log('\n  SUPERUSERS — sign in with USERNAME (or email)');
  for (const su of SUPERUSERS) {
    console.log(`    ${su.username}  (or ${su.email})  /  ${SUPERUSER_PASSWORD}`);
  }

  console.log(`\n  DIVISION   ${DIVISION.name} (${DIVISION.code})`);

  console.log(
    `\n  UNITS — agent postings, Unit Gateway PIN ${DEV_AGENT_INVITE_PIN} (both)`,
  );
  for (const u of UNITS) {
    console.log(`    ${u.sector} · ${u.name}`);
    console.log(`      unit_code : ${u.unit_code}`);
  }

  console.log('\n  AGENTS — sign in with mobile (or email) + password');
  for (const a of AGENTS) {
    console.log(`    ${a.name}  (unit ${a.unit_code})`);
    console.log(`      mobile_number : ${a.mobile_number}`);
    console.log(`      password      : ${a.password}`);
  }

  console.log(`\n${line}`);
  console.log('  Verify agent login (§3.2 — single step, no unit credential):');
  console.log(`
    curl -c jar.txt -X POST localhost:${env.PORT}/api/auth/agent-login \\
      -H 'Content-Type: application/json' \\
      -d '{"mobile_number":"8888999955","password":"agent1234"}'
`);
  console.log(line + '\n');
}

seed()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(closePool);
