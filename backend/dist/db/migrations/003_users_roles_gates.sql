-- ---------------------------------------------------------------------
-- 003 — Agent self-registration, superuser emails, gate scanner channels
--
-- Implements the User Management & Auth Specification while preserving the
-- Division → Unit → Agent hierarchy (§2). Deliberately does NOT collapse
-- `agents` and `superusers` into one `users` table: four foreign keys point
-- at agents(id) — tickets.agent_id, qr_codes.scanned_by, scan_logs.scanned_by
-- and unit_sessions.agent_id — and rewriting them buys nothing that role
-- separation by table does not already give us.
--
-- The role enum from the spec is added anyway, because scan attribution and
-- JWT claims now genuinely need a three-way discriminant.
-- ---------------------------------------------------------------------

BEGIN;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('SUPERUSER', 'AGENT', 'SCANNER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- agents — self-registration
--
-- Existing rows default to APPROVED: they were created by an administrator
-- through the seeder, which is the approval. Only self-registrations land
-- as PENDING.
-- ---------------------------------------------------------------------

ALTER TABLE agents ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS self_registered BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS approval_status approval_status NOT NULL DEFAULT 'APPROVED';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES superusers (id) ON DELETE SET NULL;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

-- Case-insensitive uniqueness. Agents type their own address at signup and
-- "R.Nair@x.com" and "r.nair@x.com" are the same mailbox.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_email_lower
  ON agents (LOWER(email)) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agents_pending
  ON agents (created_at DESC) WHERE approval_status = 'PENDING';

-- ---------------------------------------------------------------------
-- superusers — email is the identifier (spec §4)
-- ---------------------------------------------------------------------

ALTER TABLE superusers ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_superusers_email_lower
  ON superusers (LOWER(email)) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------
-- gates — scanner channels (spec §2, Option A)
--
-- A gate is a place, not a person. Volunteers authenticate the *post* with a
-- rotatable PIN, exactly as a unit authenticates a location. There is no
-- per-volunteer account and no signup.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id   UUID REFERENCES divisions (id) ON DELETE RESTRICT,
  gate_code     TEXT NOT NULL,
  name          TEXT NOT NULL,
  pin_hash      TEXT NOT NULL,
  pin_rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Daily PIN: a token issued today is refused tomorrow. NULL = no expiry.
  pin_valid_on  DATE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT gates_gate_code_key UNIQUE (gate_code)
);

CREATE INDEX IF NOT EXISTS idx_gates_active ON gates (is_active) WHERE is_active;

DROP TRIGGER IF EXISTS trg_gates_updated_at ON gates;
CREATE TRIGGER trg_gates_updated_at
  BEFORE UPDATE ON gates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Mirrors unit_sessions: a shared PIN makes revocation matter more, not less.
CREATE TABLE IF NOT EXISTS gate_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id     UUID NOT NULL REFERENCES gates (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  login_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  ip_address  INET,
  user_agent  TEXT,

  CONSTRAINT gate_sessions_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_gate_sessions_gate_time
  ON gate_sessions (gate_id, login_time DESC);
CREATE INDEX IF NOT EXISTS idx_gate_sessions_live
  ON gate_sessions (gate_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- Scan attribution
--
-- A scan is now performed by an agent OR a gate. Both columns are nullable
-- and exactly one is set. The gate-level trail is what powers the
-- duplicate-burst forensics in §10.1 — with a shared PIN there is no person
-- to attribute to, and the gate is the operationally useful unit anyway.
-- ---------------------------------------------------------------------

ALTER TABLE qr_codes  ADD COLUMN IF NOT EXISTS scanned_by_gate UUID REFERENCES gates (id) ON DELETE SET NULL;
ALTER TABLE scan_logs ADD COLUMN IF NOT EXISTS gate_id         UUID REFERENCES gates (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scan_logs_gate_created
  ON scan_logs (gate_id, created_at DESC) WHERE gate_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Password reset (spec §3 — FORGOT PASSWORD)
--
-- Stores only a SHA-256 of the token, same reasoning as unit_sessions: a
-- database leak must not hand over live reset links.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT password_reset_tokens_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_live
  ON password_reset_tokens (agent_id)
  WHERE consumed_at IS NULL;

COMMIT;
