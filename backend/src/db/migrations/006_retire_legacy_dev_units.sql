-- ---------------------------------------------------------------------
-- 006 — Retire the legacy dev-seed units (5BUILDING, DEERA)
--
-- These are seed.ts's original dev fixtures — the same real-world locations
-- the production roster now names BAT01 (5 Building) and BAT04 (Deera). With
-- both codes live, the signup picker offered two entries for one place.
--
-- NOT a blind DROP. `agents.unit_id`, `unit_sessions.unit_id` and
-- `tickets.unit_id` are all `ON DELETE RESTRICT` (`scan_logs` and
-- `unit_admins` are `SET NULL` and pose no risk). If any real agent or
-- ticket already exists against either unit — plausible, since these codes
-- have been live — a DELETE fails outright, and because migrate.ts runs
-- each file in its own transaction and stops the run on failure, that
-- failure would ALSO block every migration after this one, including 007's
-- new table. Guessing wrong here is not "wrong data left around", it is
-- "the migration run stops".
--
-- So: delete only when nothing references the row; otherwise deactivate.
-- Both branches fully satisfy the actual goal — "agents don't register
-- under phantom locations" — because listPublicUnits() and
-- findUnitIdByCode() (auth.repository.ts) already filter on `is_active`.
-- Deactivated is functionally invisible to signup and to every "active
-- units" listing; it differs from deleted only in that history referencing
-- it still resolves to a name instead of a dangling id.
--
-- A NOTICE is raised either way, so `db:migrate`'s output says plainly
-- which branch ran for which code — check it after running this against
-- production.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  legacy_code   TEXT;
  target_unit   RECORD;
  in_use        BOOLEAN;
BEGIN
  FOREACH legacy_code IN ARRAY ARRAY['5BUILDING', 'DEERA']
  LOOP
    SELECT id, unit_code INTO target_unit
      FROM units
     WHERE unit_code = legacy_code
     LIMIT 1;

    IF target_unit.id IS NULL THEN
      RAISE NOTICE 'unit % — not present, nothing to do', legacy_code;
      CONTINUE;
    END IF;

    SELECT EXISTS (SELECT 1 FROM agents        WHERE unit_id = target_unit.id)
        OR EXISTS (SELECT 1 FROM unit_sessions WHERE unit_id = target_unit.id)
        OR EXISTS (SELECT 1 FROM tickets       WHERE unit_id = target_unit.id)
      INTO in_use;

    IF in_use THEN
      UPDATE units SET is_active = FALSE WHERE id = target_unit.id;
      RAISE NOTICE
        'unit % — agents/sessions/tickets reference it; DEACTIVATED, not deleted. '
        'It is now invisible to signup and every active-units listing. '
        'Reassign or archive the referencing rows yourself, then DELETE it by hand '
        'if you want the row gone entirely.', legacy_code;
    ELSE
      DELETE FROM units WHERE id = target_unit.id;
      RAISE NOTICE 'unit % — nothing referenced it; DELETED.', legacy_code;
    END IF;
  END LOOP;
END $$;
