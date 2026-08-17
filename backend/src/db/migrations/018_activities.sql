-- ---------------------------------------------------------------------
-- 018 — Superuser activities (the organiser's own task list)
--
-- Things a superuser has to DO — "confirm catering headcount", "call the
-- printer about passes" — as opposed to:
--
--   * `audit_logs`, which records what the SYSTEM did, automatically, and
--     is append-only evidence rather than a work list. Nobody ticks off an
--     audit row.
--   * `client_interactions` (015), which is what was said to a specific
--     premium guest. A task like "book the sound system" belongs to no
--     client, and forcing one would mean inventing a fake client record.
--
-- So this is its own table. It is deliberately NOT a generalisation of
-- either: merging them would give one table two owners, two lifecycles and
-- two meanings for "done".
--
-- ── Shared, with an owner ─────────────────────────────────────────────
--
-- Same decision as `clients` (015): all three superusers see everything,
-- and attribution lives on the row rather than in a scope filter. On event
-- day a colleague must be able to pick up a task whose owner is
-- unreachable. `created_by_name` / `assigned_to_name` are captured at write
-- time for the same reason audit_logs carries no FK on actor_id — this is
-- read months later, possibly after an account is deactivated.
--
-- `assigned_to` is nullable: an unassigned task is a real state ("someone
-- needs to do this"), not missing data.
--
-- ── done_at, not a boolean ────────────────────────────────────────────
--
-- `is_done BOOLEAN` would answer "is it finished" but not "when", and
-- "what did we close out last week" is a question this list will be asked.
-- A nullable timestamp answers both: NULL is open, non-NULL is both done
-- AND when. One column, no pair to drift out of sync.
-- ---------------------------------------------------------------------

BEGIN;

DO $$ BEGIN
  CREATE TYPE activity_priority AS ENUM ('LOW', 'NORMAL', 'HIGH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  title         TEXT NOT NULL,
  notes         TEXT,

  priority      activity_priority NOT NULL DEFAULT 'NORMAL',

  /* DATE, not TIMESTAMPTZ. A task is due on a DAY — "the 20th" — and
   * storing a time would force the UI to invent one and then argue about
   * whose timezone it meant. Overdue is computed against CURRENT_DATE. */
  due_on        DATE,

  /* NULL = open. Non-null = done, and when. See the header. */
  done_at       TIMESTAMPTZ,

  /* No FK to superusers, same reasoning as audit_logs.actor_id: this list
   * outlives accounts, and a deactivated superuser must not take their
   * tasks with them or block their own deletion. */
  created_by       UUID,
  created_by_name  TEXT,
  assigned_to      UUID,
  assigned_to_name TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT activities_title_not_blank CHECK (length(trim(title)) > 0)
);

/* The default screen is "open tasks, soonest first", so that is the index.
 * Partial on done_at IS NULL: finished tasks are the larger set over time
 * and are not what the common query scans. */
CREATE INDEX IF NOT EXISTS idx_activities_open
  ON activities (due_on NULLS LAST, created_at DESC)
  WHERE done_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_activities_done
  ON activities (done_at DESC)
  WHERE done_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_activities_updated_at ON activities;
CREATE TRIGGER trg_activities_updated_at
  BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
