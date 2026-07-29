-- ---------------------------------------------------------------------
-- 001 — scan_logs.client_scan_id
--
-- Idempotency key for POST /api/scan/bulk-sync (CLAUDE.md §10.4).
--
-- Offline scanners generate this UUID at capture time, before any network
-- call. When a batch is half-delivered and retried, the replayed rows collide
-- here and are skipped via ON CONFLICT DO NOTHING, so a retry can never
-- double-record an admission.
--
-- The index is partial: online scans that never queued locally carry NULL,
-- and there may be many of those.
-- ---------------------------------------------------------------------

BEGIN;

ALTER TABLE scan_logs
  ADD COLUMN IF NOT EXISTS client_scan_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_logs_client_scan_id
  ON scan_logs (client_scan_id)
  WHERE client_scan_id IS NOT NULL;

-- Drain order for the sync worker: oldest capture first.
CREATE INDEX IF NOT EXISTS idx_scan_logs_client_created
  ON scan_logs (created_at)
  WHERE client_scan_id IS NOT NULL;

COMMIT;
