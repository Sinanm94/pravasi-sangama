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

## 2. System Architecture — Four Roles

The hierarchy is strictly nested. Every ticket traces back to exactly one agent,
who belongs to exactly one unit, inside exactly one division.

```
Superuser
   └── Division (District)
          └── Unit (Location / venue-adjacent posting)
                 └── Agent (human, identified by mobile number)
```

**Superuser** — Full system access. Real-time analytics, audit logs, ticket
revocation, division/unit/agent CRUD, system-wide kill switches. Single account
tier; no delegated admin yet.

**Division (District)** — A geographical grouping. Owns many units. Read access to
its own subtree's analytics and ticket ledger. Cannot see other divisions.

**Unit** — A specific physical location within a division (e.g. `5 BUILDING`,
sector `BATHA`). Units are the *login boundary* for agents — the first
authentication factor is the unit itself, not the person.

**Agent** — The human issuing tickets. Assigned to one unit. Identified by mobile
number. Cannot access analytics, cannot edit or revoke issued tickets, and can
only see registrations made from their own unit.

> **Rule:** authorization is always evaluated bottom-up from the token's
> `unitId` → `divisionId`. Never trust a client-supplied division or unit id on a
> write path.

---

## 3. Authentication Flow

Two distinct login surfaces.

### 3.1 Superuser login (single step)

Standard credential login → JWT with `role: 'SUPERUSER'`. No unit scoping.

### 3.2 Agent login (TWO STEPS — non-negotiable)

Agents share devices at gates and registration desks, so the *location* is
authenticated before the *person*. Both steps must pass before any ticket can be
issued.

**Step 1 — Unit Location Authentication**
Route: `/(agent)/login/unit`
The agent selects/enters the unit and authenticates the location with the unit
credential. On success the server issues a short-lived **unit session token**
(scoped, cannot issue tickets on its own).

**Step 2 — Individual Agent Authentication**
Route: `/(agent)/login/agent`
The agent authenticates with their **mobile number** (+ OTP/PIN per deployment
config). The server validates that this agent is actually assigned to the unit
from Step 1, then upgrades the session to a full **agent JWT** carrying
`{ agentId, unitId, divisionId, role: 'AGENT' }`.

**Invariants:**

- Step 2 is impossible without a valid Step 1 token. Never expose an endpoint
  that accepts a mobile number and returns a full agent JWT directly.
- An agent whose `unitId` does not match the Step 1 token is rejected, even if
  their credentials are otherwise valid.
- The unit session survives agent logout. Shift changes re-run Step 2 only —
  this is intentional and the whole point of the split.
- JWTs live in **httpOnly cookies**, set via the Next.js `app/api/` BFF layer.
  Never `localStorage` — these are shared phones.

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

> **The Normal pass displays a LOCATION INFO panel, but is still issued with
> one QR code.** That panel encodes `VENUE_INFO_URL` — a fixed venue link,
> identical on every Normal ticket, carrying no admission value. The gate
> returns `UNKNOWN_CODE` for it. `qrCodePlanFor()` is unchanged, so the
> backend fan-out and the scanner are untouched. If the intent was for Normal
> tickets to receive a real per-ticket location code, that is a change to
> `qrCodePlanFor()` and the §4.1 table, not to the component.

### 4.2 Children below 12

Free. **Excluded from ticket capacity** — they do not consume a guest QR and do
not increment `countedPersons`. Recorded on the registration for catering and
crowd-safety headcount only.

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

Request and ticket numbers are **crypto-random hex, not sequential** —
`REQ-2026-A3F19C0B7E42`, `TKT-9C4E1A7B02`. A sequential number leaks total sales
volume to anyone holding one ticket and lets an attacker enumerate the range.
Collisions are absorbed by the unique constraint plus a bounded retry of the
whole transaction; never SELECT-then-INSERT, which races.

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

These five values are the brand. Do not introduce a navy or gold shade that is
not on this list.

| Token       | Hex       | Use                                                          |
| ----------- | --------- | ------------------------------------------------------------ |
| Navy Blue   | `#062B59` | Primary. Ticket surface, headers, QR panel borders, QR fill   |
| Navy Dark   | `#031F43` | Shadows, footer, buttons, QR caption block, date box          |
| Gold        | `#D4AF37` | Accents, borders, icons, diamonds, hex badge                  |
| Light Gold  | `#F7E7B5` | Highlights, light accents, badge inner hairline               |
| Light Grey  | `#E6E6E6` | Dividers, subtle lines                                        |

Available as `brand-navy`, `brand-navy-dark`, `brand-gold`, `brand-gold-light`,
`brand-grey` in Tailwind, and as `--brand-*` custom properties in `globals.css`.

Rules:

- **Navy `#062B59` is the single action colour**, everywhere. Primary buttons,
  focus rings, required-field markers, links, active borders. There is no
  second action colour.
- **Button hover/press is Navy Dark `#031F43`.** Never a lightened navy.
- **Gold only appears on navy surfaces.** At 10–11px on white it measures
  roughly 2:1 contrast and is unreadable. On navy it is the brand's own
  pairing and fully legible. Use it for eyebrow text, hairline rules, badges,
  diamonds, and icon accents *over navy* — never as text or an action on a
  white or grey surface.
- **Light Gold `#F7E7B5`** is for inner detail on navy (badge hairlines,
  secondary ornament), not for fills.
- Brand colours are **accents in the app shell**, and **the entire surface on
  the ticket**. Do not navy-wash the dashboard.
- Inside the ticket, apply brand colours via inline `style` with the `NAVY` /
  `NAVY_DARK` / `GOLD` / `GOLD_LIGHT` / `GREY_LIGHT` constants — not Tailwind
  arbitrary classes. Reason: gold is used at multiple alphas (`33`, `55`, full),
  and inline styles survive print/PDF/email rendering far more reliably than
  generated utility classes.
- **Semantic colours are exempt and universal.** Emerald = admitted/success,
  amber = duplicate/pending, red = invalid/error. These are never re-themed to
  brand colours — a gate agent reads them pre-linguistically.
- The dashboard chart palette is a **separate, validated set** in
  `components/charts/chartTheme.ts`. Brand navy and navy-dark fail a
  categorical palette audit on a white surface; do not substitute them there.

> **There is no maroon in this system.** `#800000` was retired from both the
> ticket and the app shell. If it reappears in a diff, it is a regression.

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
focus:border-[#062B59]/40 focus:ring-4 focus:ring-[#062B59]/10
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

Tickets are printed and saved as PDF constantly. Every ticket-bearing screen must:

- Mark all app chrome `print:hidden` (search bars, action bars, nav, toasts).
- Neutralize mobile layout hacks for print: `print:min-w-0`,
  `print:overflow-visible`, `print:shadow-none`.
- `globals.css` must carry `-webkit-print-color-adjust: exact;` and
  `print-color-adjust: exact;` — without it browsers strip the navy ticket fill
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
- `backend/src/modules/auth/` — two-step agent login + superuser login.
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
- `frontend/src/app/` — `/login`, `/dashboard`, `/ticketing`, `/scanner`.

**Not yet built:** divisions/units/agents CRUD, ticket revocation, real QR
encoding, `gate:offline` heartbeat.

---

## 11. Frontend Route Protection

Two layers, neither of which protects data.

**`middleware.ts`** decodes the cookie payload **without verifying the
signature** — the signing secret lives on the API, not the web tier. It is
navigation UX: it keeps an agent out of `/dashboard` and sends a `UNIT_PENDING`
session straight to step 2. A forged cookie reaches an empty shell.

**`ProtectedRoute`** waits for `GET /api/auth/session`, which the API validated
properly, and redirects on mismatch. It also covers client-side navigations.

**The real boundary is `requireAgent` / `requireSuperuser` on every endpoint.**
Do not add a check to the frontend and consider a route secured.

Route groups (`(admin)`, `(agent)`) produce **no URL segment**. The live paths
are `/dashboard`, `/ticketing`, `/scanner`, and `middleware.ts` matches those
literal paths — adding a page means adding it to `ROUTE_ROLES` *and* `matcher`.

Sharing `JWT_SECRET` with Next to verify in middleware was rejected: it would
let the web tier mint tokens, which is a worse trade than an empty shell.

**Known debt:**

1. `npm audit` flags transitive dev/build dependencies (html2canvas, jspdf).
   None are on a request path; clear before production.
2. `VENUE_INFO_URL` is a placeholder Google Maps query. Replace with the real
   venue link before any ticket is printed (§4.1).
3. The ticket has no true perforation notches — deliberately omitted, since
   background-colored cutout circles break in print and email.
4. Socket rooms are a single `superusers` room. Division-scoped rooms (§10.5)
   land with division admins. No `gate:offline` heartbeat yet — "active gate"
   is inferred from recent scan activity.
5. App icons are placeholders — `frontend/public/icons/` holds only a README.
   Install prompts will not appear until real PNGs are dropped in.
6. `request_number_seq` / `ticket_number_seq` in the baseline schema are now
   unused — numbers are crypto-random, not sequential (§4.4). Drop in a later
   migration.
7. The seed creates no tickets, so there is nothing to scan yet.

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

Seeded fixtures: division `RIYADH`; units `5BUILDING` and `DEERA` (PIN `1234`);
agents `8888999955` / `8888999956` on 5BUILDING and `8888999957` on DEERA
(password `agent1234`); superuser `superadmin` / `SuperAdmin@2026`.
The seed is idempotent and refuses to run in production without
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
