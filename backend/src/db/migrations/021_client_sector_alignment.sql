-- ---------------------------------------------------------------------
-- 021 — Align clients.sector with the canonical sector names
--
-- `db:import-clients` wrote 'RABWA' for a sector this system has always
-- called 'RABVA' (migration 010, provision-unit-admins.ts). The result was
-- two entries in the sector dropdown for one real sector, with five clients
-- filed under a name no unit shares — so filtering by RABVA missed them and
-- filtering by RABWA found nothing else.
--
-- The import script is corrected too; this repairs rows already inserted,
-- because re-running the import SKIPS existing names by design and would
-- therefore never fix them.
--
-- Written as a general alignment rather than a single UPDATE for 'RABWA':
-- the same class of typo will recur as more lists are imported by hand, and
-- a client sector that matches no unit's sector is always wrong. Anything
-- that differs only by case or whitespace is snapped to the canonical
-- spelling held in `units.sector`.
--
-- 'SPONSORS' is deliberately left alone: it is a real grouping on the
-- source list and genuinely has no unit, so it is not drift.
-- ---------------------------------------------------------------------

BEGIN;

/* Snap to the canonical spelling wherever a case-insensitive match exists
 * in units.sector but the stored text differs. */
UPDATE clients c
   SET sector = canon.sector
  FROM (
    SELECT DISTINCT upper(trim(sector)) AS key, upper(trim(sector)) AS sector
      FROM units
     WHERE sector IS NOT NULL AND trim(sector) <> ''
  ) AS canon
 WHERE c.sector IS NOT NULL
   AND upper(trim(c.sector)) = canon.key
   AND c.sector <> canon.sector;

/* The specific known typo, which no unit matches and so the pass above
 * cannot reach. RABWA -> RABVA. */
UPDATE clients
   SET sector = 'RABVA'
 WHERE sector IS NOT NULL
   AND upper(trim(sector)) = 'RABWA';

/* Report anything still unmatched, so an operator sees the next typo
 * rather than discovering it as a stray dropdown entry weeks later. */
DO $$
DECLARE
  orphan TEXT;
BEGIN
  FOR orphan IN
    SELECT DISTINCT c.sector
      FROM clients c
     WHERE c.sector IS NOT NULL
       AND trim(c.sector) <> ''
       AND upper(trim(c.sector)) <> 'SPONSORS'
       AND NOT EXISTS (
         SELECT 1 FROM units u
          WHERE upper(trim(u.sector)) = upper(trim(c.sector))
       )
  LOOP
    RAISE NOTICE
      'clients.sector = % matches no unit. Check it is not a typo.', orphan;
  END LOOP;
END $$;

COMMIT;
