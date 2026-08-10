-- ---------------------------------------------------------------------
-- 014 — Let a ticket be reissued without dropping its history
--
-- `uq_qr_codes_ticket_guest` and `uq_qr_codes_ticket_location` enforce two
-- real invariants: one guest code per slot per ticket, and at most one
-- location code. Both were unconditional on status.
--
-- That is correct while a ticket's codes are only ever written once, and
-- wrong the moment a ticket can be REISSUED (§4.4 — a lost pass gets fresh
-- codes and the old set is revoked). Revoking does not remove the row, so
-- inserting a replacement for guest slot 1 collided with the revoked slot 1
-- and the endpoint 500'd on every reprint.
--
-- The fix is to scope both indexes to codes that still matter. A REVOKED
-- code is spent — it can never admit anyone again (admitGuestCode's UPDATE
-- requires status = 'ISSUED') — so excluding it from the uniqueness rule
-- loses no protection: at most one LIVE code per slot is still guaranteed,
-- which is the invariant that actually governs admission.
--
-- Deleting the old rows instead would have been simpler and worse:
-- `scan_logs.qr_code_id` points at them, so a delete would blank the record
-- of which code a scan belonged to. The trail must outlive the code.
-- ---------------------------------------------------------------------

BEGIN;

DROP INDEX IF EXISTS uq_qr_codes_ticket_guest;
CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_codes_ticket_guest
  ON qr_codes (ticket_id, guest_index)
  WHERE code_kind = 'GUEST' AND status <> 'REVOKED';

DROP INDEX IF EXISTS uq_qr_codes_ticket_location;
CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_codes_ticket_location
  ON qr_codes (ticket_id)
  WHERE code_kind = 'LOCATION' AND status <> 'REVOKED';

/*
 * Note on `qr_codes_scan_consistent`, deliberately NOT relaxed here.
 *
 * That CHECK requires a non-SCANNED row to have a NULL scanned_at, so
 * revoking an already-scanned code would violate it. Rather than widen the
 * constraint, reissueTicketCodes only ever revokes codes that are still
 * ISSUED — which is also what stops a reprint from re-admitting guests who
 * already walked in. The constraint is doing useful work; the code was
 * wrong, not the schema.
 */

COMMIT;
