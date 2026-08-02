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
sector `BATHA`). A unit is the *scope* every agent token carries, and every
ticket is written against it. It is no longer an authentication factor: units
stopped being a login step in §3.2.

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

### 3.2 Agent login (SINGLE STEP — was two, changed deliberately)

> **This section previously specified a mandatory two-step flow and called it
> non-negotiable. It was overridden by an explicit operational decision by the
> project owner. Do not "restore" the old behaviour as a bug fix.**
>
> The event is run by unpaid volunteers. There was no manpower to distribute
> unit codes and PINs on the day, so location authentication was not a
> security control in practice — it was a barrier that would have stopped
> agents issuing tickets at all.

Route: `/login`. The agent enters **mobile number (or email) + password**.
On success the server issues the full **agent JWT** carrying
`{ agentId, unitId, divisionId, sessionId, role: 'AGENT' }`.

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
reads it. Reinstating location authentication means writing the endpoint
again, not flipping a flag — which is the honest state of affairs, not an
oversight.

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
- `backend/src/modules/auth/` — single-step agent login (§3.2), gate and
  superuser login.
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
- `frontend/src/app/` — `/login`, `/dashboard`, `/ticketing`, `/scanner`,
  `/agent/dashboard` (agent ledger), `/admin/approvals`, `/admin/directory`,
  `/admin/tickets` (master ledger), `/admin/gates`.
- `backend/src/modules/admin/` — approvals, gates, agent directory, and the
  master ticket ledger (`GET /api/admin/tickets` + `/filter-options`).
  Ledger totals are a SQL aggregate over the whole filtered set, deliberately
  not a sum of the returned rows — the row list is capped and would
  under-report. Both queries share one parameterised WHERE builder so the
  summary cards can never describe a different set than the table.

**Not yet built:** divisions/units/agents CRUD, ticket revocation, real QR
encoding, `gate:offline` heartbeat.

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
are `/dashboard`, `/ticketing`, `/scanner`, and `middleware.ts` matches those
literal paths — adding a page means adding it to `ROUTE_ROLES` *and* `matcher`.

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
