-- ---------------------------------------------------------------------
-- Clear test scan + audit data
--
-- READ THIS FIRST — it may not be the fix you want.
--
-- If dummy agents are still visible in the Live Gate Feed, the cause is
-- almost certainly NOT this data. SuperuserDashboard used to initialise its
-- state from MOCK_SNAPSHOT, a client-side fixture whose four fabricated
-- scans carry the seeded agents' real names ('Rajesh Nair', 'Suma Bhat',
-- 'Praveen Shetty'). Those rows never existed in Postgres, so no DELETE
-- removes them. That is fixed in the component; a redeploy clears it.
--
-- Run this only to clear REAL test scans made during rehearsal.
--
-- There is no orphan problem to repair either. Every reference out of
-- scan_logs is ON DELETE SET NULL:
--     qr_code_id -> qr_codes, ticket_id -> tickets,
--     scanned_by -> agents,   unit_id   -> units
-- so deleting an agent nulls the reference and leaves the scan on the
-- record — which is §10.6's requirement, not a bug. The dashboard now
-- renders such a row as "Deleted agent".
--
-- audit_logs.actor_id has no foreign key at all, by design: the trail must
-- outlive the accounts it describes.
-- ---------------------------------------------------------------------


-- ── STEP 1 — look before you delete ─────────────────────────────────
-- Run this alone first. If the counts are larger than you expect, stop.

SELECT 'scan_logs'  AS table_name, COUNT(*) AS rows,
       MIN(created_at) AS oldest, MAX(created_at) AS newest
  FROM scan_logs
UNION ALL
SELECT 'audit_logs', COUNT(*), MIN(created_at), MAX(created_at)
  FROM audit_logs
UNION ALL
SELECT 'qr_codes SCANNED', COUNT(*), MIN(scanned_at), MAX(scanned_at)
  FROM qr_codes WHERE status = 'SCANNED';


-- ── STEP 2 — the wipe ───────────────────────────────────────────────
-- IRREVERSIBLE. Take a Supabase backup first if there is any doubt.
--
-- Wrapped in a transaction: run it, read the row counts, and only then
-- COMMIT. ROLLBACK puts everything back if a number looks wrong.

BEGIN;

-- Admissions live on qr_codes, not scan_logs. Deleting scan history alone
-- would leave guest codes marked SCANNED with no record of who admitted
-- them — every one of those guests would be refused as a duplicate on
-- event day. Reset them in the same transaction or not at all.
UPDATE qr_codes
   SET status          = 'ISSUED',
       scanned_at      = NULL,
       scanned_by      = NULL,
       scanned_by_gate = NULL
 WHERE status = 'SCANNED';

DELETE FROM scan_logs;

-- audit_logs holds NOTHING about scanning. The scanning module writes no
-- audit rows at all — scan_logs is the entire gate trail. Every action in
-- audit_logs is an account or ticket event:
--
--   AGENT_LOGIN / AGENT_LOGIN_FAILED / AGENT_SELF_REGISTERED
--   AGENT_APPROVED / AGENT_REJECTED
--   SUPERUSER_LOGIN / SUPERUSER_LOGIN_FAILED / SESSION_REVOKED
--   GATE_CREATED / GATE_LOGIN / GATE_LOGIN_FAILED / GATE_PIN_ROTATED
--   PASSWORD_RESET_* / TICKET_ISSUED / DATABASE_SEEDED
--
-- So deleting from it will not change the Live Gate Feed. Clear only the
-- rehearsal noise — the seed marker and the logins of accounts you have
-- since deleted:
DELETE FROM audit_logs
 WHERE action = 'DATABASE_SEEDED'
    OR (actor_role = 'AGENT'
        AND actor_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM agents WHERE agents.id = audit_logs.actor_id));

-- To wipe the trail completely instead, use: DELETE FROM audit_logs;
-- Think first — this is the only record of who approved and admitted whom.

-- Read the counts above, then finish with ONE of:
COMMIT;
-- ROLLBACK;


-- ── STEP 3 — confirm ────────────────────────────────────────────────
-- Expect 0, 0, 0.

SELECT (SELECT COUNT(*) FROM scan_logs)                          AS scan_logs,
       (SELECT COUNT(*) FROM qr_codes WHERE status = 'SCANNED')  AS still_scanned,
       (SELECT COUNT(*) FROM scan_logs WHERE scanned_by IS NULL) AS orphaned_scans;
