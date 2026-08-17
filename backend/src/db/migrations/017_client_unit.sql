-- ---------------------------------------------------------------------
-- 017 — Which unit/sector a premium client belongs to
--
-- The client list is worked by superusers who think in terms of the same
-- geography everything else in this system uses: "who is chasing the Batha
-- prospects?". Without a unit on the row that question cannot be asked, and
-- the list cannot be split between people.
--
-- ── A real FK, unlike units.sector ────────────────────────────────────
--
-- `units.sector` is deliberately free text (Known debt 7) because a sector
-- is a name and nothing else. A UNIT is not: it is an existing row with an
-- id, a code and a division, and a client pointing at one that does not
-- exist is simply wrong. So this is a genuine reference.
--
-- ON DELETE SET NULL, not RESTRICT: retiring a unit must not be blocked by,
-- nor destroy, the record of conversations held while it existed. The
-- client survives with no unit and can be reassigned — same reasoning as
-- `clients.ticket_id`, where losing the ticket must not lose the history.
--
-- Nullable, and no backfill. A premium guest is often a personal contact of
-- a superuser rather than someone a unit recruited, so "no unit" is a real
-- and permanent state, not missing data waiting to be filled in. Guessing a
-- unit for the rows that predate this column would invent information
-- nobody supplied.
--
-- The SECTOR is deliberately NOT copied onto this table. It is reachable
-- with one join through `units.sector`, and duplicating it would create a
-- second copy to drift — exactly the failure mode Known debt 8 documents
-- for the invite PIN.
-- ---------------------------------------------------------------------

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units (id) ON DELETE SET NULL;

-- The list filters by unit, so the lookup is worth an index even at a few
-- hundred rows: it is a foreign key, and Postgres does not index those
-- automatically.
CREATE INDEX IF NOT EXISTS idx_clients_unit ON clients (unit_id);

COMMIT;
