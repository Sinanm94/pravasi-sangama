-- ---------------------------------------------------------------------
-- 007 — Zone supervisor unit assignments (Option B)
--
-- migration 005 gave unit_admins a single, nullable unit_id — enough for
-- the 30 unit-scoped admins, not enough for a "zone" spanning several units.
-- Rather than widen unit_id to an array (loses referential integrity: an
-- element could point at a deleted unit with nothing to stop it) this is a
-- join table, same shape as any other many-to-many in a relational schema.
--
-- A unit-scoped admin's own unit_admins.unit_id is UNCHANGED and still the
-- primary scope check — this table is additive, for admins who cover more
-- than one unit. See unit-admin.repository.ts: an admin's visible agents are
-- now "unit_id = my own unit_id, OR unit_id IN (my rows in this table)".
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supervisor_unit_assignments (
  admin_id    UUID NOT NULL REFERENCES unit_admins (id) ON DELETE CASCADE,
  unit_id     UUID NOT NULL REFERENCES units (id)       ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The composite PK the task asked for. It also *is* the uniqueness
  -- constraint on the pair — a second INSERT of the same (admin, unit) is a
  -- no-op via ON CONFLICT DO NOTHING, not a duplicate row.
  PRIMARY KEY (admin_id, unit_id)
);

-- The PK above already covers admin_id -> unit_id lookups (it is the
-- leading column). This is the reverse direction: "which admins cover this
-- unit", which the PK's column order cannot serve efficiently on its own.
CREATE INDEX IF NOT EXISTS idx_supervisor_unit_assignments_unit
  ON supervisor_unit_assignments (unit_id);

-- CASCADE, not RESTRICT, on both sides — deliberately different from every
-- other FK onto `units` in this schema (agents/unit_sessions/tickets are all
-- RESTRICT). Those protect ticketing history from disappearing quietly; this
-- table has none. It is pure routing — "which admin sees which unit" — and
-- if a unit or an admin account is ever removed, the stale assignment row
-- should go with it, not block the deletion of something that no longer
-- exists to be misrouted to.
