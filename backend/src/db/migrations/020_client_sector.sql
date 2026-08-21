-- ---------------------------------------------------------------------
-- 020 — A client's own sector
--
-- Fixes a real gap in 017/019: the sector filter on /admin/clients reads
-- through `units.sector`, so it only works for a client that has a
-- `unit_id`. The 153 clients imported from last event's list have NONE -
-- that list names SECTORS, and a sector holds several units, so no unit
-- could honestly be assigned (see 019's header).
--
-- The consequence was that filtering by sector returned zero imported
-- rows: the sector was recorded only in the first timeline entry, which is
-- prose and not queryable. The information was there and unusable.
--
-- ── Why this is NOT the duplication Known debt 8 warns about ──────────
--
-- 017 deliberately did not copy `units.sector` onto `clients`, on the
-- grounds that a second copy drifts. That reasoning still holds for a
-- client that HAS a unit, and this column does not change it: it is for
-- clients that have no unit at all, where there is nothing to drift from.
--
-- The two are reconciled by making the unit authoritative WHENEVER IT IS
-- SET - the read below is `COALESCE(u.sector, c.sector)`, so a client with
-- a unit shows its unit's sector and this column is ignored. Assigning a
-- unit therefore silently corrects a wrong sector rather than leaving two
-- values disagreeing, which is the failure mode Known debt 8 describes.
--
-- Free text with no FK or CHECK, matching `units.sector` exactly (Known
-- debt 7). A CHECK here would reject 'Sponsors', which is a real grouping
-- on the source list and not a sector of the event at all.
-- ---------------------------------------------------------------------

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS sector TEXT;

COMMENT ON COLUMN clients.sector IS
  'Sector when no unit is assigned. units.sector wins when unit_id is set — see COALESCE in clients.repository.';

/* Indexed on the same normalised form the filter compares, since the
 * imported list is a few hundred rows and this is the primary cut. */
CREATE INDEX IF NOT EXISTS idx_clients_sector
  ON clients (upper(trim(sector)))
  WHERE sector IS NOT NULL;

COMMIT;
