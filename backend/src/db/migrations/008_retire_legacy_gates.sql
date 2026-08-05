-- ---------------------------------------------------------------------
-- 008 — Retire the legacy dev/test gates (GATE1, GATE2)
--
-- db:seed's original two gate fixtures ("Gate 1 — VIP" / "Gate 2 — General",
-- shared PIN 4321). Real gate infrastructure is now provisioned by
-- provision-scanners.ts (SCAN01–SCAN20), and these two serve no purpose
-- except lingering at the top of the gate picker on /scanner/login.
--
-- Unlike migration 006's unit cleanup, this is a plain DELETE with no
-- deactivate fallback: nothing REFERENCES gates with ON DELETE RESTRICT.
-- gate_sessions.gate_id is CASCADE (its sessions go with it — just login
-- history for a gate that no longer exists) and qr_codes.scanned_by_gate /
-- scan_logs.gate_id are both SET NULL (migration 003) — the scan_logs and
-- qr_codes rows themselves are kept, only the specific "which gate" tag on
-- them is cleared. There is no FK violation this can hit, so no fallback
-- branch is needed the way migration 006 needed one for units.
--
-- A NOTICE is still raised per code so `db:migrate`'s output says plainly
-- whether real scan history is about to lose its gate attribution.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  legacy_code TEXT;
  scan_count  INTEGER;
BEGIN
  FOREACH legacy_code IN ARRAY ARRAY['GATE1', 'GATE2']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM gates WHERE gate_code = legacy_code) THEN
      RAISE NOTICE 'gate % — not present, nothing to do', legacy_code;
      CONTINUE;
    END IF;

    SELECT COUNT(*) INTO scan_count
      FROM scan_logs sl
      JOIN gates g ON g.id = sl.gate_id
     WHERE g.gate_code = legacy_code;

    IF scan_count > 0 THEN
      RAISE NOTICE
        'gate % — % scan_logs row(s) reference it; their gate_id will be '
        'set to NULL, the rows themselves are kept.', legacy_code, scan_count;
    END IF;

    DELETE FROM gates WHERE gate_code = legacy_code;
    RAISE NOTICE 'gate % — deleted.', legacy_code;
  END LOOP;
END $$;
