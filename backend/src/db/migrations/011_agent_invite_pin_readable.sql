-- ---------------------------------------------------------------------
-- 011 — A readable copy of the agent invite PIN, for the unit admin's own
--       dashboard.
--
-- WHY A PLAINTEXT COLUMN, WHEN 009 DELIBERATELY STORED A BCRYPT HASH.
--
-- A unit head has to READ this PIN OUT LOUD to every agent they recruit. It
-- is not a secret they hold, it is a number they distribute — and bcrypt is
-- one-way, so with only `agent_invite_pin_hash` there is no way to show it
-- back to the person whose job is to hand it out. On event day that means a
-- unit head who forgot it cannot onboard anyone.
--
-- This is NOT a downgrade in exposure, and that is the specific reason it is
-- acceptable rather than a general "PINs can be plaintext":
--
--   * All 30 PINs are ALREADY committed in plaintext, in the repository, in
--     provision-unit-admins.ts. A database copy reveals nothing that reading
--     the repo does not.
--   * CLAUDE.md §3.2 states plainly that this PIN is a guard against
--     MISASSIGNMENT (an agent registering under the wrong unit), not an
--     access-control boundary: 4 digits, rate-limited, and re-verified
--     server-side at signup. It was never carrying real secrecy.
--
-- What this does NOT do: touch the verification path. `requireInvitePin()`
-- still checks `agent_invite_pin_hash` and nothing else. This column is
-- display-only. Keeping verification on the hash means this migration
-- cannot introduce an auth regression, at the cost of two columns that must
-- be written together — see the footgun note at the bottom.
-- ---------------------------------------------------------------------

BEGIN;

ALTER TABLE units ADD COLUMN IF NOT EXISTS agent_invite_pin TEXT;

COMMENT ON COLUMN units.agent_invite_pin IS
  'Display-only plaintext of the agent invite PIN, shown to the owning unit '
  'admin. NOT the verification path - requireInvitePin() checks '
  'agent_invite_pin_hash. Write both together or they drift.';

-- Set BOTH columns from one canonical list, so that as of this migration
-- they are guaranteed consistent. Same 30 pairs provision-unit-admins.ts
-- holds; if you change one, change the other.
UPDATE units u
   SET agent_invite_pin      = m.pin,
       agent_invite_pin_hash = crypt(m.pin, gen_salt('bf', 12))
  FROM (VALUES
    ('BAT01', '4170'), ('BAT02', '0268'), ('BAT03', '9205'),
    ('BAT04', '5102'), ('BAT05', '9541'),
    ('BAD01', '0287'), ('BAD02', '3340'), ('BAD03', '8542'),
    ('SHI01', '9579'), ('SHI02', '0394'), ('SHI03', '3095'),
    ('MAL01', '6825'), ('MAL02', '2710'), ('MAL03', '1026'),
    ('MUR01', '4290'), ('MUR02', '5845'), ('MUR03', '6679'),
    ('GHU01', '0660'), ('GHU02', '2103'), ('GHU03', '7505'),
    ('OLA01', '5006'), ('OLA02', '3512'), ('OLA03', '7447'),
    ('RAB01', '0752'), ('RAB02', '0358'), ('RAB03', '1207'),
    ('SUD01', '9265'), ('MUZ01', '6865'), ('SAN01', '1449'),
    ('KHA01', '4060')
  ) AS m(unit_code, pin)
 WHERE u.unit_code = m.unit_code;

-- Both columns are rewritten, not just the readable one, and that is
-- deliberate: it makes "what the unit head sees" and "what actually
-- verifies" true of each other as of this migration. Writing only the
-- plaintext would leave a database provisioned from an older PIN list
-- displaying a number that does not work — the single worst outcome for a
-- screen whose entire job is telling someone the right number.
--
-- `crypt()`/`gen_salt()` come from pgcrypto, already enabled by the baseline
-- schema.sql (line 18) for gen_random_uuid(), so no new dependency. bcrypt
-- at cost 12 matches lib/crypto.ts's BCRYPT_ROUNDS; Postgres emits a `$2a$`
-- hash and Node's bcrypt.compare() verifies 2a/2b/2y alike, so a PIN hashed
-- here is checked identically to one hashed by the provisioning script.

DO $$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(unit_code, ', ' ORDER BY unit_code)
    INTO missing
    FROM units
   WHERE is_active
     AND agent_invite_pin_hash IS NOT NULL
     AND agent_invite_pin IS NULL;

  IF missing IS NOT NULL THEN
    RAISE NOTICE
      'units with a working invite PIN but no readable copy (their unit '
      'admin will see "not recorded" and must re-run db:provision-units): %',
      missing;
  END IF;
END $$;

COMMIT;
