-- ---------------------------------------------------------------------
-- 016 — Sequential request and ticket numbers
--
-- Numbers were crypto-random 6-digit values (§4.4). They are now allocated
-- from a sequence: TKT-0001, TKT-0002, … and REQ-0001, REQ-0002, …
-- one global counter each, shared across every unit, on explicit
-- instruction from the project owner.
--
-- ⚠ WHAT THIS GIVES UP, recorded because §4.4 argued the opposite and a
--   future reader deserves to know this was a decision, not a regression:
--
--   A sequential number discloses sales volume to anyone holding a single
--   ticket — the holder of TKT-0350 knows 350 tickets have been sold —
--   and makes the range enumerable rather than sparse. That was the stated
--   reason for randomness.
--
--   What makes it acceptable: NEITHER NUMBER IS AN ADMISSION CREDENTIAL.
--   The QR payload is a full UUID and is the only thing that admits anyone
--   (§4.3, §10.1). A guessed or enumerated ticket number buys a searchable
--   label, not entry. The exposure is commercial (how many did you sell),
--   not a gate breach.
--
-- ── Why sequences rather than MAX(...)+1 ─────────────────────────────
--
-- A `SELECT MAX(ticket_number)+1 THEN INSERT` races: two agents issuing in
-- the same millisecond read the same max and both try to write it. Postgres
-- sequences are transactional-safe and never hand the same value to two
-- callers, which is the same "do not read-then-write" discipline §10.2
-- applies to admission.
--
-- Note sequences do NOT roll back. An issuance that fails after drawing a
-- number leaves a gap (…0041, 0043…). That is correct and must not be
-- "fixed" by reusing numbers: a gap is invisible to everyone except someone
-- reconciling counts, whereas a reused number means two tickets share an
-- identifier. Do not count tickets by reading the last number — the ledger
-- already aggregates properly.
--
-- ── Starting point ────────────────────────────────────────────────────
--
-- Both sequences already exist (schema.sql line 212), created for the
-- original sequential design, then left unused when numbering went random —
-- recorded as Known debt 4. They are reused here rather than replaced, but
-- they cannot simply be left at whatever value they hold: they have never
-- been advanced, so they would start issuing 1, 2, 3 … against a table that
-- may already contain a randomly-generated TKT-0001.
--
-- setval below therefore starts each sequence past BOTH:
--   * its requested start (1), and
--   * any existing ALL-NUMERIC number already in `tickets`.
--
-- The guard is `[0-9]+`, not `[0-9]{4}`, deliberately: tickets already
-- issued under the previous 6-DIGIT random scheme (e.g. TKT-598054) are
-- numeric too, and a 4-wide guard would skip them and let the sequence
-- re-issue a number that already exists. Legacy hex/alphanumeric formats
-- ('TKT-6AE950') are still excluded, since `::BIGINT` would abort on them.
--
-- Consequence worth knowing: if a 6-digit random number like TKT-598054 is
-- already in the table, the sequence starts ABOVE it and the first new
-- ticket is TKT-598055 — not TKT-0001, and 6 digits wide. That is the
-- correct, safe outcome (never reuse an identifier). To genuinely start at
-- TKT-0001, those demo/test tickets must be deleted first — see
-- provision-demo-agent.ts --destroy, which does exactly that.
-- ---------------------------------------------------------------------

BEGIN;

-- Advance request_number_seq past anything already issued.
SELECT setval(
  'request_number_seq',
  GREATEST(
    1,
    COALESCE(
      (SELECT MAX(SUBSTRING(request_number FROM 5)::BIGINT)
         FROM tickets
        WHERE request_number ~ '^REQ-[0-9]+$'),
      0
    )
  ),
  -- `true` = "this value has been used", so the next nextval() returns
  -- max+1. With no existing rows this leaves the sequence at 1 already-used,
  -- making the first ticket 0002 — corrected by the is_called flip below.
  TRUE
);

SELECT setval(
  'ticket_number_seq',
  GREATEST(
    1,
    COALESCE(
      (SELECT MAX(SUBSTRING(ticket_number FROM 5)::BIGINT)
         FROM tickets
        WHERE ticket_number ~ '^TKT-[0-9]+$'),
      0
    )
  ),
  TRUE
);

/* On a fresh database (no numeric tickets yet) both sequences now sit at
 * `1, is_called = true`, so the first issuance would be 0002 and 0001
 * would never exist. Reset to "1, not yet called" in that case so the very
 * first ticket really is TKT-0001, which is the whole point of starting
 * at 1. */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tickets WHERE request_number ~ '^REQ-[0-9]+$'
  ) THEN
    PERFORM setval('request_number_seq', 1, FALSE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tickets WHERE ticket_number ~ '^TKT-[0-9]+$'
  ) THEN
    PERFORM setval('ticket_number_seq', 1, FALSE);
  END IF;
END $$;

DO $$
DECLARE
  req_last BIGINT;
  tkt_last BIGINT;
BEGIN
  SELECT last_value INTO req_last FROM request_number_seq;
  SELECT last_value INTO tkt_last FROM ticket_number_seq;

  RAISE NOTICE
    'Sequential numbering active. request_number_seq=% ticket_number_seq=%',
    req_last, tkt_last;
END $$;

COMMIT;
