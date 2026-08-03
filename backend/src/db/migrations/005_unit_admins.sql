-- ---------------------------------------------------------------------
-- 005 — Unit Admin tier
--
-- Decentralises agent approval. A UNIT_ADMIN account is scoped to exactly
-- one unit (occasionally none yet — see "unscoped" below) and can approve
-- or reject only the agents posted to that unit. The superuser retains
-- unrestricted approval over every unit, unchanged.
--
-- This is NOT a reinstatement of the unit-login flow deleted in migration
-- 004 (§3.2). That flow authenticated a physical LOCATION so an unnamed
-- person could unlock it. A unit_admins row is a named PERSON's account,
-- same shape as `superusers`, just scoped to a subtree instead of the
-- whole system. The two are unrelated despite both mentioning "unit".
-- ---------------------------------------------------------------------

-- A fifth actor type alongside SUPERUSER / AGENT, for audit_logs.actor_role
-- and agents.approved_by_role below.
ALTER TYPE actor_role ADD VALUE IF NOT EXISTS 'UNIT_ADMIN';

CREATE TABLE IF NOT EXISTS unit_admins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULLABLE, deliberately. A row with unit_id NULL is provisioned but not
  -- yet scoped to a location — it can sign in, but the approvals endpoint
  -- returns an empty list rather than guessing. See CLAUDE.md for which
  -- seeded accounts currently sit in this state and why.
  unit_id        UUID REFERENCES units (id) ON DELETE SET NULL,

  username       TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unit_admins_username_key UNIQUE (username)
);

CREATE INDEX IF NOT EXISTS idx_unit_admins_unit ON unit_admins (unit_id);

DROP TRIGGER IF EXISTS trg_unit_admins_updated_at ON unit_admins;
CREATE TRIGGER trg_unit_admins_updated_at
  BEFORE UPDATE ON unit_admins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- agents.approved_by can no longer point only at superusers.
--
-- The FK was `REFERENCES superusers (id)`, so a unit_admin's id would be
-- rejected as a foreign-key violation the first time one approved anyone.
-- Dropped rather than repointed at a second table: Postgres has no FK that
-- targets "either of two tables", and audit_logs.actor_id already solves
-- this same problem by carrying no FK at all — "the trail must outlive the
-- accounts it describes" applies here too. approved_by_role records which
-- table it means, the same pairing audit_logs uses.
-- ---------------------------------------------------------------------

-- Looked up from the catalog rather than dropped by a guessed name.
-- `agents_approved_by_fkey` is what Postgres's default naming convention
-- would produce for the unnamed `REFERENCES superusers (id)` added in
-- migration 003, but this migration has never been run against a live
-- database in development, so that name is inferred, not confirmed. Guessing
-- wrong with `DROP CONSTRAINT IF EXISTS <wrong-name>` fails silently — no
-- error, FK still there — and the first unit-admin approval would then die
-- on a foreign-key violation instead, a worse place to discover it. This
-- finds whatever FK actually exists on agents.approved_by, by its real
-- target, and drops that.
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT tc.constraint_name INTO fk_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema    = tc.table_schema
   WHERE tc.table_schema    = 'public'
     AND tc.table_name      = 'agents'
     AND tc.constraint_type = 'FOREIGN KEY'
     AND kcu.column_name    = 'approved_by'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE agents DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS approved_by_role actor_role;
