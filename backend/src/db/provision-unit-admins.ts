import { hashSecret } from '../lib/crypto.js';
import { closePool, withTransaction } from './index.js';

/**
 * Provisions the Unit Admin tier: 30 real units and 33 unit_admins accounts
 * that decentralise agent approval away from the superuser bottleneck.
 *
 * NOT `db:seed`. Deliberately a separate script, run once:
 *
 *   - `db:seed` is disposable dev fixtures, guarded against production, and
 *     safe to re-run destructively over throwaway data. This is the real
 *     event location roster — running it is a one-time real-world action,
 *     not a dev-environment reset.
 *   - It therefore has NO NODE_ENV guard, the same reasoning as
 *     db/rotate-credentials.ts: it must be runnable against production.
 *   - It IS idempotent (every insert upserts on its natural key), so running
 *     it twice updates rows in place rather than failing or duplicating.
 *
 * ⚠ SECURITY — READ BEFORE RUNNING AGAINST PRODUCTION
 *
 * Every password below is short, follows a guessable pattern (unit code +
 * "PW"), and is committed to this file in plaintext — because that is what
 * was asked for: an operation run by non-technical volunteers cannot lean on
 * a password manager. That trade is the same one already made for gate PINs
 * (§2, Option A) and is accepted here for the same reason. It is NOT a
 * reason to skip rotation:
 *
 *   npm run db:rotate -w @pravasi/backend -- unit-admin BAT01
 *
 * does one row; `audit-unit-admins` (same file) reports every row still
 * sitting on its provisioned password so you know what is left. Rotate
 * before the event, not after.
 *
 * Run with: npm run db:provision-units -w @pravasi/backend
 */

const DIVISION = { code: 'RIYADH', name: 'Riyadh' };

/**
 * unit_code doubles as the unit_admin's login username — the "User_ID" in
 * the source roster IS the unit code, by design: one account per location,
 * named after the location it approves for.
 *
 * `agentInvitePin` is a SEPARATE credential (migration 009, CLAUDE.md §3.2)
 * — the Unit Gateway PIN a unit head hands to their own agents so they land
 * in the right unit's registration form, deliberately NOT the same value as
 * `password` above. Unlike the unit_code (public, printed everywhere), this
 * one has to actually be unguessable from the code, so it is independently
 * generated per unit rather than following the `<code>PW` pattern.
 */
interface UnitEntry {
  unit_code: string;
  sector: string;
  name: string;
  password: string;
  agentInvitePin: string;
}

const UNITS: readonly UnitEntry[] = [
  { unit_code: 'BAT01', sector: 'BATHA', name: '5 Building', password: 'BAT01PW', agentInvitePin: '4170' },
  { unit_code: 'BAT02', sector: 'BATHA', name: 'Shara Rail', password: 'BAT02PW', agentInvitePin: '0268' },
  { unit_code: 'BAT03', sector: 'BATHA', name: 'Old Saptco', password: 'BAT03PW', agentInvitePin: '9205' },
  { unit_code: 'BAT04', sector: 'BATHA', name: 'Deera', password: 'BAT04PW', agentInvitePin: '5102' },
  { unit_code: 'BAT05', sector: 'BATHA', name: 'Gurabi', password: 'BAT05PW', agentInvitePin: '9541' },

  { unit_code: 'BAD01', sector: 'BADIYA', name: 'Shara Madeena', password: 'BAD01PW', agentInvitePin: '0287' },
  { unit_code: 'BAD02', sector: 'BADIYA', name: 'Shara Abraz', password: 'BAD02PW', agentInvitePin: '3340' },
  { unit_code: 'BAD03', sector: 'BADIYA', name: 'Wadi Laban', password: 'BAD03PW', agentInvitePin: '8542' },

  { unit_code: 'SHI01', sector: 'SHIFA', name: 'Atheeka', password: 'SHI01PW', agentInvitePin: '9579' },
  { unit_code: 'SHI02', sector: 'SHIFA', name: 'Al Badr', password: 'SHI02PW', agentInvitePin: '0394' },
  { unit_code: 'SHI03', sector: 'SHIFA', name: 'Aziziyyah', password: 'SHI03PW', agentInvitePin: '3095' },

  { unit_code: 'MAL01', sector: 'MALAZ', name: 'Jarir', password: 'MAL01PW', agentInvitePin: '6825' },
  { unit_code: 'MAL02', sector: 'MALAZ', name: 'Sulay', password: 'MAL02PW', agentInvitePin: '2710' },
  { unit_code: 'MAL03', sector: 'MALAZ', name: 'Shara Arbaeen', password: 'MAL03PW', agentInvitePin: '1026' },

  { unit_code: 'MUR01', sector: 'MUROOJ', name: 'Darayiyyah', password: 'MUR01PW', agentInvitePin: '4290' },
  { unit_code: 'MUR02', sector: 'MUROOJ', name: 'Mursalath', password: 'MUR02PW', agentInvitePin: '5845' },
  { unit_code: 'MUR03', sector: 'MUROOJ', name: 'Dallah', password: 'MUR03PW', agentInvitePin: '6679' },

  { unit_code: 'GHU01', sector: 'GHURNATHA', name: 'Sahafa', password: 'GHU01PW', agentInvitePin: '0660' },
  { unit_code: 'GHU02', sector: 'GHURNATHA', name: 'Nakheel', password: 'GHU02PW', agentInvitePin: '2103' },
  { unit_code: 'GHU03', sector: 'GHURNATHA', name: 'Malga', password: 'GHU03PW', agentInvitePin: '7505' },

  { unit_code: 'OLA01', sector: 'OLAYA', name: 'Sulaimaniyyah', password: 'OLA01PW', agentInvitePin: '5006' },
  { unit_code: 'OLA02', sector: 'OLAYA', name: 'Hara', password: 'OLA02PW', agentInvitePin: '3512' },
  { unit_code: 'OLA03', sector: 'OLAYA', name: 'Thakassusi', password: 'OLA03PW', agentInvitePin: '7447' },

  { unit_code: 'RAB01', sector: 'RABVA', name: 'Rawdah', password: 'RAB01PW', agentInvitePin: '0752' },
  { unit_code: 'RAB02', sector: 'RABVA', name: 'Rayyan', password: 'RAB02PW', agentInvitePin: '0358' },
  { unit_code: 'RAB03', sector: 'RABVA', name: 'Rawabi', password: 'RAB03PW', agentInvitePin: '1207' },

  { unit_code: 'SUD01', sector: 'SUDAIR', name: 'Sudair', password: 'SUD01PW', agentInvitePin: '9265' },
  { unit_code: 'MUZ01', sector: 'MUZAMIYYAH', name: 'Muzamiyyah', password: 'MUZ01PW', agentInvitePin: '6865' },
  { unit_code: 'SAN01', sector: 'SANAYIYYAH', name: 'Sanayiyyah', password: 'SAN01PW', agentInvitePin: '1449' },
  { unit_code: 'KHA01', sector: 'KHARJ', name: 'Kharj', password: 'KHA01PW', agentInvitePin: '4060' },
] as const;

/**
 * Still `unit_id = NULL` — a zone supervisor covers many units, and
 * `unit_admins.unit_id` is a single unit by design (it is still the right
 * column for the 30 one-location admins above). Multi-unit coverage is
 * `supervisor_unit_assignments` (migration 007) instead, seeded below.
 *
 * Nobody has handed this script the real geographic assignment yet, so the
 * split below is a **placeholder**, not a coverage decision: `UNITS` in
 * array order, chunked into three groups of ten (`UNITS[0..9]` -> ZON01,
 * `[10..19]` -> ZON02, `[20..29]` -> ZON03). It exists so a zone supervisor's
 * dashboard is populated and testable today, not because units 1–10 have any
 * real relationship to each other. The INSERT that seeds
 * supervisor_unit_assignments below is `ON CONFLICT DO NOTHING`, so tightening
 * the split later means deleting the stale rows for a zone before
 * re-provisioning it, not editing this file's array order in place.
 */
const ZONE_SUPERVISORS = [
  { username: 'ZON01', name: 'Zone Supervisor 01', password: 'ZON01PW' },
  { username: 'ZON02', name: 'Zone Supervisor 02', password: 'ZON02PW' },
  { username: 'ZON03', name: 'Zone Supervisor 03', password: 'ZON03PW' },
] as const;

const UNITS_PER_ZONE = 10;

/**
 * Every password this script writes, keyed by username. Exported so
 * `db:rotate -- audit-unit-admins` can check each row against the specific
 * password IT was provisioned with, rather than one shared value — unlike
 * superuser/agent/gate, there is no single seeded secret here to check
 * against.
 */
export const UNIT_ADMIN_INITIAL_PASSWORDS: Readonly<Record<string, string>> =
  Object.fromEntries([
    ...UNITS.map((u) => [u.unit_code, u.password]),
    ...ZONE_SUPERVISORS.map((z) => [z.username, z.password]),
  ]);

/* ------------------------------------------------------------------ */

async function provision(): Promise<void> {
  await withTransaction(async (client) => {
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

    /* --- 30 real units --------------------------------------------- */
    const unitIds = new Map<string, string>();

    for (const u of UNITS) {
      const invitePinHash = await hashSecret(u.agentInvitePin);

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO units (division_id, unit_code, name, sector, agent_invite_pin_hash)
              VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (division_id, unit_code) DO UPDATE
              SET name                   = EXCLUDED.name,
                  sector                 = EXCLUDED.sector,
                  agent_invite_pin_hash  = EXCLUDED.agent_invite_pin_hash,
                  is_active              = TRUE
           RETURNING id`,
        [divisionId, u.unit_code, u.name, u.sector, invitePinHash],
      );
      unitIds.set(u.unit_code, rows[0]!.id);
    }

    /* --- 30 unit-scoped admins --------------------------------------- */
    for (const u of UNITS) {
      const unitId = unitIds.get(u.unit_code);
      if (!unitId) throw new Error(`No unit row for ${u.unit_code}`);

      const passwordHash = await hashSecret(u.password);

      await client.query(
        `INSERT INTO unit_admins (unit_id, username, password_hash, name)
              VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO UPDATE
              SET unit_id       = EXCLUDED.unit_id,
                  password_hash = EXCLUDED.password_hash,
                  name          = EXCLUDED.name,
                  is_active     = TRUE`,
        [unitId, u.unit_code, passwordHash, `${u.sector} — ${u.name}`],
      );
    }

    /* --- 3 unscoped zone admins --------------------------------------- */
    const zoneAdminIds = new Map<string, string>();

    for (const z of ZONE_SUPERVISORS) {
      const passwordHash = await hashSecret(z.password);

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO unit_admins (unit_id, username, password_hash, name)
              VALUES (NULL, $1, $2, $3)
         ON CONFLICT (username) DO UPDATE
              -- Deliberately does NOT touch unit_id on conflict: if a
              -- superuser has since assigned this zone a direct unit by
              -- hand, re-running this script must not silently unassign it.
              -- (unit_id is orthogonal to the zone assignments below in any
              -- case — a supervisor can have both.)
              SET password_hash = EXCLUDED.password_hash,
                  name          = EXCLUDED.name,
                  is_active     = TRUE
           RETURNING id`,
        [z.username, passwordHash, z.name],
      );
      zoneAdminIds.set(z.username, rows[0]!.id);
    }

    /* --- zone coverage: UNITS chunked 10/10/10, in array order --------- */
    const unitCodesInOrder = UNITS.map((u) => u.unit_code);
    let assignedPairs = 0;

    for (const [zoneIndex, zone] of ZONE_SUPERVISORS.entries()) {
      const adminId = zoneAdminIds.get(zone.username);
      if (!adminId) throw new Error(`No unit_admins row for ${zone.username}`);

      const chunk = unitCodesInOrder.slice(
        zoneIndex * UNITS_PER_ZONE,
        (zoneIndex + 1) * UNITS_PER_ZONE,
      );

      for (const unitCode of chunk) {
        const unitId = unitIds.get(unitCode);
        if (!unitId) throw new Error(`No unit row for ${unitCode}`);

        // ON CONFLICT DO NOTHING, not an upsert with a no-op SET: the pair
        // itself is the whole row (plus created_at, which a re-run should
        // not disturb). A superuser who has since deleted a stale
        // assignment by hand must have that deletion stick across reruns of
        // this placeholder split, not have it silently reinserted.
        await client.query(
          `INSERT INTO supervisor_unit_assignments (admin_id, unit_id)
                VALUES ($1, $2)
           ON CONFLICT (admin_id, unit_id) DO NOTHING`,
          [adminId, unitId],
        );
        assignedPairs += 1;
      }
    }

    await client.query(
      `INSERT INTO audit_logs (actor_role, action, metadata)
            VALUES ('SUPERUSER', 'UNIT_ADMINS_PROVISIONED', $1)`,
      [
        JSON.stringify({
          units: UNITS.length,
          zone_supervisors: ZONE_SUPERVISORS.length,
          zone_assignments: assignedPairs,
        }),
      ],
    );
  });

  report();
}

function report(): void {
  const line = '─'.repeat(64);

  console.log(`\n${line}`);
  console.log('  UNIT ADMIN TIER PROVISIONED');
  console.log(line);

  console.log(`\n  ${UNITS.length} units created/updated under ${DIVISION.name}.`);
  console.log(`  ${UNITS.length} unit-scoped admin accounts (username = unit code).`);
  console.log(
    `  ${ZONE_SUPERVISORS.length} zone-supervisor accounts — no direct unit_id, ` +
      'covering units via supervisor_unit_assignments (migration 007).',
  );

  console.log(
    `\n  ⚠ Coverage below is a PLACEHOLDER split — ${UNITS_PER_ZONE} units each, ` +
      'in the UNITS array\'s order, not a real geographic assignment:',
  );
  for (const [i, z] of ZONE_SUPERVISORS.entries()) {
    const chunk = UNITS.slice(i * UNITS_PER_ZONE, (i + 1) * UNITS_PER_ZONE);
    const codes = chunk.map((u) => u.unit_code).join(', ');
    console.log(`      ${z.username}  (${z.name})  — ${chunk.length} units: ${codes}`);
  }
  console.log(
    '  Replace with real coverage once decided — delete the stale rows for a' +
      '\n  zone from supervisor_unit_assignments, then insert the correct set' +
      '\n  (or re-run this script after editing the split above). A supervisor' +
      '\n  can also be given a single direct posting via unit_admins.unit_id;' +
      '\n  the two mechanisms compose, they are not exclusive.',
  );

  console.log(
    `\n  Passwords are NOT printed here — they were given to you directly and` +
      `\n  are already committed to provision-unit-admins.ts in plaintext.` +
      `\n  Rotate them before the event:` +
      `\n      npm run db:rotate -w @pravasi/backend -- audit-unit-admins` +
      `\n      npm run db:rotate -w @pravasi/backend -- unit-admin BAT01`,
  );

  console.log(
    `\n  AGENT INVITE PINS (§3.2) — hand each unit head their own, only.` +
      '\n  Unlike the login passwords above, these ARE printed here: a unit' +
      "\n  head recites this to every agent they recruit, so it can't be a" +
      '\n  one-person secret the way a login password is.',
  );
  for (const u of UNITS) {
    console.log(`      ${u.unit_code.padEnd(6)} ${u.agentInvitePin}`);
  }

  console.log(`\n${line}\n`);
}

provision()
  .catch((err) => {
    console.error('[provision-unit-admins] failed:', err);
    process.exitCode = 1;
  })
  .finally(closePool);
