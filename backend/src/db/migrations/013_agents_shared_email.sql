-- ---------------------------------------------------------------------
-- 013 — Agents may share an email address
--
-- Many field agents have no personal email and will register under their
-- unit head's address. Migration 003 put a UNIQUE index on LOWER(email),
-- which makes the second such registration fail outright.
--
-- Dropping it is the easy half. The half that matters is that TWO existing
-- flows silently depended on that index guaranteeing at most one row per
-- address, and both become wrong the moment it goes:
--
--   1. AGENT LOGIN accepted mobile OR email
--      (`findAgentByMobileOrEmail`: `... OR LOWER(a.email) = LOWER($1)
--      LIMIT 1`). With a shared address that LIMIT 1 picks an arbitrary
--      row, so "log in with your email" stops being a well-defined request.
--      Login is now mobile-number-only — which was always the documented
--      Agent ID (§2), and is still UNIQUE.
--
--   2. SELF-SERVICE PASSWORD RESET looked the agent up by email
--      (`findAgentByEmail`, same arbitrary-row problem) and mailed a reset
--      link. On a shared inbox that is an account-takeover path: the link
--      may be minted for a DIFFERENT agent than the one who asked, and
--      anyone with access to that inbox — the unit head, or any other agent
--      sharing it — can claim it. That flow is retired; recovery is now
--      the unit admin rotating the password from their dashboard (§3.3).
--
-- Neither of those is fixed by this file — they are code changes, shipped
-- alongside it. This comment exists so that anyone who finds the dropped
-- index later understands it was not merely a constraint relaxation.
--
-- mobile_number remains UNIQUE and untouched. It is the agent's identifier;
-- email is now only a contact field.
-- ---------------------------------------------------------------------

BEGIN;

DROP INDEX IF EXISTS uq_agents_email_lower;

-- Replaced with a NON-unique index. The column is still read (the admin
-- directory shows it, and an agent may be looked up by it administratively),
-- so it still deserves an index — it just no longer constrains.
CREATE INDEX IF NOT EXISTS idx_agents_email_lower
  ON agents (LOWER(email))
  WHERE email IS NOT NULL;

DO $$
DECLARE
  shared INT;
BEGIN
  SELECT COUNT(*) INTO shared
    FROM (
      SELECT LOWER(email)
        FROM agents
       WHERE email IS NOT NULL
       GROUP BY LOWER(email)
      HAVING COUNT(*) > 1
    ) dupes;

  IF shared > 0 THEN
    RAISE NOTICE
      '% email address(es) are now shared by more than one agent. This is '
      'expected. Confirm nothing still resolves an agent BY email alone.',
      shared;
  ELSE
    RAISE NOTICE 'no shared agent email addresses yet.';
  END IF;
END $$;

COMMIT;
