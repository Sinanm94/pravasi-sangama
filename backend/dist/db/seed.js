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
const SUPERUSER = {
    username: 'superadmin',
    password: 'SuperAdmin@2026',
    name: 'System Administrator',
};
const DIVISION = { code: 'RIYADH', name: 'Riyadh' };
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
];
const AGENTS = [
    {
        mobile_number: '8888999955',
        name: 'Rajesh Nair',
        password: 'agent1234',
        unit_code: '5BUILDING',
    },
    {
        mobile_number: '8888999956',
        name: 'Suma Bhat',
        password: 'agent1234',
        unit_code: '5BUILDING',
    },
    {
        mobile_number: '8888999957',
        name: 'Praveen Shetty',
        password: 'agent1234',
        unit_code: 'DEERA',
    },
];
/* ------------------------------------------------------------------ */
async function seed() {
    // Seeding rewrites credentials. That must never happen by accident against
    // a live event database.
    if (env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
        throw new Error('Refusing to seed in production. Set ALLOW_PROD_SEED=true to override.');
    }
    await withTransaction(async (client) => {
        /* --- superuser ------------------------------------------------ */
        const superuserHash = await hashSecret(SUPERUSER.password);
        const { rows: superRows } = await client.query(`INSERT INTO superusers (username, password_hash, name)
            VALUES ($1, $2, $3)
       ON CONFLICT (username) DO UPDATE
            SET password_hash = EXCLUDED.password_hash,
                name          = EXCLUDED.name,
                is_active     = TRUE
         RETURNING id`, [SUPERUSER.username, superuserHash, SUPERUSER.name]);
        const superuserId = superRows[0].id;
        /* --- division ------------------------------------------------- */
        const { rows: divRows } = await client.query(`INSERT INTO divisions (code, name)
            VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE
            SET name      = EXCLUDED.name,
                is_active = TRUE
         RETURNING id`, [DIVISION.code, DIVISION.name]);
        const divisionId = divRows[0].id;
        /* --- units ---------------------------------------------------- */
        const unitIds = new Map();
        for (const unit of UNITS) {
            const accessCodeHash = await hashSecret(unit.pin);
            // Natural key is (division_id, unit_code) — unit codes are unique
            // within a division, not globally.
            const { rows } = await client.query(`INSERT INTO units (division_id, unit_code, name, sector, access_code_hash)
              VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (division_id, unit_code) DO UPDATE
              SET name             = EXCLUDED.name,
                  sector           = EXCLUDED.sector,
                  access_code_hash = EXCLUDED.access_code_hash,
                  is_active        = TRUE
           RETURNING id`, [divisionId, unit.unit_code, unit.name, unit.sector, accessCodeHash]);
            unitIds.set(unit.unit_code, rows[0].id);
        }
        /* --- agents --------------------------------------------------- */
        for (const agent of AGENTS) {
            const unitId = unitIds.get(agent.unit_code);
            if (!unitId) {
                throw new Error(`Agent ${agent.name} references unknown unit`);
            }
            const pinHash = await hashSecret(agent.password);
            await client.query(`INSERT INTO agents (unit_id, mobile_number, name, pin_hash)
              VALUES ($1, $2, $3, $4)
         ON CONFLICT (mobile_number) DO UPDATE
              SET unit_id   = EXCLUDED.unit_id,
                  name      = EXCLUDED.name,
                  pin_hash  = EXCLUDED.pin_hash,
                  is_active = TRUE`, [unitId, agent.mobile_number, agent.name, pinHash]);
        }
        await client.query(`INSERT INTO audit_logs (actor_role, actor_id, action, metadata)
            VALUES ('SUPERUSER', $1, 'DATABASE_SEEDED', $2)`, [superuserId, JSON.stringify({ division: DIVISION.code })]);
    });
    report();
}
function report() {
    const line = '─'.repeat(64);
    console.log(`\n${line}`);
    console.log('  SEED COMPLETE — development credentials');
    console.log(line);
    console.log('\n  SUPERUSER');
    console.log(`    username : ${SUPERUSER.username}`);
    console.log(`    password : ${SUPERUSER.password}`);
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
//# sourceMappingURL=seed.js.map