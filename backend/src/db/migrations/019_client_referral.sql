-- ---------------------------------------------------------------------
-- 019 — Who is chasing this client, and are they a member
--
-- Driven by the "last event's VIP/VVIP purchasers" list, which carries two
-- facts per person that `clients` had nowhere to put:
--
--   1. A REFERRER. Most rows read "Ziaur C/o Sabir" or "Minhaj - Nizam":
--      the second name is the volunteer who owns that relationship and who
--      will actually make the call. Without it the list is 150 names and
--      no one accountable for any of them, which is how a follow-up list
--      quietly becomes a contact dump.
--
--   2. MEMBERSHIP. The source splits every sector into "KCF ಸದಸ್ಯರು"
--      (members) and "Non KCF". That changes the ask — a member is being
--      invited back, a non-member is being sold to — so it drives the
--      conversation, not just a label.
--
-- ── Why free text for the referrer, not an FK ─────────────────────────
--
-- Deliberately NOT a foreign key to agents or superusers, unlike
-- clients.unit_id (017) which IS one. The referrers here are volunteers
-- named on a WhatsApp list: "Sabir", "Nizam", "ಶಿಹಾಬ್ Hly", "klrb". Most
-- have no account in this system and never will, and the few that do
-- cannot be matched reliably from a nickname in a second script. A text
-- column records exactly what the source says; an FK would force us to
-- invent an account per volunteer or drop the information entirely.
--
-- If referrers ever become real accounts with logins, this becomes a
-- nullable FK alongside the text, the same way audit_logs keeps actor_id
-- and a name side by side.
--
-- ── source ────────────────────────────────────────────────────────────
--
-- Marks where a record came from, so last year's imported list stays
-- distinguishable from someone typed in by hand this year. Plain text with
-- a default rather than an enum: the set of sources will grow (another
-- sector's list, a sponsor sheet) and each addition should not need a
-- migration to alter a type.
-- ---------------------------------------------------------------------

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS referred_by TEXT,
  ADD COLUMN IF NOT EXISTS is_member   BOOLEAN,
  ADD COLUMN IF NOT EXISTS source      TEXT NOT NULL DEFAULT 'MANUAL';

/* is_member is deliberately NULLABLE with no default. Three states are
 * real and distinct: member, not a member, and not yet known. Defaulting
 * to FALSE would silently assert "not a member" about every existing row
 * and every future one whose status nobody has checked. */

COMMENT ON COLUMN clients.referred_by IS
  'Volunteer who owns this relationship (the "c/o" name). Free text: most are not system accounts.';
COMMENT ON COLUMN clients.is_member IS
  'KCF member. NULL = not yet known, which is distinct from FALSE.';
COMMENT ON COLUMN clients.source IS
  'Where the record came from, e.g. MANUAL or LAST_EVENT_2025.';

/* The follow-up screen filters by owner ("what am I chasing?"), so the
 * referrer needs an index once the list is a few hundred rows. */
CREATE INDEX IF NOT EXISTS idx_clients_referred_by
  ON clients (lower(trim(referred_by)))
  WHERE referred_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_source ON clients (source);

COMMIT;
