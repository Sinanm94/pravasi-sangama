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

/** Gate channels for the scanner PIN login (spec §2, Option A). */
const GATES = [
  { gate_code: 'GATE1', name: 'Gate 1 — VIP', pin: '4321' },
  { gate_code: 'GATE2', name: 'Gate 2 — General', pin: '4321' },
] as const;

const UNITS = [
  {
    unit_code: '5BUILDING',
    name: '5 Building',
    sector: 'BATHA',
    pin: '1234',
  },
  {
    unit_code: 'DEERA',
    name: 'Deera',
    sector: 'BATHA',
    pin: '1234',
  },
] as const;

const AGENTS = [
  {
    mobile_number: '8888999955',
    name: 'Rajesh Nair',
    email: 'rajesh.nair@example.com',
    password: 'agent1234',
    unit_code: '5BUILDING',
  },
  {
    mobile_number: '8888999956',
    name: 'Suma Bhat',
    email: 'suma.bhat@example.com',
    password: 'agent1234',
    unit_code: '5BUILDING',
  },
  {
    mobile_number: '8888999957',
    name: 'Praveen Shetty',
    email: 'praveen.shetty@example.com',
    password: 'agent1234',
    unit_code: 'DEERA',
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

    for (const unit of UNITS) {
      const accessCodeHash = await hashSecret(unit.pin);

      // Natural key is (division_id, unit_code) — unit codes are unique
      // within a division, not globally.
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO units (division_id, unit_code, name, sector, access_code_hash)
              VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (division_id, unit_code) DO UPDATE
              SET name             = EXCLUDED.name,
                  sector           = EXCLUDED.sector,
                  access_code_hash = EXCLUDED.access_code_hash,
                  is_active        = TRUE
           RETURNING id`,
        [divisionId, unit.unit_code, unit.name, unit.sector, accessCodeHash],
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

    /* --- gates (spec §2, Option A) -------------------------------- */
    for (const gate of GATES) {
      const pinHash = await hashSecret(gate.pin);

      await client.query(
        `INSERT INTO gates (gate_code, name, division_id, pin_hash)
              VALUES ($1, $2, $3, $4)
         ON CONFLICT (gate_code) DO UPDATE
              SET name        = EXCLUDED.name,
                  division_id = EXCLUDED.division_id,
                  pin_hash    = EXCLUDED.pin_hash,
                  is_active   = TRUE`,
        [gate.gate_code, gate.name, divisionId, pinHash],
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

  console.log('\n  SUPERUSERS — sign in with EMAIL (spec §4)');
  for (const su of SUPERUSERS) {
    console.log(`    ${su.email}  /  ${SUPERUSER_PASSWORD}`);
  }

  console.log(`\n  DIVISION   ${DIVISION.name} (${DIVISION.code})`);

  console.log('\n  UNITS — step 1 of agent login');
  for (const u of UNITS) {
    console.log(`    ${u.sector} · ${u.name}`);
    console.log(`      unit_code : ${u.unit_code}`);
    console.log(`      pin       : ${u.pin}`);
  }

  console.log('\n  AGENTS — step 2 of agent login');
  for (const a of AGENTS) {
    console.log(`    ${a.name}  (unit ${a.unit_code})`);
    console.log(`      mobile_number : ${a.mobile_number}`);
    console.log(`      password      : ${a.password}`);
  }

  console.log('\n  GATES — scanner PIN login (spec §2)');
  for (const g of GATES) {
    console.log(`    ${g.name}`);
    console.log(`      gate_code : ${g.gate_code}`);
    console.log(`      pin       : ${g.pin}`);
  }

  console.log(`\n${line}`);
  console.log('  Verify the two-step flow:');
  console.log(`
    curl -c jar.txt -X POST localhost:${env.PORT}/api/auth/unit-login \\
      -H 'Content-Type: application/json' \\
      -d '{"unit_code":"5BUILDING","pin":"1234"}'

    curl -b jar.txt -c jar.txt -X POST localhost:${env.PORT}/api/auth/agent-login \\
      -H 'Content-Type: application/json' \\
      -d '{"mobile_number":"8888999955","password":"agent1234"}'
`);
  console.log('  Cross-unit rejection (expect 403 AGENT_UNIT_MISMATCH):');
  console.log(`
    # log in to 5BUILDING, then attempt step 2 as the DEERA agent
    curl -b jar.txt -X POST localhost:${env.PORT}/api/auth/agent-login \\
      -H 'Content-Type: application/json' \\
      -d '{"mobile_number":"8888999957","password":"agent1234"}'
`);
  console.log(line + '\n');
}

seed()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(closePool);
