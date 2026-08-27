import { hashSecret } from '../../lib/crypto.js';
import { randomDigits } from '../../lib/passwordGen.js';
import { closePool, withTransaction } from '../index.js';

/**
 * Creates any unit from the canonical roster that is MISSING, and touches
 * nothing that already exists.
 *
 *   npm run db:add-missing-units -w @pravasi/backend            # dry run
 *   npm run db:add-missing-units -w @pravasi/backend -- --yes   # apply
 *
 * ── Why this exists rather than just re-running db:provision-units ────
 *
 * `provision-unit-admins.ts` upserts with `ON CONFLICT DO UPDATE`, which
 * rewrites `unit_admins.password_hash`, `units.agent_invite_pin_hash` and
 * `units.agent_invite_pin` for EVERY unit on every run — resetting all 33
 * admin passwords and all 30 invite PINs back to the hardcoded values in
 * that file. That is correct for first-time provisioning and catastrophic
 * once those credentials are in people's hands: unit heads would be
 * reciting PINs that no longer work, and rotated passwords would silently
 * revert to the committed defaults.
 *
 * This script is `ON CONFLICT DO NOTHING`. An existing unit is left exactly
 * as it is — password, PIN, name, sector, all untouched. Only genuinely
 * absent units are inserted.
 *
 * ── The new units get FRESH random PINs, not the file's ───────────────
 *
 * A unit created here gets a newly generated 4-digit invite PIN rather than
 * the value in provision-unit-admins.ts, and it is printed once. Reusing
 * the committed literal would put a PIN that is public in this repository
 * onto a live unit — and §3.4 records that the invite PIN is now the only
 * barrier to minting a ticket issuer.
 *
 * No `unit_admins` row is created: that tier is switched off (§3.4), and a
 * unit does not need one to function. If it is ever turned back on, those
 * accounts are provisioned separately.
 */

const DIVISION_CODE = 'RIYADH';

interface UnitSeed {
  unit_code: string;
  sector: string;
  name: string;
}

/** The canonical 30, copied from provision-unit-admins.ts's UNITS array. */
const UNITS: readonly UnitSeed[] = [
  { unit_code: 'BAT01', sector: 'BATHA', name: '5 Building' },
  { unit_code: 'BAT02', sector: 'BATHA', name: 'Shara Rail' },
  { unit_code: 'BAT03', sector: 'BATHA', name: 'Old Saptco' },
  { unit_code: 'BAT04', sector: 'BATHA', name: 'Deera' },
  { unit_code: 'BAT05', sector: 'BATHA', name: 'Gurabi' },

  { unit_code: 'BAD01', sector: 'BADIYA', name: 'Shara Madeena' },
  { unit_code: 'BAD02', sector: 'BADIYA', name: 'Shara Abraz' },
  { unit_code: 'BAD03', sector: 'BADIYA', name: 'Wadi Laban' },

  { unit_code: 'SHI01', sector: 'SHIFA', name: 'Atheeka' },
  { unit_code: 'SHI02', sector: 'SHIFA', name: 'Al Badr' },
  { unit_code: 'SHI03', sector: 'SHIFA', name: 'Aziziyyah' },

  { unit_code: 'MAL01', sector: 'MALAZ', name: 'Jarir' },
  { unit_code: 'MAL02', sector: 'MALAZ', name: 'Sulay' },
  { unit_code: 'MAL03', sector: 'MALAZ', name: 'Shara Arbaeen' },

  { unit_code: 'MUR01', sector: 'MUROOJ', name: 'Darayiyyah' },
  { unit_code: 'MUR02', sector: 'MUROOJ', name: 'Mursalath' },
  { unit_code: 'MUR03', sector: 'MUROOJ', name: 'Dallah' },

  { unit_code: 'GHU01', sector: 'GHURNATHA', name: 'Sahafa' },
  { unit_code: 'GHU02', sector: 'GHURNATHA', name: 'Nakheel' },
  { unit_code: 'GHU03', sector: 'GHURNATHA', name: 'Malga' },

  { unit_code: 'OLA01', sector: 'OLAYA', name: 'Sulaimaniyyah' },
  { unit_code: 'OLA02', sector: 'OLAYA', name: 'Hara' },
  { unit_code: 'OLA03', sector: 'OLAYA', name: 'Thakassusi' },

  { unit_code: 'RAB01', sector: 'RABVA', name: 'Rawdah' },
  { unit_code: 'RAB02', sector: 'RABVA', name: 'Rayyan' },
  { unit_code: 'RAB03', sector: 'RABVA', name: 'Rawabi' },

  { unit_code: 'SUD01', sector: 'SUDAIR', name: 'Sudair' },
  { unit_code: 'MUZ01', sector: 'MUZAMIYYAH', name: 'Muzamiyyah' },
  { unit_code: 'SAN01', sector: 'SANAYIYYAH', name: 'Sanayiyyah' },
  { unit_code: 'KHA01', sector: 'KHARJ', name: 'Kharj' },
] as const;

interface Created {
  unit_code: string;
  name: string;
  sector: string;
  invitePin: string;
}

async function survey(): Promise<UnitSeed[]> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ unit_code: string }>(
      `SELECT u.unit_code
         FROM units u JOIN divisions d ON d.id = u.division_id
        WHERE d.code = $1`,
      [DIVISION_CODE],
    );
    const present = new Set(rows.map((r) => r.unit_code));
    return UNITS.filter((u) => !present.has(u.unit_code));
  });
}

async function apply(): Promise<Created[]> {
  return withTransaction(async (client) => {
    const { rows: divRows } = await client.query<{ id: string }>(
      `SELECT id FROM divisions WHERE code = $1`,
      [DIVISION_CODE],
    );
    const divisionId = divRows[0]?.id;
    if (!divisionId) {
      throw new Error(
        `Division ${DIVISION_CODE} does not exist. Run db:provision-units ` +
          `once for the initial setup before using this script.`,
      );
    }

    const created: Created[] = [];

    for (const u of UNITS) {
      const invitePin = randomDigits(4);
      const invitePinHash = await hashSecret(invitePin);

      /* DO NOTHING, never DO UPDATE. An existing unit keeps its PIN, its
       * name and its sector — the whole reason this script exists. */
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO units
              (division_id, unit_code, name, sector,
               agent_invite_pin_hash, agent_invite_pin)
              VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (division_id, unit_code) DO NOTHING
           RETURNING id`,
        [divisionId, u.unit_code, u.name, u.sector, invitePinHash, invitePin],
      );

      // Zero rows back means it already existed and was left alone.
      if (rows.length > 0) {
        created.push({ ...u, invitePin });
      }
    }

    if (created.length > 0) {
      await client.query(
        `INSERT INTO audit_logs (actor_role, action, metadata)
              VALUES ('SUPERUSER', 'UNITS_BACKFILLED', $1)`,
        [JSON.stringify({ created: created.map((c) => c.unit_code) })],
      );
    }

    return created;
  });
}

/* ------------------------------------------------------------------ */

const confirmed = process.argv.slice(2).includes('--yes');
const LINE = '─'.repeat(66);

async function main(): Promise<void> {
  if (!confirmed) {
    const missing = await survey();

    console.log(`\n${LINE}`);
    console.log('  DRY RUN — nothing has been changed');
    console.log(LINE);

    if (missing.length === 0) {
      console.log('\n  All 30 units already exist. Nothing to do.');
      console.log(`\n${LINE}\n`);
      return;
    }

    console.log(`\n  ${missing.length} unit(s) missing, would be created:\n`);
    for (const u of missing) {
      console.log(`    ${u.unit_code.padEnd(7)} ${u.sector.padEnd(12)} ${u.name}`);
    }
    console.log(
      `\n  Existing units are NOT touched — no password, invite PIN,` +
        `\n  name or sector is changed by this script.` +
        `\n\n  New units get a freshly generated invite PIN, printed once.`,
    );
    console.log(`\n  To apply:`);
    console.log(`    npm run db:add-missing-units -w @pravasi/backend -- --yes`);
    console.log(`\n${LINE}\n`);
    return;
  }

  const created = await apply();

  console.log(`\n${LINE}`);
  console.log('  MISSING UNITS CREATED');
  console.log(LINE);

  if (created.length === 0) {
    console.log('\n  Nothing was missing. No changes made.');
    console.log(`\n${LINE}\n`);
    return;
  }

  console.log(`\n  ${created.length} unit(s) created.\n`);
  console.log(`  ${'Unit'.padEnd(7)}  ${'Sector'.padEnd(12)}  ${'Name'.padEnd(16)}  Invite PIN`);
  console.log(`  ${'-'.repeat(7)}  ${'-'.repeat(12)}  ${'-'.repeat(16)}  ----------`);
  for (const c of created) {
    console.log(
      `  ${c.unit_code.padEnd(7)}  ${c.sector.padEnd(12)}  ` +
        `${c.name.padEnd(16)}  ${c.invitePin}`,
    );
  }

  console.log(
    `\n${LINE}` +
      '\n  These PINs are printed ONCE. Give each to that unit head — they' +
      '\n  recite it to every agent who registers (§3.2). Every other unit' +
      '\n  keeps the PIN it already had.' +
      `\n${LINE}\n`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(
      `[add-missing-units] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  })
  .finally(closePool);
