-- ---------------------------------------------------------------------
-- 012 — Retire the legacy/default Super User accounts
--
-- db:seed creates `admin1`, `admin2`, `admin3` sharing one password that is
-- committed to this repository in plaintext (`SUPERUSER_PASSWORD` in
-- seed.ts). If db:seed was ever pointed at production — and §3.3's history
-- records that it was, at least once — those three accounts are live, and
-- full system access is public to anyone who can read the repo. `superadmin`
-- is the older pre-spec account, disabled by seed.ts but only when seed runs.
--
-- The real accounts are ADMIN01–ADMIN03 (db:provision-superusers), each with
-- its own generated password.
--
-- DISABLED, NOT DELETED. `agents.approved_by` still points at superusers.id
-- for every agent one of these accounts ever approved (the FK was dropped in
-- migration 005, but the ids remain), and audit_logs.actor_id carries them
-- too. Deleting the rows would strand that history against ids that resolve
-- to nothing. `is_active = FALSE` is a hard stop for authentication —
-- auth.service.ts's superuserLogin() refuses an inactive row — while leaving
-- the trail readable.
--
-- Matched case-insensitively, because findSuperuserByUsername() compares on
-- LOWER(username): disabling 'admin1' while a row spelled 'Admin1' stayed
-- active would leave exactly the hole this migration exists to close.
--
-- ADMIN01–ADMIN03 are explicitly excluded rather than implied. This
-- migration only ever touches the four names below, so it cannot lock you
-- out of the whole system if it happens to run before
-- db:provision-superusers has created the real accounts — a broad
-- "disable everything not on the allowlist" is the right rule but the wrong
-- place for it, since a migration cannot know whether provisioning has run
-- yet. provision-superusers.ts enforces that stronger rule instead, right
-- after it creates the accounts, where the allowlist is guaranteed to exist.
-- ---------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
  disabled_names TEXT;
  survivors      INT;
BEGIN
  UPDATE superusers
     SET is_active = FALSE
   WHERE LOWER(username) IN ('admin1', 'admin2', 'admin3', 'superadmin')
     AND LOWER(username) NOT IN ('admin01', 'admin02', 'admin03')
     AND is_active;

  SELECT string_agg(username, ', ' ORDER BY username)
    INTO disabled_names
    FROM superusers
   WHERE LOWER(username) IN ('admin1', 'admin2', 'admin3', 'superadmin');

  IF disabled_names IS NULL THEN
    RAISE NOTICE 'no legacy superuser accounts present.';
  ELSE
    RAISE NOTICE 'legacy superuser accounts now inactive: %', disabled_names;
  END IF;

  SELECT COUNT(*) INTO survivors FROM superusers WHERE is_active;

  IF survivors = 0 THEN
    -- Not an abort: failing here would roll back the disabling and leave the
    -- public passwords live, which is worse than the warning. But this needs
    -- to be impossible to miss.
    RAISE WARNING
      'NO ACTIVE SUPERUSER ACCOUNTS REMAIN. Run "npm run '
      'db:provision-superusers -w @pravasi/backend" before you need to sign '
      'in - nobody can reach /dashboard until you do.';
  ELSE
    RAISE NOTICE '% active superuser account(s) remain.', survivors;
  END IF;
END $$;

COMMIT;
