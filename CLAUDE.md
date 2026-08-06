# PRAVASI SANGAMA 2026 — E-Ticketing & Gate Management

Enterprise e-ticketing and gate-control platform for the Pravasi Sangama 2026 event,
organised by the Karnataka Cultural Foundation. Agents in the field issue tickets;
gate staff scan QR codes; a superuser watches the whole thing live.

---

## 1. Tech Stack

| Layer     | Choice                                                     |
| --------- | ---------------------------------------------------------- |
| Frontend  | Next.js (App Router, React), TypeScript                    |
| Styling   | Tailwind CSS — utility-first, no CSS-in-JS                 |
| Icons     | `lucide-react` only. Do not introduce a second icon set.   |
| Charts    | Recharts (analytics dashboards)                            |
| Motion    | `framer-motion`. Springs only — vocabulary in `lib/motion.ts` |
| Toasts    | `sonner`, styled in `components/ui/Toaster.tsx`             |
| QR        | `qrcode.react` (SVG, level Q, 2-module quiet zone)          |
| Backend   | Node.js + Express                                          |
| Database  | PostgreSQL (raw `pg` + SQL migrations, no heavy ORM)       |
| Auth      | JWT, two-tier — see §3                                     |
| Realtime  | socket.io (live gate feed on the superuser dashboard)      |

---

## 2. System Architecture — Five Roles

The hierarchy is strictly nested. Every ticket traces back to exactly one agent,
who belongs to exactly one unit, inside exactly one division.

```
Superuser
   └── Division (District)
          └── Unit (Location / venue-adjacent posting)
                 ├── Unit Admin (approves agents for this unit only)
                 └── Agent (human, identified by mobile number)
```

**Superuser** — Full system access. Real-time analytics, audit logs, ticket
revocation, division/unit/agent CRUD, system-wide kill switches. Single account
tier; no delegated admin yet.

**Division (District)** — A geographical grouping. Owns many units. Read access to
its own subtree's analytics and ticket ledger. Cannot see other divisions.

**Sector** — The parent grouping of units, held as `units.sector`
(migration 010). Twelve of them: `BATHA`, `BADIYA`, `SHIFA`, `MALAZ`,
`MUROOJ`, `GHURNATHA`, `OLAYA`, `RABVA`, `SUDAIR`, `MUZAMIYYAH`,
`SANAYIYYAH`, `KHARJ`. Deliberately a normalised text column rather than a
`sectors` table — a sector is a name and nothing else today, so a table
would buy referential integrity at the price of a join on every ledger and
analytics query. Migration 010's header records what would have to change
to promote it, if a sector ever grows attributes of its own.

**Unit** — A specific physical location within a division (e.g. `5 BUILDING`,
sector `BATHA`). A unit is the *scope* every agent token carries, and every
ticket is written against it. It is not an authentication factor for an
*agent's own* login — `agent-login` is still mobile + password only, unit
derived server-side from the agent's row — but a unit-scoped invite PIN
now gates the agent portal itself before that form is even reachable (the
Unit Gateway, §3.2).

**Unit Admin** (migration 005) — Decentralises agent approval. A named person's
account, scoped to exactly one unit, whose only capability is approving or
rejecting agent registrations posted to that unit — no analytics, no ticket
ledger, no CRUD. Exists to remove the superuser as the sole approval bottleneck
across 30+ locations run by non-technical volunteers. See §3.3.

**Agent** — The human issuing tickets. Assigned to one unit. Identified by
**mobile number only** — `agents.email` stopped being unique in migration 013
so agents without a personal address can share their unit head's, which means
an email no longer resolves one agent and login no longer accepts it. Cannot access analytics, cannot edit or revoke issued tickets, and can
only see registrations made from their own unit.

> **Rule:** authorization is always evaluated bottom-up from the token's
> `unitId` → `divisionId`. Never trust a client-supplied division or unit id on a
> write path. A Unit Admin's approval endpoint enforces this as a SQL predicate
> keyed on the caller's own `unit_admins.id` — its direct `unit_id` **or**
> anything it covers via `supervisor_unit_assignments` (migration 007, §3.3) —
> not an application-level check a reviewer could miss. See
> `admin.repository.decideAgent`'s `restrictToAdminId`.

---

## 3. Authentication Flow

Two distinct login surfaces.

### 3.1 Superuser login (single step)

Standard credential login → JWT with `role: 'SUPERUSER'`. No unit scoping.

### 3.2 Agent login and the Unit Gateway

> **History, in order, because it matters for anyone reading this cold:**
> a mandatory two-step unit-then-agent flow → removed and called
> non-negotiable-not-to-restore (volunteers, no manpower to distribute
> per-agent unit codes and PINs on event day) → **reinstated as a narrower
> "Unit Gateway"** (migration 009) on a later, explicit, informed decision by
> the project owner, made after being shown this exact history and choosing
> to reopen the tradeoff anyway. If you are reading this wondering whether to
> "fix" the gateway away again: don't, without asking first — the removal
> already happened once, the context for putting it back is right here, and
> silently redoing the removal would erase a deliberate decision for the
> second time.

**`POST /api/auth/agent-login` itself is still exactly single step** —
mobile number (or email) + password, nothing else. That part of the removal
stands: the server still derives `unitId`/`divisionId` from the agent's own
row after the password verifies, the client still never names a unit on
this call, and there is still no partially-authenticated session state.

**What's different is what a browser has to clear before it can even reach
that form.** `/login`'s landing screen is now the **Unit Gateway**: a unit
code plus a 4-digit `agent_invite_pin` (migration 009,
`units.agent_invite_pin_hash`). Clearing it unlocks the Agent Portal — both
the Agent Login tab above and First-Time Setup — for the rest of that
browser visit. It is deliberately narrower than the old flow it echoes:

- **One PIN per unit, not per agent.** A unit head hands their own
  `agent_invite_pin` to every agent they recruit; nobody distributes a
  separate credential per person. This is what makes the manpower objection
  above not apply the same way the second time.
- **No session, no binding, nothing persisted.** `POST /api/auth/unit-gateway`
  checks the PIN and returns the unit's public info — no cookie, no JWT, no
  `unit_sessions` row. The old `UNIT_PENDING` role, `unit_sessions.agent_id`
  binding, and every partially-authenticated branch **stay deleted** exactly
  as this section used to say; none of that machinery came back. React state
  in `frontend/src/app/login/page.tsx` is the entire "session" — a page
  refresh clears it and the gateway runs again.
- **Not the security boundary.** The gateway is a UX gate against
  *misassignment* (an agent registering under the wrong unit from a free-text
  or dropdown pick), not a hardened control — hence a 4-digit PIN, not the
  unit admin's own dashboard password. `POST /api/auth/signup` re-verifies
  `agent_invite_pin` against `units.agent_invite_pin_hash` itself before
  creating the row, so bypassing the gateway UI and POSTing a fabricated
  `unit_code` straight to signup still fails — the real boundary is server-
  side re-verification, same as every other credential in this codebase.
- **Rate-limited like a gate PIN, for the same reason.** 4 digits is a small
  space (10,000). `unit-gateway` shares `loginLimiter` rather than a bespoke
  ceiling — the same brute-force profile this codebase already accepts for
  gate PINs (§2, Option A), mitigated by rate limiting, not solved by it.

Route: `/login`. The agent enters **mobile number (or email) + password**
*after* clearing the gateway. On success the server issues the full
**agent JWT** carrying `{ agentId, unitId, divisionId, sessionId, role:
'AGENT' }`.

`unitId` and `divisionId` are read from the agent's own row
(`agents.unit_id` joined to `units.division_id`) *after* the password
verifies. A `unit_sessions` row is still created, with `agent_id` and
`agent_bound_at` set in the same insert — there is no unbound phase.

**Invariants that still hold:**

- **The client never names a unit.** The posting is server-derived from the
  authenticated agent, so an agent cannot issue against a unit they are not
  assigned to — §2's bottom-up rule is intact, and the old "does the agent
  match the step-1 unit?" check is now structural rather than a comparison.
- The password is verified before anything else is disclosed. Approval state
  (`PENDING` / `REJECTED`) is only revealed *after* a correct password, so
  the endpoint cannot be used to enumerate registered numbers.
- JWTs live in **httpOnly cookies**. Never `localStorage` — these are shared
  phones.

**What was genuinely given up — mitigate, don't pretend otherwise:**

- A stolen agent password is now sufficient on its own, from any device
  anywhere. Previously it also required physical presence at a unit that had
  been unlocked with a separate credential.
- `unit_sessions` no longer records a location being opened independently of
  the people who used it, so the audit trail is per-agent, not per-post.
- Compensating controls that matter more now: agent approval (§ admin), fast
  deactivation via `is_active`, `AGENT_LOGIN` / `AGENT_LOGIN_FAILED` audit
  rows, and the login rate limiter.

`POST /api/auth/unit-login`, the `UNIT_PENDING` role and every branch that
handled a partially authenticated session have been **deleted** — from
`packages/shared` (`AUTH_ROLES`, `UnitPendingClaims`, `UnitLoginSchema`), the
backend (route, controller, service, `findUnitsByCode`, `createUnitSession`,
`findLiveSession`, `bindAgentToSession`, `agentNotBound`) and the frontend
(`middleware.ts`, `ProtectedRoute`, `useAuthStore.setUnitPending`).

`units.access_code_hash` is still on the table and still seeded, but nothing
reads it — the Unit Gateway above deliberately did **not** revive it.
`agent_invite_pin_hash` (migration 009) is a new, separate column: the old
one was `NOT NULL` and wired into the `unit_sessions`/`UNIT_PENDING`
machinery this section documents as deleted, and reusing it would have
dragged those assumptions back in for a gate that no longer works that way.
If `access_code_hash` ever gets a real reader, that is a third, distinct
decision — not a continuation of either the old flow or the gateway above.

### 3.2.1 Agent credentials and recovery (migration 013)

**Agents may share an email address.** Many field agents have none of their
own and register under their unit head's. `agents.email` is therefore a
contact field, not an identifier; `mobile_number` remains UNIQUE and is the
Agent ID (§2).

Two things depended on that dropped uniqueness and both were changed with
it — neither is optional, and re-introducing either reopens a real hole:

- **Login is mobile-only.** It used to accept `mobile OR email`; with a
  shared address that `LIMIT 1` returns an arbitrary agent.
- **Self-service email password reset is GONE.** It looked the agent up by
  address, so the link could be minted for a *different* agent than the one
  who asked, and anyone on the shared inbox — the unit head, every other
  agent on it — could claim it. `/login`'s "Forgot?" tab is now a screen
  telling the agent to ask their unit head. `password_reset_tokens` remains
  for history; nothing writes to it.

**Passwords.** The signup password is **optional**: an agent who types one
gets the old behaviour, and an agent who leaves it blank gets a generated
`psa<4 digits>-pw` shown once on the success screen — so an account is never
created without a credential. Recovery is
`POST /api/unit-admin/agents/:id/reset-password`, on the unit admin's own
dashboard, scoped by the same OR-predicate as every other unit-admin action
and written to `audit_logs` as `AGENT_PASSWORD_RESET`.

> **Rotate-and-reveal, NOT stored plaintext** — deliberately unlike the unit
> invite PIN (migration 011), and the difference is worth understanding
> before someone "fixes" the inconsistency. That PIN is 4 digits, already
> committed to this repo, and explicitly not an access control. An agent
> password authorises **issuing tickets**, and agents *choose their own* at
> signup — people reuse passwords, so storing them readably would expose
> credentials those volunteers use on other services, which is harm beyond
> this event. The operational need is "my agent can't sign in", and handing
> them a fresh password meets it completely.

### 3.3 Unit Admin login — decentralised approvals (migrations 005, 007)

Route: `/login` → "Unit admin sign in". Single step: **Unit ID** (e.g. `BAT01`)
+ **password**, same shape as superuser login, against a dedicated
`unit_admins` table — not a repurposed `agents` row and not a reinstatement of
§3.2's deleted unit-login. That flow authenticated a *location* so an unnamed
person could unlock it; a `unit_admins` row is a *named person's* account,
same idea as `superusers`, just scoped to a subtree instead of the whole
system. The two are unrelated despite both saying "unit".

**Scope is two things, unioned: `unit_admins.unit_id` (nullable, single unit)
and `supervisor_unit_assignments` (migration 007, many-to-many).** The 30
location admins use only the first — one row, one unit, same as the original
design. A **Zone Supervisor** uses the second: no direct `unit_id`, instead
one row per unit it covers in `supervisor_unit_assignments(admin_id, unit_id)`.
The two are not exclusive — an admin can have both a direct posting and zone
coverage — and both `unit-admin.repository.listAgentsForAdmin` and
`admin.repository.decideAgent`'s `restrictToAdminId` resolve the full union in
a single SQL predicate keyed on the caller's own `unit_admins.id`, so a row
outside *either* half of the scope matches zero rows at the database level,
not "filtered out after the fact." An account with neither a `unit_id` nor any
assignment row can still sign in — a real, expected state for a freshly
provisioned account, not an error — but every approvals query naturally
returns empty (nothing to union), and the dashboard renders an explicit
**"No unit assigned yet"** screen rather than guessing a scope or showing
everything.

**The dashboard (`/unit/dashboard`) is deliberately not `AdminShell`.** No nav
rail, no analytics, no CRUD — one screen, one job, for a volunteer who may
never have used the rest of the system. Pending agents get two buttons sized
to be unmissable on a phone in daylight; approved agents are a plain
read-only list underneath. There is nothing else on the screen to navigate to.

Below that is a **read-only Ticket Sales table** — `GET /api/unit-admin/tickets`
— every ticket sold by an agent within this admin's own scope, with a search
box (buyer name, mobile, ticket/request number) and an Agent filter. It adds
visibility, not navigation: no CRUD, no revoke action, nowhere else to click
through to. Same OR-scope as the agent queries, and just as load-bearing —
`unit-admin.repository.ts`'s `unitAdminTicketWhere()` is the *only* predicate
that decides which rows exist for this caller, baked into the query rather
than filtered after the fact, mirroring `decideAgent`'s `restrictToAdminId`.
The row shape (`AdminTicketRow`) is shared with the superuser ledger
(`/admin/tickets`) — a ticket's data doesn't change depending on who's
allowed to see it, only which rows come back.

**Superuser retains unrestricted approval, but it is now API-only.** The
`/admin/approvals` page and its nav tab were removed once approval was fully
delegated to the Unit Admin tier — a superuser has no approvals screen. The
endpoints stay (`GET /api/admin/agents`, `POST /api/admin/agents/:id/decision`),
and `admin.repository.decideAgent` called from them still passes no
`restrictToAdminId`, which is what §2's "ultimate authority" means
concretely. Treat it as break-glass: it is the only unrestricted approval
path in the system, and the only way to clear a queue when a unit admin's
account is lost or an agent is posted to a unit that has no admin yet. See
the header comment on `admin.routes.ts` for the exact calls.

**Provisioning is a dedicated script, not `db:seed`:**

```bash
npm run db:provision-units -w @pravasi/backend
```

`backend/src/db/provision-unit-admins.ts` creates the 30 real units, 33
`unit_admins` rows (one per unit, plus the 3 Zone Supervisor accounts), and
now also the Zone Supervisors' `supervisor_unit_assignments` rows. Unlike
`db:seed` it has **no `NODE_ENV` guard** — this is real event data, meant to
run once against production, not disposable dev fixtures — but it *is*
idempotent, safe to re-run.

> ⚠ **The 33 passwords are short, guessable (`<code>PW`), and committed to
> that file in plaintext.** That trade mirrors gate PINs (§2, Option A) —
> volunteers, no password manager — and is not a reason to skip rotation.
> Rotate every one before the event, either one at a time or all at once:
>
> ```bash
> npm run db:rotate -w @pravasi/backend -- audit-unit-admins   # who's still exposed
> npm run db:rotate -w @pravasi/backend -- unit-admin BAT01    # one at a time
> npm run db:bulk-rotate-passwords -w @pravasi/backend         # all 33 at once
> ```
>
> `db:bulk-rotate-passwords` generates **`<sector><4 digits>-pw`** — e.g.
> `BAD01` → `bad0846-pw`. All lowercase, so no shift key, and the only
> variable part is a digit run a numeric keypad handles: the staff using
> this are coming off paper systems and type on phones. Prints once, to
> the console, as the distribution list — never written to a file.
>
> ⚠ **This format carries 4 digits of entropy — 10,000 per account — and
> nothing else in it is secret.** The prefix is derived from the public
> username and `-pw` is constant, so an attacker who knows a unit code
> (it is printed on the roster and *is* the username) is guessing a
> 4-digit number. That is ~20x weaker than the `Bat01-7kX` format it
> replaced, and it was chosen deliberately, on instruction, with the
> tradeoff stated. What actually stands behind it:
>
> - `loginLimiter` (auth.routes.ts) — 20 attempts / 15 min / IP. One IP
>   needs ~125 hours to exhaust one account; a spray from many IPs is
>   proportionally faster, which is the real exposure.
> - Blast radius is bounded by role: a unit admin approves agents and
>   reads its own subtree. It cannot issue tickets, revoke them, scan, or
>   reach another unit. The worst case is a rogue *agent* being approved —
>   who then can issue — so treat an unexpected approval as the signal.
> - `AGENT_APPROVED` / `AGENT_REJECTED` rows in `audit_logs` carry the
>   approving `unit_admins.id`, so misuse is attributable after the fact.
>
> If that stops being acceptable, raise `DIGIT_COUNT` in
> `bulk-rotate-passwords.ts` rather than reintroducing letters — each
> extra digit is 10x the space for one more keypress.

**Resolved: Zone Supervisor coverage uses the mapping table (Option B),
seeded with a placeholder split — replace before the event.** The 3 accounts
(`ZON01`–`ZON03`) stay unscoped on `unit_admins.unit_id` (`NULL`) and instead
get rows in `supervisor_unit_assignments`, seeded by `provision-unit-admins.ts`
as `UNITS` chunked into three groups of ten **in array declaration order**
(`UNITS[0..9]` → `ZON01`, `[10..19]` → `ZON02`, `[20..29]` → `ZON03`). This is
explicitly **not** a geographic assignment — nobody has specified which
sectors each supervisor should actually cover — it exists purely so every
zone dashboard is populated and testable out of the box. Replace it with the
real split once decided: delete the stale rows for a zone from
`supervisor_unit_assignments` and insert the correct set (direct SQL, or edit
the chunking in `provision-unit-admins.ts` and re-run — the insert is
`ON CONFLICT (admin_id, unit_id) DO NOTHING`, so a rerun only adds, never
removes; removal of an incorrect assignment is manual by design, the same way
a wrongly-approved agent isn't auto-corrected either). A supervisor can also
be given a direct `unit_id` posting on top of its zone rows — the two
mechanisms compose.

---

## 4. Business Logic — Ticketing

Every registration produces a unique **Request Number** (`REQ-2026-NNNNNN`) and a
unique **Ticket Number** (`TKT-NNNN`).

### 4.1 Capacity and QR fan-out

| Ticket Type | Persons Admitted | QR Codes Generated                  |
| ----------- | ---------------- | ----------------------------------- |
| Normal      | 1                | **1** — one guest code              |
| VIP         | 4                | **5** — 4 × Guest QR + 1 × Location QR |
| VVIP        | 4                | **5** — 4 × Guest QR + 1 × Location QR |
| SVIP        | 4                | **5** — 4 × Guest QR + 1 × Location QR |

The three premium tiers are **identical in capacity**. They differ only in
presentation, pricing, and access zone — never in seat count.

> **Printed panels differ from database rows.** The table above is the
> `qr_codes` fan-out. What the pass *prints* is:
>
> | Tier | Printed panels | Made of |
> | --- | --- | --- |
> | Normal | **2** | 1 Location + 1 Guest |
> | VIP / VVIP / SVIP | **5** | 1 Location + 4 Guest |
>
> **Every Location panel on every tier encodes `VENUE_INFO_URL`** — the fixed
> Google Maps link — not the backend's `LOCATION` payload. That payload is a
> bare UUID: a guest pointing a phone camera at it gets nothing, where the URL
> opens directions. It carries no admission value and the gate returns
> `UNKNOWN_CODE` for it.
>
> Normal has no `LOCATION` row at all (one code, `GUEST`), so its panel is
> added by the component. `qrCodePlanFor()` is untouched — this is print
> layout, not fan-out.
>
> **Consequence, deliberately accepted:** premium tickets still get a
> `LOCATION` row in `qr_codes`, but it is no longer printed, so the gate's
> `LOCATION_INFO` path is unreachable from a scanned pass. Those rows are
> inert. Removing them is a change to `qrCodePlanFor()` and the table above —
> a §4.5 shared-constant change touching both tiers — not a component tweak.

### 4.2 Children below 12

Free. **Excluded from ticket capacity** — they do not consume a guest QR and do
not increment `countedPersons`. Recorded on the registration for catering and
crowd-safety headcount only.

Surfaced in three places, all read-only: the ticket stub (`Children Below 12`),
the pass footer beside the admitted count, and the **Children** column of the
agent ledger at `/agent/dashboard`. Printed even when zero — a gate reading
`+0 Children` knows the field was captured, where a missing line is ambiguous.

### 4.3 Enforcement

**The backend is the authority on capacity. The frontend is a convenience.**

- `countedPersons` is *derived*, never user-editable, and re-derived server-side
  on write. A client that posts `{ ticketType: 'Normal', countedPersons: 4 }`
  must be rejected, not trusted.
- QR fan-out happens server-side at issuance. Each QR row is independently
  scannable and independently marked consumed.
- Gate scans are **idempotent**: re-scanning an already-consumed guest QR returns
  a duplicate-entry response, never a second admission.
- The Location QR is not an admission credential. It must never decrement guest
  capacity.

### 4.4 Numbering and QR secrecy

Request and ticket numbers are **crypto-random, not sequential** —
`REQ-2026-K4H8QR`, `TKT-Q7X4M2`. A sequential number leaks total sales
volume to anyone holding one ticket and lets an attacker enumerate the range.
Collisions are absorbed by the unique constraint plus a bounded retry of the
whole transaction; never SELECT-then-INSERT, which races.

Both are 6 characters drawn from `ID_CHARSET` (`packages/shared/src/constants.ts`)
— uppercase A–Z and 2–9, with `0/O` and `1/I` dropped for the same
ambiguous-character reason as the unit-admin passwords (§3.3). That's 5 bits
per character, 2^30 of space — sized against this event's realistic ticket
volume with room to spare (see `identifiers.ts` for the exact math), not
against an arbitrary "sounds safe" length. Originally 12/10 hex characters;
shortened because staff read these off a printed stub and re-type them by
hand, and a longer, denser hex string is exactly what makes that error-prone.

**Not an admission credential.** Neither number gates entry — the QR payload
does that, is a full UUID, and is never shortened. Being short and
human-typable is fine here specifically because the worst a stolen/guessed
request or ticket number gets you is a searchable label, not a scan.

**The database never stores a QR payload.** Issuance generates a UUID per code,
stores `sha256(payload)` in `qr_codes.qr_hash`, and returns the raw payloads
**once**, in the issuance response. They are unrecoverable afterwards, so
reissuing a lost ticket means generating new codes and revoking the old ones.
The gate hashes what it scanned and matches on the indexed hash.

SHA-256 rather than bcrypt is deliberate: the payload is a 122-bit random value,
not a password. There is no dictionary to attack, and the gate needs one indexed
lookup rather than a per-row comparison.

### 4.5 The single source of truth

Seat counts and QR counts must live in **`packages/shared`** and be imported by
both tiers. If the issuer and the scanner ever disagree about what "VIP" means,
the gate admits the wrong number of people. This is the highest-severity class of
bug in the system.

> **Done.** `SEATS_PER_TIER`, `PREMIUM_TICKET_TYPES`, `qrCodeCountFor()` and
> `qrCodePlanFor()` live in `packages/shared/src/constants.ts` and are imported
> by both tiers. Nothing in `frontend/` or `backend/` may re-declare them.
>
> Canonical tier values are **UPPERCASE** (`NORMAL`, `VIP`, `VVIP`, `SVIP`),
> matching the Postgres `ticket_type` enum. `TICKET_TYPE_LABELS` is for display
> only — never persist or transmit a label.

---

## 5. Design Language

Apple-like minimalism carrying the event's brand as accent, not as chrome.

### 5.1 Principles

- **Extreme restraint.** Generous whitespace, few borders, no gradients on UI
  surfaces. If a divider can be omitted, omit it.
- **Surfaces:** page background `bg-gray-50`; cards pure white, `rounded-3xl`,
  `shadow-[0_8px_30px_rgb(0,0,0,0.04)]` plus `ring-1 ring-gray-900/[0.04]`.
  Soft and diffuse — never a hard drop shadow.
- **Glassmorphism** is reserved for *floating* elements only (action bars, nav
  overlays): `bg-white/70 backdrop-blur-xl border border-white/60`. Never on
  static content cards.
- **Radii:** `rounded-xl` inputs → `rounded-2xl` buttons/panels →
  `rounded-3xl` page cards → `rounded-full` pills. Continuous, never mixed
  arbitrarily.
- **Motion:** `transition-all duration-200`, `active:scale-[0.98]` on primary
  buttons, `active:scale-[0.97]` on pills. Nothing bounces.

  Anything that enters or leaves the tree uses **framer-motion springs** from
  `lib/motion.ts` — never an ad-hoc tween. Damping never drops below ~26, so
  surfaces settle rather than overshoot. CSS transitions stay for hover and
  press states; springs are for presence. `MotionConfig reducedMotion="user"`
  wraps the app: the scanner throws full-screen colour several times a minute,
  and a motion-sensitive agent works a six-hour shift.

- **Toasts vs inline state.** Toasts (`sonner`, top-center) carry *transient
  outcomes* — wrong PIN, email sent, PDF saved. *Persistent state* — offline,
  pending sync, reconnecting — stays inline where it can be read at any moment.
  Never put a gate's connection status in something that disappears.

### 5.2 Typography

**Montserrat** (see §5.3.1), system-sans fallback. Apple's type scale does
**not** align with Tailwind's defaults — use explicit pixel sizes.

- Page title `text-[26px] font-semibold tracking-[-0.02em]`
- Body / inputs `text-[15px]`
- Labels `text-[13px] font-medium text-gray-700`
- Helper / muted `text-[12px] text-gray-400`
- Eyebrow / uppercase `text-[10px]–[11px] tracking-[0.08em–0.28em]`

Tight tracking on large text, wide tracking on small uppercase text. That
contrast is most of the "Apple" feel.

### 5.3 Brand palette — official

Sampled from the event logo. Do not introduce a violet or amber shade that is
not on this list.

| Token         | Hex       | Use                                                        |
| ------------- | --------- | ---------------------------------------------------------- |
| Violet        | `#5E17EB` | **Primary action.** Buttons, focus rings, links, active states |
| Violet Deep   | `#37098C` | Dark surfaces — the ticket body, the login card's band      |
| Violet Dark   | `#2E0775` | Deepest — QR caption blocks, date box, ticket footer        |
| Amber         | `#FFA51F` | Accents, borders, icons, diamonds (on dark violet only)     |
| Amber Light   | `#FFD79A` | Highlights, small text on dark violet                       |
| Light Grey    | `#E6E6E6` | Dividers, subtle lines                                      |

Available as `brand-violet`, `brand-violet-deep`, `brand-violet-dark`,
`brand-amber`, `brand-amber-light`, `brand-grey` in Tailwind, and as
`--brand-*` custom properties in `globals.css`.

Rules:

- **Violet `#5E17EB` is the single action colour**, everywhere. Primary
  buttons, focus rings, required-field markers, links, active borders. There
  is no second action colour. It measures 7.5:1 on white.
- **`#5E17EB` and `#37098C` are not interchangeable, and one value cannot
  replace both.** The action colour has to read on white; the ticket surface
  has to let *amber* read on it. Amber on `#5E17EB` is 3.81:1 — fine for
  display type, failing at the 8–10px the ticket sets its eyebrows in. On
  `#37098C` it is 6.74:1, and white on it is 13.3:1.
- **Amber only appears on dark violet.** On white it measures 1.97:1 and is
  unreadable — the same trap the previous gold had at 2.10:1. Use it for
  eyebrow text, hairline rules, badges, diamonds and icon accents *over deep
  violet* — never as text or an action on a white or grey surface.
- **Mastheads are white, not a dark band.** The logo artwork is dark violet
  and disappears on a dark surface (~59% of its ink measures 1.0–1.5:1 on the
  old navy). Inverting the masthead is the fix; do not put the mark on a
  white chip, and do not recolour supplied artwork.
- On a white masthead the overline takes **violet**, not amber, for the same
  1.97:1 reason.
- Brand colours are **accents in the app shell**, and **the entire surface on
  the ticket**. Do not violet-wash the dashboard.
- Inside the ticket, apply brand colours via inline `style` with the `VIOLET` /
  `VIOLET_DARK` / `AMBER` / `AMBER_LIGHT` constants — not Tailwind arbitrary
  classes. Reason: amber is used at multiple alphas (`33`, `55`, full), and
  inline styles survive print/PDF/email rendering far more reliably than
  generated utility classes.
- **Semantic colours are exempt and universal.** Emerald = admitted/success,
  amber-600 = duplicate/pending, red = invalid/error. These are never
  re-themed to brand colours — a gate agent reads them pre-linguistically.
  Note the semantic amber is Tailwind's, not `brand-amber`; they are different
  values doing different jobs.
- The dashboard chart palette is a **separate, validated set** in
  `components/charts/chartTheme.ts`. It is deliberately independent of the
  brand and was audited for categorical distinction on white — do not
  substitute brand violet into it beyond `BAR_VIOLET`, which is the
  single-series bar and has no adjacent hue to separate from.

> **There is no navy or gold in this system.** `#062B59` and `#D4AF37` were
> the palette before the logo changed. If either reappears in a diff, it is a
> regression. (`#800000` maroon was retired even earlier.)

### 5.3.1 Typography — Montserrat

Loaded via `next/font/google` in `app/layout.tsx`, exposed as
`--font-montserrat` and wired to `font-sans`. Weights 400–900.

**Not** a `@import` in CSS: `next/font` self-hosts the files, so the gate PWA
still renders correctly offline. A Google Fonts import is a runtime request to
a third-party origin that the service worker is forbidden from caching.

### 5.4 The two-layer focus ring

The signature interaction detail. Every focusable input uses **both** a border
tightening and a wide soft ring — this approximates the macOS focus glow, which a
single ring cannot:

```
focus:border-[#5E17EB]/40 focus:ring-4 focus:ring-[#5E17EB]/10
```

Error state swaps the hue, never the structure:
`focus:border-red-400 focus:ring-4 focus:ring-red-500/10`.

---

## 6. Coding Standards

### 6.1 Derived state

Anything computable from other state is computed with `useMemo` — never mirrored
into its own `useState`. Duplicated state drifts, and in this system drift means
wrong admission counts.

```tsx
// Correct — capacity cannot desync from the tier
const countedPersons = useMemo(() => SEATS_PER_TIER[ticketType], [ticketType]);
```

Read-only derived inputs get `readOnly` **and** `tabIndex={-1}` so keyboard users
don't land on a dead field.

### 6.2 Print-friendly CSS

**PDF export is `window.print()`, not a rasteriser.** `lib/printTicket.ts`
sets `data-printing="ticket"` on `<html>`, the `@media print` block in
`globals.css` hides everything except `[data-print-ticket]`, and the browser
lays the page out itself — so text and QR codes stay vector.

The old path captured the pass with html2canvas and wrapped the PNG in jsPDF.
That produced a PDF of pixels, and because html2canvas approximates line
boxes rather than implementing CSS layout, it clipped descenders and
mis-centred badges no matter how padding was tuned. **Do not reintroduce it.**
In particular, never set `line-height: normal` on the pass: html2canvas
resolves `normal` with its own approximation, so the box it rasterises does
not match the one the browser laid out. Every text node on the ticket carries
an explicit px line-height for that reason.

html2canvas remains — correctly — for the **PNG** an agent shares over
WhatsApp (`lib/shareTicket.ts`), where the output is an image anyway.

Tickets are printed and saved as PDF constantly. Every ticket-bearing screen must:

- Mark all app chrome `print:hidden` (search bars, action bars, nav, toasts).
- Neutralize mobile layout hacks for print: `print:min-w-0`,
  `print:overflow-visible`, `print:shadow-none`.
- `globals.css` must carry `-webkit-print-color-adjust: exact;` and
  `print-color-adjust: exact;` — without it browsers strip the violet ticket fill
  and print a white rectangle.

### 6.3 Defensive UI fallbacks

- Optional data drives *state*, not blank space. No email on file → render a
  disabled **"No Email Available"** pill, not a hidden button.
- Branch layouts must fill their own gaps. A Normal ticket leaves four empty QR
  slots, so it renders an "Admits 1 Person" block instead.
- Props carry sensible defaults (`ticket = MOCK_TICKET`) so every component
  renders standalone for review without a live backend.
- Validation is thin client-side (presence, shape) and authoritative server-side.
  Client validation is a courtesy, never a control.

### 6.4 Conventions

- `'use client'` only where interactivity genuinely requires it.
- Backend is **feature-sliced** (`modules/tickets/*`), not layer-sliced. A ticket
  change should touch one folder.
- Local UI primitives (`Field`, `ActionPill`, `StubItem`) live at the bottom of
  their consuming file until a *second* screen needs them — then they graduate to
  `components/ui/`. Don't pre-abstract.
- Placeholder implementations carry a comment naming their real replacement.
  Example: `MockQr` → swap for `qrcode.react`, `seed` prop becomes `value`.

---

## 7. Repository Layout

```
pravasi-sangama/
├── CLAUDE.md
├── packages/shared/      # types, enums, SEATS_PER_TIER, zod schemas — BOTH tiers
├── backend/src/
│   ├── modules/          # auth, divisions, units, agents, tickets, scanning, analytics, audit
│   ├── db/migrations/    # divisions, units, agents, tickets, qr_codes, scan_logs
│   ├── middleware/       # auth guard, role guard, rate limit
│   └── lib/              # qr generator, id sequencer, hashing, pdf builder
└── frontend/src/
    ├── app/              # (public) | (agent) | (admin) route groups + api/ BFF
    ├── components/
    │   ├── ui/           # shared design system
    │   ├── registration/ # NewRegistrationForm
    │   ├── ticket/       # TicketReceipt
    │   └── charts/       # Recharts wrappers
    └── styles/tokens.css
```

---

## 8. Current State

**Built:**

- `frontend/src/components/registration/NewRegistrationForm.tsx` — issuance form,
  tier→capacity derivation, two-layer focus rings, thin client validation.
- `frontend/src/components/ticket/TicketReceipt.tsx` — the physical pass (navy +
  gold, stub + main body), dynamic 1-or-5 QR rail, glass action bar, print rules,
  optional asset layer over the CSS shapes.
- `frontend/src/lib/ticketAssets.ts` — asset registry. Every entry optional and
  commented out until the file exists; absent entries fall back to CSS shapes.
- `backend/` — Express foundation: env validation (fail-fast at boot), pg pool +
  `withTransaction`, error handler, health route, graceful shutdown.
- `backend/src/db/schema.sql` — full schema, idempotent, with capacity and QR
  fan-out rules enforced as CHECK constraints.

- `packages/shared` — capacity constants, Zod wire schemas, JWT claim types.
  Imported by both tiers; npm workspaces at the repo root.
- `backend/src/modules/auth/` — single-step agent login, the Unit Gateway
  (`POST /api/auth/unit-gateway`, re-verified again inside `agentSignup` —
  §3.2), gate and superuser login.
- `backend/src/modules/tickets/` — issuance, crypto-random numbering, QR fan-out.
- `backend/src/modules/scanning/` — `/verify` and `/bulk-sync`, one shared
  `resolveScan()` core.
- `backend/src/modules/analytics/` — `GET /api/analytics/dashboard`.
- `frontend/src/components/scanner/` — PWA gate scanner, IndexedDB queue.
- `frontend/src/components/admin/SuperuserDashboard.tsx` — Recharts dashboard,
  5s polling. Chart palette in `components/charts/chartTheme.ts`.
- `frontend/public/sw.js` + `manifest.json` — offline shell.

- `backend/src/socket.ts` — `/live` namespace, alert + coalesced feed channels.
- `frontend/src/store/useAuthStore.ts` — Zustand session mirror (not persisted).
- `frontend/src/middleware.ts` + `components/auth/ProtectedRoute.tsx` — the two
  routing layers. **Neither is an authorization boundary** — see §11.
- `frontend/src/app/` — `/login` (public: Unit Gateway → agent login /
  first-time setup, **nothing administrative**), `/management` (Super User
  and Unit Admin sign-in, plus a link to the gate scanner — see §11),
  `/dashboard`, `/ticketing`, `/scanner`, `/agent/dashboard` (agent ledger),
  `/admin/directory`, `/admin/tickets` (master ledger), `/admin/gates`,
  `/unit/dashboard` (unit admin's own approvals — §3.3).
- `backend/src/modules/admin/` — approvals, gates, agent directory, and the
  master ticket ledger (`GET /api/admin/tickets` + `/filter-options`).
  Ledger totals are a SQL aggregate over the whole filtered set, deliberately
  not a sum of the returned rows — the row list is capped and would
  under-report. Both queries share one parameterised WHERE builder so the
  summary cards can never describe a different set than the table.
  `GET /api/admin/tickets/export` shares the same WHERE builder and filters
  (plus `status`, ACTIVE/REVOKED — the one filter the JSON ledger didn't
  already have, added alongside this) but with its own fixed row cap
  (`EXPORT_ROW_LIMIT`, 100,000 — a backstop, not a page size) instead of the
  client-suppliable `limit`, and returns `text/csv` with a
  `Content-Disposition: attachment` header instead of JSON. The frontend
  can't reuse `apiGet` for it — that always calls `res.json()`, which throws
  on a CSV body — so `apiClient.ts` has a parallel `apiDownload()` that reads
  the browser-download filename from the response header and triggers it via
  an off-DOM anchor click.
- `backend/src/modules/unit-admin/` — a unit admin's own approvals queue and
  ticket ledger (§3.3). `decideAgent` reuses `admin.repository.decideAgent`
  /`writeAudit` rather than a parallel implementation of the race-safe UPDATE
  (§10.2's "the row is the lock" applies here too), passing its own admin id
  as `restrictToAdminId`; `listTickets` (`GET /api/unit-admin/tickets`) runs
  its own OR-scope query over `tickets` via `unitAdminTicketWhere()`, same
  union, row shape borrowed from `admin.repository.ts`'s `AdminTicketLedgerRow`.
- `backend/src/db/provision-unit-admins.ts` — one-time provisioning for the
  Unit Admin tier (30 units, 33 accounts, plus a placeholder 10/10/10 zone
  split into `supervisor_unit_assignments`), and now also each of the 30
  units' `agent_invite_pin_hash` (§3.2) — a distinct, independently-generated
  4-digit PIN per unit, hardcoded in the same `UNITS` array as the unit-admin
  passwords and printed in the report (unlike those passwords, since a unit
  head has to keep reciting this one to agents, not just use it once
  themselves). Not `db:seed`: real production data, no `NODE_ENV` guard, but
  idempotent. Run once, then rotate every password — see §3.3.
- `backend/src/db/provision-scanners.ts` — provisions 20 Gate Scanner rows
  (`SCAN01`–`SCAN20`) into the existing `gates` table — a gate is a place,
  not a person (§2, Option A), so this is the same shared-PIN model every
  gate already uses, not a new account type. PINs are 6-digit numeric,
  deliberately not alphanumeric — `GateLoginSchema` validates gate PINs as
  digits-only and the scanner login page's numeric keypad strips anything
  else as it's typed. Idempotent but reissues all 20 PINs on every run, so
  it is a provisioning tool, not a rotation tool.
- `backend/src/db/provision-superusers.ts` — provisions 3 real Super User
  accounts (`ADMIN01`–`ADMIN03`, spec §4's "exactly three"), distinct from
  `db:seed`'s disposable `admin1`/`admin2`/`admin3` sharing one hardcoded
  password. 8-character passwords via `lib/passwordGen.ts`'s
  `generateSecurePassword()` — the same unambiguous alphabet and guaranteed
  upper/lower/digit mix `db:bulk-rotate-passwords` uses for its suffix.
  `email` is left `NULL`; nothing fabricates an address nobody supplied.

**Not yet built:** divisions/units/agents CRUD, ticket revocation, real QR
encoding, `gate:offline` heartbeat, a superuser UI for editing zone coverage
(direct SQL against `supervisor_unit_assignments` only — see §3.3), replacing
the placeholder 10/10/10 zone split with the real geographic assignment, a way for a
unit admin to **rotate** their own `agent_invite_pin` (they can now *view*
it — `GET /api/unit-admin/invite-pin`, shown on `/unit/dashboard` — but
changing it is still `db:provision-units` or direct SQL, and remember to
write both columns; see Known debt 8).

---

## 11. Frontend Route Protection

Two layers, neither of which protects data.

**`middleware.ts`** decodes the cookie payload **without verifying the
signature** — the signing secret lives on the API, not the web tier. It is
navigation UX: it keeps an agent out of `/dashboard` and an unauthenticated
volunteer out of `/scanner`. A forged cookie reaches an empty shell.

**`ProtectedRoute`** waits for `GET /api/auth/session`, which the API validated
properly, and redirects on mismatch. It also covers client-side navigations.

**The real boundary is `requireAgent` / `requireSuperuser` on every endpoint.**
Do not add a check to the frontend and consider a route secured.

Route groups (`(admin)`, `(agent)`) produce **no URL segment**. The live paths
are `/dashboard`, `/ticketing`, `/scanner`, `/agent`, `/unit`, and
`middleware.ts` matches those literal paths — adding a page means adding it to
`ROUTE_ROLES` *and* `matcher`.

**Two login surfaces, split by audience.**

| Path | Who | Contains |
| --- | --- | --- |
| `/login` | Event staff | Unit Gateway, Agent Login, First-Time Setup |
| `/management` | Management | Super User, Unit Admin, → Gate Scanner |

`/login` carries **no administrative entry points at all** — the three
sign-in links that used to sit at the bottom of that card were removed, and
`AdminForm` / `UnitAdminForm` moved to `app/management/page.tsx`. Several
hundred agents use `/login`; none of them should be looking at a door they
must never open.

> **The path is segregation, not secrecy.** A URL is not a credential:
> `/management` is in this repository, in the built bundle, and in browser
> history. What protects those roles is unchanged — the passwords,
> `requireSuperuser` / `requireUnitAdmin` / `requireScanAccess` on every
> endpoint, and the rate limiter. Do not treat "it's on a separate path" as
> a control.

Both are in `PUBLIC_ROUTES`, since a login page has to be reachable without
a session; `/management` is listed there (rather than merely left out of
`matcher`) so an already-signed-in visitor is bounced to their own home
instead of being shown a role chooser. **`/management`, not `/admin`,
precisely because** `ROUTE_ROLES` guards the whole `/admin` prefix with
`SUPERUSER` — a login form living there would redirect its own users away
before they could sign in.

Gate Scanner is a link to `/scanner/login`, not a fourth inline form: that
page already exists, is already public, and is part of the offline PWA
shell. `/login?mode=admin|unit-admin` (the older deep links) redirect to
`/management?role=…` so saved bookmarks still land somewhere useful.

Sharing `JWT_SECRET` with Next to verify in middleware was rejected: it would
let the web tier mint tokens, which is a worse trade than an empty shell.

**Known debt:**

1. `npm audit` flags `nodemailer`, and `sharp`/`postcss` transitively via
   Next. None are on a request path; clear before production. (html2canvas
   and jspdf are no longer among them — jspdf was removed with the raster
   PDF path.)
2. The ticket has no true perforation notches — deliberately omitted, since
   background-colored cutout circles break in print and email.
3. Socket rooms are a single `superusers` room. Division-scoped rooms (§10.5)
   land with division admins. No `gate:offline` heartbeat yet — "active gate"
   is inferred from recent scan activity.
4. `request_number_seq` / `ticket_number_seq` in the baseline schema are now
   unused — numbers are crypto-random, not sequential (§4.4). Drop in a later
   migration.
5. The seed creates no tickets, so there is nothing to scan yet.
6. Premium `LOCATION` rows in `qr_codes` are issued but never printed (§4.1),
   so `LOCATION_INFO` is unreachable at the gate. Inert, not harmful.
7. `units.sector` is free text with no FK or CHECK. Migration 010 normalises
   and re-asserts the canonical mapping, and `provision-unit-admins.ts`
   writes the same pairs, but a hand-written `UPDATE units SET sector =
   'Batha'` would still create a phantom sector. The filter list is derived
   from `DISTINCT sector`, so a typo shows up as an extra dropdown entry
   rather than silently swallowing rows.
8. `units.agent_invite_pin` (migration 011) is a readable copy of a value
   whose *verification* path is still the bcrypt `agent_invite_pin_hash`.
   Both are written together by `db:provision-units`, `db:seed` and
   migration 011, but a manual UPDATE to one alone drifts them — and the
   failure mode is a unit head reading out a PIN that does not work. If you
   ever change a PIN by hand, change both columns.

> **Postmortem — every gate scan failed (fixed).** `insertScanLog` used
> `ON CONFLICT (client_scan_id) DO NOTHING`, but migration 001 creates that
> arbiter as a **partial** unique index (`WHERE client_scan_id IS NOT NULL`,
> because online scans that never queued carry NULL). Postgres can only
> infer a partial index as an arbiter when the conflict target repeats its
> predicate; a bare target matches no usable index and raises 42P10. That
> aborted the transaction in `resolveScan()`, rolling back the
> `admitGuestCode()` UPDATE with it — so the QR never flipped to `SCANNED`,
> no `scan_logs` row was written, and `/api/scan/verify` 500'd on **every**
> scan, not an edge case. The scanner then did exactly what §10.3 tells it
> to do with a 5xx: treat it as retryable, queue the scan, and show a green
> **Admitted — pending sync**. So the gate looked like it was working while
> nothing reached the database. Two changes: the conflict target now carries
> the predicate, and a 5xx is no longer reported to staff as if it were bad
> wifi (`ScanFailureKind` in `lib/scanApi.ts` — a red **Server error**
> badge, distinct from amber **Offline**).

## Setup

```bash
docker compose up -d postgres   # local Postgres 16 on :5432; adminer UI on :8080
npm install                     # workspaces; shared builds via its prepare script
npm run build:shared            # after editing packages/shared — see note below
npm run db:migrate
npm run db:seed                 # dev credentials, printed to stdout
npm run dev:api                 # :4000
npm run dev:web                 # :3000
```

> **`@pravasi/shared` is consumed as compiled output**, not source. Any edit
> under `packages/shared/src` is invisible to both tiers until you re-run
> `npm run build:shared`. This is the #1 cause of "I changed the constant but
> nothing happened."

Seeded fixtures: division `RIYADH`; units `DEV5BUILDING` and `DEVDEERA`,
both behind Unit Gateway PIN `1234` (§3.2 — a unit still has no *login* PIN
of its own, this is the separate agent-invite gate in front of the portal);
agents `8888999955` / `8888999956` on `DEV5BUILDING` and `8888999957` on
`DEVDEERA` (password `agent1234`); superusers `admin1` / `admin2` / `admin3`
(or their `@pravasisangama.com` emails) / `SuperAdmin@2026` — **development
only**. Migration 012 deactivates these three, and `db:provision-superusers`
deactivates everything that is not `ADMIN01`–`ADMIN03`, because
`SuperAdmin@2026` is committed to this repository and was reachable on a
live deployment.
>
> Note the loop: `db:seed`'s upsert sets `is_active = TRUE`, so running it
> again **re-enables them**. That is intended for development and is why the
> seed is the only script with a `NODE_ENV` guard. If you ever run it against
> production with `ALLOW_PROD_SEED=true`, re-run `db:provision-superusers`
> afterwards or those public credentials are live again. No gates — `db:seed`
stopped creating any once migration 008 retired the `GATE1`/`GATE2`
fixtures; provision `SCAN01`–`SCAN20` with `db:provision-scanners` instead
(§8). The seed is idempotent and refuses to run in production without
`ALLOW_PROD_SEED=true`.

### Other commands

```bash
npm run typecheck           # tsc --noEmit across every workspace, root script
npm run typecheck -w @pravasi/backend    # single workspace
npm run typecheck -w @pravasi/frontend
npm run build:shared        # tsc -p packages/shared/tsconfig.json
npm run dev:shared          # tsc --watch, if iterating on shared in isolation
npm run db:reset -w @pravasi/backend     # db:migrate + db:seed in one shot
```

`npm run <script> -w @pravasi/<backend|frontend|shared>` runs a script in one
workspace only — the general pattern for anything not exposed as a root
script (e.g. `npm run build -w @pravasi/frontend` for a production `next build`).

**No lint is configured** (no ESLint config in any workspace) and **no
automated test suite exists** — `TESTING.md` is a manual E2E checklist and is,
today, the entire test suite for this repo. Before calling any change to
auth, ticketing, or scanning "done," walk the relevant section of
`TESTING.md` by hand. `typecheck` is the only automated correctness gate;
run it on both `backend` and `frontend` before considering a change complete.
`DEPLOYMENT.md` covers the production topology (Supabase/Render/Vercel) and
the cookie-domain decision in §3 of this file — read its §0 before touching
anything cookie- or CORS-related.

---

## 9. Asset Pipeline

Real design assets (backgrounds, ribbons, textures) live under
`frontend/public/assets/ticket-design/`, registered in
`frontend/src/lib/ticketAssets.ts`. Every entry is optional and commented out
until the file exists. Components must degrade to CSS-only rendering when an
asset is absent — the CSS shapes are the fallback, not dead code.

---

## 10. Gate Scanning Architecture (Offline-First)

Event day is the only day that matters. Hundreds of scans per minute, venue
wifi under load, agents on shared phones. **The gate must keep working when the
network does not.**

The governing principle: *a scan is a claim, not a fact.* The client records
claims; the server resolves them into admissions. Nothing at the gate blocks on
a round trip.

### 10.1 The online path — `POST /api/scan/verify`

Single point lookup, single transaction, no joins on the hot path.

```
POST /api/scan/verify        (requireAgent)
  { "payload": "<raw uuid>", "client_scan_id": "<uuid>", "gate_label": "GATE-2" }

→ 200 { "status": "SUCCESS",   "reason": "ADMITTED",        "ticket": {...} }
→ 200 { "status": "SUCCESS",   "reason": "LOCATION_INFO"    }
→ 200 { "status": "DUPLICATE", "reason": "ALREADY_SCANNED", "priorScan": {...} }
→ 200 { "status": "INVALID",   "reason": "TICKET_REVOKED" | "CODE_REVOKED"
                                         | "UNKNOWN_CODE"  }
```

**Always HTTP 200 with a `status` discriminant.** A duplicate is not a client
error — it is a valid, expected answer that the gate UI must render loudly.
Reserve non-2xx for auth and malformed input. This matters most offline: the
queue treats any non-2xx as "network problem, retry later", so returning 409
for a duplicate would make scanners retry a settled verdict forever.

Two levels, deliberately:

- **`status`** — `SUCCESS | DUPLICATE | INVALID`. Green, amber, red. The only
  field the gate UI branches on.
- **`reason`** — the precise cause, for logs, analytics and the message line.
  Maps to `scan_logs.result` via `SCAN_REASON_TO_RESULT` in shared.

Every response also carries `codeKind` and `guestIndex`, so the UI can tell a
guest admission from a location pass, and `replay: true` when the response was
reconstructed from an earlier identical `client_scan_id`.

Requirements:

- **Indexed lookup only.** `qr_codes.qr_hash` is UNIQUE; the scan is one B-tree
  point lookup. Never scan by ticket number or purchaser at a gate.
- **One transaction** per scan: conditionally update `qr_codes`, insert into
  `scan_logs`, commit. Both or neither.
- **Every attempt is logged**, including `DUPLICATE` and `UNKNOWN_CODE`.
  `qr_codes.scanned_at` records the admission; `scan_logs` records the history.
  A burst of `DUPLICATE` at one gate is the signature of a copied ticket.
- **`LOCATION` codes never admit.** They resolve to a venue-info response and
  must not decrement capacity or set `scanned_at` on a guest code.
- Target p99 < 50ms server-side. Budget the whole gate interaction at 300ms.

### 10.2 Race conditions

Two scanners hitting the same QR in the same millisecond is not hypothetical at
a four-guest VIP ticket. **Do not read-then-write.** The conditional UPDATE is
the lock:

```sql
UPDATE qr_codes AS q
   SET status = 'SCANNED', scanned_at = NOW(), scanned_by = $2
  FROM tickets AS t
 WHERE q.qr_hash   = $1
   AND q.status    = 'ISSUED'     -- the guard
   AND q.code_kind = 'GUEST'      -- location passes are never consumed
   AND t.id        = q.ticket_id
   AND t.status    = 'ACTIVE'     -- revocation is atomic with admission
RETURNING q.id, q.ticket_id, q.code_kind, q.guest_index;
```

Exactly one transaction matches. Zero rows means the caller must diagnose why
with a follow-up read: already `SCANNED`, code `REVOKED`, parent ticket
`REVOKED`, a `LOCATION` code, or no such hash. No `SELECT … FOR UPDATE`, no
advisory locks, no application-level mutex — the row is the lock. Same pattern
as the race-safe agent binding in `auth.repository.ts`.

**Location codes are never consumed.** Guests rescan the venue pass all evening;
burning it on first use would turn every later scan into a false duplicate. It
resolves to `LOCATION_INFO` and does not touch capacity.

**Ticket revocation is enforced in the same statement.** Joining `tickets` into
the UPDATE means a revoked ticket cannot be admitted by a code that still reads
`ISSUED` — a separate pre-check would race.

### 10.3 The client — PWA with a local queue

The scanner UI is a **Progressive Web App**. Service worker precaches the app
shell so a cold start works with no network.

**Service worker scope — read this before changing `public/sw.js`.** The worker
caches the *shell only*. Every `/api/*` request passes through untouched, with
no `respondWith` at all. Scan durability is the app's job (IndexedDB queue +
bulk-sync); a worker that cached or replayed an admission would corrupt exactly
the headcount the queue exists to protect. Navigations are network-first with a
3s timeout, not stale-while-revalidate — serving stale HTML that references
purged build chunks produces a white screen at a gate.

**Local store: IndexedDB (`idb-keyval`).**

```
scan_queue     { client_scan_id (pk), qr_payload, scanned_at, gate_label,
                 sync_state: 'PENDING'|'SYNCING'|'SYNCED'|'REJECTED',
                 attempts, last_error }
known_codes    { qr_hash (pk), ticket_type, guest_index }   -- optional prefetch
local_admits   { qr_hash (pk), scanned_at }                 -- offline dedupe
```

**Online mode.** Scan → `POST /api/scan/verify` with a **1500ms timeout**.
Result renders immediately. The scan is still written to `scan_queue` first and
marked `SYNCED` on success — the local record is created before the request, not
after, or a response lost in flight loses the scan.

**Offline fallback.** Triggered by timeout, network error, or 5xx — *not* by
`navigator.onLine`, which lies on captive venue wifi. The scan is written
`PENDING`, checked against `local_admits` for a same-device duplicate, and the
UI shows an unmistakable **`PENDING SYNC`** state: amber, not green. Staff must
be able to tell admitted-and-confirmed from admitted-and-unverified at a glance.

The gate **admits on a pending scan**. Holding a queue at the door to wait for
wifi is worse than the failure mode it prevents.

### 10.4 Background sync — `POST /api/scan/bulk-sync`

A worker drains the queue whenever the network returns, using the Background
Sync API where available and a 5s interval retry with exponential backoff
elsewhere.

```
POST /api/scan/bulk-sync
  { "scans": [ { client_scan_id, qr_payload, scanned_at, gate_label }, ... ] }
→ 200 { "results": [ { client_scan_id, result, server_scanned_at }, ... ] }
```

- **Batch ≤ 200** per request; drain oldest first.
- **`client_scan_id` (client-generated UUID) is the idempotency key.** Requires
  `client_scan_id UUID UNIQUE` on `scan_logs` — *pending migration*. Replays
  after a half-delivered batch must be free, so the insert is
  `ON CONFLICT (client_scan_id) DO NOTHING` and the stored result is returned.
- **`scanned_at` is the client's timestamp, and it wins for ordering.** Offline
  scans are replayed in the order they physically happened, not in arrival
  order. Clock skew is bounded by stamping a server-time offset at login.
- Results are **per-item**. A rejected scan never fails the batch.

**The honest limitation.** Two devices offline simultaneously can both admit the
same guest QR. On sync, the earlier `scanned_at` becomes `ADMITTED` and the
later becomes `DUPLICATE` — but the second person is already inside. This is
inherent to admitting without a round trip, and it is the right trade: a gate
that stalls is a worse failure than a rare double-admit. Mitigate, do not
pretend to solve:

- Never rewrite history to hide it. The `DUPLICATE` row stands.
- Raise a **`POST_SYNC_DUPLICATE`** alert on the superuser dashboard with both
  gate labels and both timestamps.
- Prefetch `known_codes` per unit so offline devices catch same-ticket reuse
  locally where they can.

### 10.5 Real-time — superuser dashboard

**socket.io** (already in the stack; SSE is the fallback if the deployment
cannot hold open upgrades).

- Namespace `/live`, superuser JWT required on handshake. Rooms per division so
  a division admin sees only its own subtree.
- Emitted on commit, never before: `scan:admitted`, `scan:duplicate`,
  `scan:post_sync_duplicate`, `gate:offline` (no heartbeat for 60s).
- **Coalesce.** At peak, emit aggregate counters on a 1s tick and stream only
  exceptions (duplicates, revoked, unknown) as individual events. Streaming
  every admission to every dashboard is how the socket layer becomes the
  bottleneck instead of the database.
- The dashboard is a **consumer, not a source of truth.** It reconciles against
  a REST snapshot every 30s so a dropped socket cannot silently drift.

### 10.6 Non-negotiables

1. The gate never blocks on the network.
2. Every scan attempt is recorded — admitted, duplicate, revoked, unknown.
3. The conditional UPDATE is the only admission mechanism. No read-then-write.
4. `PENDING SYNC` is visually distinct from confirmed admission.
5. `client_scan_id` makes every sync retry idempotent.
6. Location codes never admit and never consume capacity.
