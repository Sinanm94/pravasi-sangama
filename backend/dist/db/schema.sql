-- =====================================================================
--  PRAVASI SANGAMA 2026 — E-Ticketing & Gate Management
--  Base schema. Idempotent: safe to run against an empty database.
--
--  Design notes
--  ------------
--  * The database is the LAST line of defence on capacity. Application
--    code enforces the same rules, but CHECK constraints here mean a bug
--    in the API cannot admit the wrong number of people.
--  * Gate scanning is the hot path. qr_codes.qr_hash carries a UNIQUE
--    index and is the only lookup key a scanner ever needs.
--  * Nothing is hard-deleted. Revocation is a status change so the audit
--    trail survives.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), digest()

-- ---------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE ticket_type AS ENUM ('NORMAL', 'VIP', 'VVIP', 'SVIP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('ACTIVE', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- GUEST codes admit a person. LOCATION codes never do.
  CREATE TYPE qr_code_kind AS ENUM ('GUEST', 'LOCATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE qr_code_status AS ENUM ('ISSUED', 'SCANNED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scan_result AS ENUM ('ADMITTED', 'DUPLICATE', 'REVOKED', 'UNKNOWN_CODE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE actor_role AS ENUM ('SUPERUSER', 'AGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- divisions (districts)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS divisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT divisions_name_key UNIQUE (name),
  CONSTRAINT divisions_code_key UNIQUE (code)
);

DROP TRIGGER IF EXISTS trg_divisions_updated_at ON divisions;
CREATE TRIGGER trg_divisions_updated_at
  BEFORE UPDATE ON divisions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- units (locations inside a division)
--
-- access_code_hash backs Step 1 of the agent login. It is NOT in the
-- original column list but Step 1 is impossible without a credential
-- stored against the unit itself.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS units (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id       UUID NOT NULL
                      REFERENCES divisions (id) ON DELETE RESTRICT,
  unit_code         TEXT NOT NULL,
  name              TEXT NOT NULL,
  sector            TEXT,
  access_code_hash  TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unit codes are unique within their division, not globally.
  CONSTRAINT units_division_code_key UNIQUE (division_id, unit_code)
);

CREATE INDEX IF NOT EXISTS idx_units_division ON units (division_id);

DROP TRIGGER IF EXISTS trg_units_updated_at ON units;
CREATE TRIGGER trg_units_updated_at
  BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- agents
--
-- unit_id is an addition to the original column list. Step 2 of the login
-- must verify "this agent belongs to the unit from Step 1", which requires
-- a stored assignment. If an agent ever needs to work several units, this
-- becomes a join table — but one-unit-per-agent matches the current model.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        UUID NOT NULL REFERENCES units (id) ON DELETE RESTRICT,
  mobile_number  TEXT NOT NULL,
  name           TEXT NOT NULL,
  pin_hash       TEXT,                    -- NULL while OTP-only
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT agents_mobile_number_key UNIQUE (mobile_number),
  CONSTRAINT agents_mobile_number_format CHECK (mobile_number ~ '^[0-9]{10}$')
);

CREATE INDEX IF NOT EXISTS idx_agents_unit ON agents (unit_id);
CREATE INDEX IF NOT EXISTS idx_agents_active
  ON agents (unit_id) WHERE is_active;

DROP TRIGGER IF EXISTS trg_agents_updated_at ON agents;
CREATE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- superusers
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS superusers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username       TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT superusers_username_key UNIQUE (username)
);

DROP TRIGGER IF EXISTS trg_superusers_updated_at ON superusers;
CREATE TRIGGER trg_superusers_updated_at
  BEFORE UPDATE ON superusers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- unit_sessions — the two-step login audit trail
--
-- One row per session, created at STEP 1 with agent_id NULL. Step 2 binds
-- the agent by setting agent_id + agent_bound_at. A session with a NULL
-- agent_id can authenticate but cannot issue tickets — that is the whole
-- point of the split, and the partial index below makes "is this session
-- fully bound?" a single cheap lookup.
--
-- token_hash stores a SHA-256 of the session token, never the token.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS unit_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES units (id) ON DELETE RESTRICT,
  agent_id        UUID REFERENCES agents (id) ON DELETE RESTRICT,
  token_hash      TEXT NOT NULL,
  login_time      TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- step 1
  agent_bound_at  TIMESTAMPTZ,                          -- step 2
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  ip_address      INET,
  user_agent      TEXT,

  CONSTRAINT unit_sessions_token_hash_key UNIQUE (token_hash),

  -- agent_id and agent_bound_at are set together, or neither is set.
  CONSTRAINT unit_sessions_binding_consistent CHECK (
    (agent_id IS NULL AND agent_bound_at IS NULL) OR
    (agent_id IS NOT NULL AND agent_bound_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_unit_sessions_unit_time
  ON unit_sessions (unit_id, login_time DESC);
CREATE INDEX IF NOT EXISTS idx_unit_sessions_agent_time
  ON unit_sessions (agent_id, login_time DESC);
CREATE INDEX IF NOT EXISTS idx_unit_sessions_live
  ON unit_sessions (unit_id)
  WHERE revoked_at IS NULL AND agent_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Numbering sequences
-- Formatted by the application as REQ-2026-000092 / TKT-0092.
-- ---------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS request_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq  START 1;

-- ---------------------------------------------------------------------
-- tickets
--
-- Purchaser columns are additions to the original list — the registration
-- form collects them and they must persist somewhere.
--
-- counted_persons is stored (not derived at read time) so the historical
-- capacity of a ticket survives any future change to tier rules. The CHECK
-- constraint is the hard guarantee behind CLAUDE.md §4.3: a Normal ticket
-- physically cannot be written with a capacity of 4.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tickets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number      TEXT NOT NULL,
  ticket_number       TEXT NOT NULL,
  ticket_type         ticket_type NOT NULL,

  agent_id            UUID NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  unit_id             UUID NOT NULL REFERENCES units (id) ON DELETE RESTRICT,
  division_id         UUID NOT NULL REFERENCES divisions (id) ON DELETE RESTRICT,
  unit_session_id     UUID REFERENCES unit_sessions (id) ON DELETE SET NULL,

  purchaser_name      TEXT NOT NULL,
  purchaser_mobile    TEXT NOT NULL,
  purchaser_email     TEXT,

  counted_persons     SMALLINT NOT NULL,
  children_below_12   SMALLINT NOT NULL DEFAULT 0,

  status              ticket_status NOT NULL DEFAULT 'ACTIVE',
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tickets_request_number_key UNIQUE (request_number),
  CONSTRAINT tickets_ticket_number_key  UNIQUE (ticket_number),

  CONSTRAINT tickets_purchaser_mobile_format
    CHECK (purchaser_mobile ~ '^[0-9]{10}$'),

  CONSTRAINT tickets_children_non_negative
    CHECK (children_below_12 >= 0),

  -- Capacity rule, enforced at the storage layer.
  -- Normal admits 1. VIP / VVIP / SVIP admit 4 — identical capacity.
  CONSTRAINT tickets_capacity_matches_tier CHECK (
    (ticket_type = 'NORMAL' AND counted_persons = 1) OR
    (ticket_type <> 'NORMAL' AND counted_persons = 4)
  )
);

-- Gate + admin lookups
CREATE INDEX IF NOT EXISTS idx_tickets_request_number ON tickets (request_number);
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_number  ON tickets (ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_purchaser_mobile ON tickets (purchaser_mobile);

-- Reporting: "everything my unit issued, newest first"
CREATE INDEX IF NOT EXISTS idx_tickets_unit_created
  ON tickets (unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_agent_created
  ON tickets (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_division_created
  ON tickets (division_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_type_created
  ON tickets (ticket_type, created_at DESC);

DROP TRIGGER IF EXISTS trg_tickets_updated_at ON tickets;
CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- qr_codes
--
-- Fan-out: NORMAL -> 1 GUEST code.
--          VIP / VVIP / SVIP -> 4 GUEST codes + 1 LOCATION code.
--
-- guest_index is modelled as (kind, index) rather than a single mixed
-- column, so "1-4 or LOCATION" is enforceable instead of conventional.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS qr_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  qr_hash      TEXT NOT NULL,
  code_kind    qr_code_kind NOT NULL,
  guest_index  SMALLINT,
  status       qr_code_status NOT NULL DEFAULT 'ISSUED',
  scanned_at   TIMESTAMPTZ,
  scanned_by   UUID REFERENCES agents (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT qr_codes_qr_hash_key UNIQUE (qr_hash),

  -- GUEST codes carry an index 1..4. LOCATION codes never do.
  CONSTRAINT qr_codes_index_matches_kind CHECK (
    (code_kind = 'GUEST'    AND guest_index BETWEEN 1 AND 4) OR
    (code_kind = 'LOCATION' AND guest_index IS NULL)
  ),

  -- SCANNED implies a timestamp, and vice versa.
  CONSTRAINT qr_codes_scan_consistent CHECK (
    (status = 'SCANNED' AND scanned_at IS NOT NULL) OR
    (status <> 'SCANNED' AND scanned_at IS NULL)
  )
);

-- No duplicate guest slots on a ticket, and at most one LOCATION code.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_codes_ticket_guest
  ON qr_codes (ticket_id, guest_index)
  WHERE code_kind = 'GUEST';

CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_codes_ticket_location
  ON qr_codes (ticket_id)
  WHERE code_kind = 'LOCATION';

-- THE gate path. Every scan is a single point lookup on this index.
-- (UNIQUE constraint above already provides it; named here for intent.)
CREATE INDEX IF NOT EXISTS idx_qr_codes_ticket ON qr_codes (ticket_id);

-- "How many of this unit's codes are still unscanned?" — live gate counts.
CREATE INDEX IF NOT EXISTS idx_qr_codes_unscanned
  ON qr_codes (ticket_id)
  WHERE status = 'ISSUED';

CREATE INDEX IF NOT EXISTS idx_qr_codes_scanned_at
  ON qr_codes (scanned_at DESC)
  WHERE scanned_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_qr_codes_updated_at ON qr_codes;
CREATE TRIGGER trg_qr_codes_updated_at
  BEFORE UPDATE ON qr_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- scan_logs — append-only record of every scan ATTEMPT
--
-- Distinct from qr_codes.scanned_at, which holds only the successful
-- admission. Duplicates and unknown codes must also be recorded: at a gate,
-- a burst of DUPLICATE results is the signature of a copied ticket.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scan_logs (
  id            BIGSERIAL PRIMARY KEY,
  qr_code_id    UUID REFERENCES qr_codes (id) ON DELETE SET NULL,
  ticket_id     UUID REFERENCES tickets (id) ON DELETE SET NULL,
  scanned_hash  TEXT NOT NULL,            -- raw payload, even if unknown
  result        scan_result NOT NULL,
  scanned_by    UUID REFERENCES agents (id) ON DELETE SET NULL,
  unit_id       UUID REFERENCES units (id) ON DELETE SET NULL,
  gate_label    TEXT,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_logs_created ON scan_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_logs_result_created
  ON scan_logs (result, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_logs_ticket ON scan_logs (ticket_id);
CREATE INDEX IF NOT EXISTS idx_scan_logs_hash ON scan_logs (scanned_hash);

-- ---------------------------------------------------------------------
-- audit_logs — superuser-visible system trail
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  actor_role   actor_role,
  actor_id     UUID,
  action       TEXT NOT NULL,            -- 'TICKET_ISSUED', 'AGENT_LOGIN', ...
  entity_type  TEXT,
  entity_id    UUID,
  metadata     JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs (actor_role, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id);

COMMIT;
