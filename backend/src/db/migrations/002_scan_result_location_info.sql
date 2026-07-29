-- ---------------------------------------------------------------------
-- 002 — scan_result: LOCATION_INFO
--
-- A LOCATION code is not an admission credential (CLAUDE.md §4.3). It is the
-- venue-info pass, and guests scan it repeatedly — at arrival, again looking
-- for a hall, again on the way out.
--
-- Logging those as ADMITTED would inflate the headcount the superuser
-- dashboard reports, and consuming them (status -> SCANNED) would make the
-- second scan of a perfectly valid location pass fail as a DUPLICATE. Both
-- are wrong, so location scans get their own terminal result.
--
-- NOTE: ALTER TYPE ... ADD VALUE requires PostgreSQL 12+. The new value is
-- not referenced in this transaction, which is what makes it legal here.
-- ---------------------------------------------------------------------

ALTER TYPE scan_result ADD VALUE IF NOT EXISTS 'LOCATION_INFO';

-- The baseline comment on this column said "raw payload". It is not, and must
-- never be: scan_logs stores the SHA-256 only, so a log leak yields no usable
-- tickets any more than a qr_codes leak does.
COMMENT ON COLUMN scan_logs.scanned_hash IS
  'SHA-256 of the scanned QR payload. Never the raw payload, including for unknown codes.';
