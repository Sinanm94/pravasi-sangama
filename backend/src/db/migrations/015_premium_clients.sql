-- ---------------------------------------------------------------------
-- 015 — Premium client records and their interaction timeline
--
-- A place for a superuser to track the CONVERSATION with a premium guest:
-- what was asked, what came back, and what is still outstanding. Purchaser
-- details already live on `tickets`, so this is deliberately not a second
-- copy of them — it is the thing tickets cannot hold, which is history over
-- time before and around a sale.
--
-- Two tables rather than a notes column on one:
--
--   clients               who they are and where the conversation stands
--   client_interactions   an append-mostly log of individual exchanges
--
-- A single free-text notes field would have been less work and wrong. The
-- question being answered is "what did they say when, and who spoke to
-- them" — that needs rows with their own timestamps and authors, or it
-- degrades into one blob nobody trusts and nobody can filter.
--
-- Standalone, not derived from tickets: these conversations start BEFORE a
-- ticket exists, which is the point. `ticket_id` is an optional link for
-- once they buy, so one record spans prospect -> issued pass.
--
-- Shared across all three superusers rather than owned by one. Each row
-- records who created it and who wrote each interaction, so attribution
-- survives without partitioning the data — on event day a colleague must be
-- able to pick up a client whose usual contact is unreachable.
-- ---------------------------------------------------------------------

BEGIN;

DO $$ BEGIN
  CREATE TYPE client_status AS ENUM (
    'PROSPECT',      -- identified, not yet spoken to
    'AWAITING_REPLY',-- we asked, they have not answered
    'CONFIRMED',     -- they committed
    'TICKETED',      -- a pass has been issued
    'DECLINED'       -- they said no
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE client_interaction_kind AS ENUM (
    'NOTE',      -- an observation, no exchange
    'OUTREACH',  -- we contacted them
    'RESPONSE'   -- they came back to us
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name          TEXT NOT NULL,
  mobile        TEXT,
  email         TEXT,
  organisation  TEXT,

  /* The tier being DISCUSSED. Deliberately nullable and deliberately not a
   * foreign key onto an issued ticket: at prospect stage there is no ticket,
   * and the tier may change during the conversation. Once a pass exists,
   * `ticket_id` below is the authority on what was actually sold. */
  intended_tier ticket_type,

  status        client_status NOT NULL DEFAULT 'PROSPECT',

  /* Optional link, set once they actually buy. ON DELETE SET NULL: losing a
   * ticket must not delete the record of the conversation that produced it. */
  ticket_id     UUID REFERENCES tickets (id) ON DELETE SET NULL,

  /* When to chase next. Nullable — not every client is waiting on us. The
   * list sorts overdue ones to the top off this column. */
  follow_up_on  DATE,

  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT clients_name_not_blank CHECK (TRIM(name) <> '')
);

/* No FK on created_by, matching audit_logs.actor_id: the record of who
 * added a client must outlive the account that added them (migration 012
 * deactivates accounts; a future one may remove them). */

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients (status);
CREATE INDEX IF NOT EXISTS idx_clients_follow_up
  ON clients (follow_up_on) WHERE follow_up_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_created ON clients (created_at DESC);

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS client_interactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  /* CASCADE: an interaction has no meaning without its client, unlike
   * scan_logs which must survive the code it describes. */
  client_id   UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,

  kind        client_interaction_kind NOT NULL DEFAULT 'NOTE',
  body        TEXT NOT NULL,

  /* Who wrote it, and their name captured AT WRITE TIME. The id alone would
   * leave the timeline reading "someone said" once an account is retired,
   * and this log is read months later to settle "who agreed what". */
  author_id   UUID,
  author_name TEXT,

  /* When the exchange HAPPENED, which is not always when it was typed —
   * a call on Sunday gets logged on Monday. Defaults to now so the common
   * case needs no thought. */
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT client_interactions_body_not_blank CHECK (TRIM(body) <> '')
);

CREATE INDEX IF NOT EXISTS idx_client_interactions_client
  ON client_interactions (client_id, occurred_at DESC);

COMMIT;
