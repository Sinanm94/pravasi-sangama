-- ---------------------------------------------------------------------
-- 010 — Sector as the parent grouping for units
--
-- READ THIS BEFORE ASSUMING THIS MIGRATION CREATED SOMETHING NEW.
--
-- `units.sector` already existed (baseline schema.sql) and was already
-- populated with exactly the intended 12-sector / 30-unit mapping by
-- provision-unit-admins.ts. This migration does NOT introduce the hierarchy;
-- it makes the existing column trustworthy enough to filter and group by:
--
--   1. Normalises casing/whitespace, so 'Batha', ' BATHA ' and 'BATHA' stop
--      being three different sectors in a GROUP BY.
--   2. Re-asserts the canonical mapping keyed on unit_code, so any row that
--      drifted (hand-edited, or created before the roster settled) is pulled
--      back. Keyed on unit_code, not name: the code is the stable identifier,
--      names vary in casing ('5 Building' vs '5 BUILDING').
--   3. Indexes it, because the superuser ledger now filters on it.
--
-- Deliberately NOT a `sectors` table. That was the other option on the table
-- and it is the right call ONLY if a sector ever grows attributes of its own
-- (a sector head, a target, a colour). Today it is a name and nothing else,
-- so a table would buy referential integrity at the cost of a join on every
-- ledger/analytics query and a wider blast radius days before the event.
-- Promoting later is contained: add the table, add units.sector_id, backfill
-- from this same column, then swap the ~4 queries that read it.
--
-- Idempotent and safe to re-run.
-- ---------------------------------------------------------------------

BEGIN;

-- 1. Normalise whatever is already there.
UPDATE units
   SET sector = UPPER(TRIM(sector))
 WHERE sector IS NOT NULL
   AND sector IS DISTINCT FROM UPPER(TRIM(sector));

-- 2. Re-assert the canonical mapping. This list is the definitive one
--    supplied by the project owner; provision-unit-admins.ts writes the same
--    pairs at provisioning time, and the two must not diverge — if you edit
--    one, edit the other.
UPDATE units u
   SET sector = m.sector
  FROM (VALUES
    ('BAT01', 'BATHA'),
    ('BAT02', 'BATHA'),
    ('BAT03', 'BATHA'),
    ('BAT04', 'BATHA'),
    ('BAT05', 'BATHA'),

    ('BAD01', 'BADIYA'),
    ('BAD02', 'BADIYA'),
    ('BAD03', 'BADIYA'),

    ('SHI01', 'SHIFA'),
    ('SHI02', 'SHIFA'),
    ('SHI03', 'SHIFA'),

    ('MAL01', 'MALAZ'),
    ('MAL02', 'MALAZ'),
    ('MAL03', 'MALAZ'),

    ('MUR01', 'MUROOJ'),
    ('MUR02', 'MUROOJ'),
    ('MUR03', 'MUROOJ'),

    ('GHU01', 'GHURNATHA'),
    ('GHU02', 'GHURNATHA'),
    ('GHU03', 'GHURNATHA'),

    ('OLA01', 'OLAYA'),
    ('OLA02', 'OLAYA'),
    ('OLA03', 'OLAYA'),

    ('RAB01', 'RABVA'),
    ('RAB02', 'RABVA'),
    ('RAB03', 'RABVA'),

    ('SUD01', 'SUDAIR'),
    ('MUZ01', 'MUZAMIYYAH'),
    ('SAN01', 'SANAYIYYAH'),
    ('KHA01', 'KHARJ')
  ) AS m(unit_code, sector)
 WHERE u.unit_code = m.unit_code
   AND u.sector IS DISTINCT FROM m.sector;

-- 3. The superuser ledger filters and groups on this.
CREATE INDEX IF NOT EXISTS idx_units_sector ON units (sector)
  WHERE sector IS NOT NULL;

-- 4. Say plainly whether anything is left unsectored. Not an error — the dev
--    fixtures and any hand-created unit are allowed to sit outside the real
--    roster — but a sector filter will simply never show them, and that
--    should be a known fact rather than a surprise on event day.
DO $$
DECLARE
  orphans TEXT;
BEGIN
  SELECT string_agg(unit_code, ', ' ORDER BY unit_code)
    INTO orphans
    FROM units
   WHERE is_active
     AND (sector IS NULL OR TRIM(sector) = '');

  IF orphans IS NULL THEN
    RAISE NOTICE 'every active unit has a sector.';
  ELSE
    RAISE NOTICE
      'active units with no sector (will not appear under any sector '
      'filter): %', orphans;
  END IF;
END $$;

COMMIT;
