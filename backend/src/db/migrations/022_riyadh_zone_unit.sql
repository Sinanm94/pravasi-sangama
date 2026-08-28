-- ---------------------------------------------------------------------
-- 022 — A dedicated "Riyadh Zone" unit for Sponsors-Riyadh Zone / DAYEE
--
-- On explicit instruction from the project owner, two new client sector
-- values sit alongside the existing SPONSORS bucket, and unlike SPONSORS
-- both of them DO have a unit under them — the same single unit, "Riyadh
-- Zone" — rather than the sector alone being the classification.
--
--   SPONSORS               -> no unit (021's behaviour, unchanged)
--   SPONSORS-RIYADH ZONE   -> unit_id = RZN01 (Riyadh Zone)
--   DAYEE-RIYADH ZONE      -> unit_id = RZN01 (Riyadh Zone)
--
-- ── A real `units` row, not another `clients.sector`-only bucket ──────
--
-- SPONSORS clients have no unit precisely because a sector cannot honestly
-- be narrowed to one of several real units (019's header). That constraint
-- does not apply here: the client explicitly wants ONE unit, shared by
-- both these sectors, to appear in the Unit dropdown once either is
-- selected — so this is exactly what `units` already models, not a
-- workaround for the case where `units` doesn't fit.
--
-- `units.sector` is set to 'RIYADH ZONE' for display only — every OTHER
-- sector narrows its unit list with a plain `unit.sector === sector`
-- match, but a single row cannot hold two sector strings at once, so the
-- frontend resolves THIS unit by `unit_code = 'RZN01'` instead whenever
-- either SPONSORS-RIYADH ZONE or DAYEE-RIYADH ZONE is selected. See
-- RIYADH_ZONE_UNIT_CODE in frontend/src/app/admin/clients/page.tsx.
--
-- ── Never gets agents, and that is the whole point of the shape ───────
--
-- `agent_invite_pin_hash` is left NULL. Migration 004 already dropped
-- `access_code_hash`, and `agent_invite_pin_hash` has been nullable since
-- 009 — a unit with no invite PIN simply cannot be registered under by any
-- agent (the Unit Gateway and signup both re-verify the PIN server-side
-- against this exact column, so NULL is a hard "not joinable" state, not
-- an oversight). Riyadh Zone exists purely so client records can point at
-- a `unit_id`; it is not a real event location and is never meant to
-- issue tickets.
--
-- `unit_code` follows the RAB01/BAT01-style `<3-letter><2-digit>` pattern
-- so it sorts and displays consistently with the other 30, even though it
-- is not part of that operational roster.
-- ---------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
  v_division_id UUID;
BEGIN
  SELECT id INTO v_division_id FROM divisions WHERE code = 'RIYADH';

  IF v_division_id IS NULL THEN
    RAISE EXCEPTION
      'Division RIYADH does not exist — run db:provision-units or db:add-missing-units first.';
  END IF;

  INSERT INTO units (division_id, unit_code, name, sector, agent_invite_pin_hash)
       VALUES (v_division_id, 'RZN01', 'Riyadh Zone', 'RIYADH ZONE', NULL)
  ON CONFLICT (division_id, unit_code) DO NOTHING;
END $$;

COMMIT;
