# TESTING.md — Manual E2E Checklist

First execution of the system. Nothing in this repository has been run before,
so treat every step as a genuine assertion, not a formality.

Work top to bottom — later sections depend on data created by earlier ones.

---

## 0. Read this before you start

### 0.1 QR codes are real ✅

`MockQr` is gone. `TicketReceipt` now renders `qrcode.react` at error-correction
level **Q** with a 2-module quiet zone, encoding the raw UUID payload from the
issuance response. **Scan the ticket directly off the screen with your phone.**

Section 4 no longer needs a workaround. If you still want codes on a second
device, `qrencode -s 10 -o /tmp/g1.png "<payload>"` works.

### 0.1b Already verified

Run before handing this over — do not re-test:

- `npm install` across all three workspaces
- `tsc --noEmit` on backend **and** frontend — both clean
- `next build` — 6 routes + middleware compile
- API boots on :4000, warns correctly on an unreachable DB, drains on SIGTERM

`backend/.env` already exists with a generated `JWT_SECRET` and
`COOKIE_SAMESITE=none`. Skip §1.3.

### 0.2 Cookie policy

`COOKIE_SAMESITE=none` is required for local dev. Web (`:3000`) and API
(`:4000`) are different origins; a `Lax` cookie set by a cross-site response is
never sent back, so login "succeeds" and every request after it is anonymous.
Production uses `lax` behind a single domain.

### 0.3 What is NOT covered

No automated tests exist. This checklist is the entire test suite. Sections
marked **⚠** are the ones most likely to fail first.

---

## 1. Boot sequence

### 1.1 Database

```bash
cd "/run/media/fedgen/New Volume/pravasi-sangama"
docker compose up -d postgres
docker compose ps          # wait for postgres to read "healthy"
```

- [ ] `postgres` reports **healthy** (not just "running")

<details>
<summary>No Docker? Use a local PostgreSQL 13+</summary>

```bash
sudo -u postgres createuser pravasi --pwprompt      # password: pravasi
sudo -u postgres createdb pravasi_sangama -O pravasi
```
PostgreSQL **13 or newer** is required — `gen_random_uuid()` must be built in,
and migration `002` uses `ALTER TYPE … ADD VALUE` inside a transaction.
</details>

### 1.2 Install and build

```bash
npm install                 # workspaces; @pravasi/shared builds via prepare
npm run build:shared        # explicit — run again after any shared/ edit
```

- [ ] `npm install` completes with no peer-dependency errors
- [ ] `packages/shared/dist/index.js` exists

> `@pravasi/shared` is consumed as **compiled** output. Any change under
> `packages/shared/src` requires `npm run build:shared` before it is visible to
> either tier. This will catch you at least once.

### 1.3 Environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```ini
JWT_SECRET=<paste output of: openssl rand -base64 48>
COOKIE_SAMESITE=none
```

- [ ] `JWT_SECRET` is ≥ 32 characters (the server refuses to boot otherwise)

```bash
cat > frontend/.env.local <<'EOF'
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
EOF
```

### 1.4 Schema and seed

```bash
npm run db:migrate
npm run db:seed
```

- [ ] Migrate logs `applied 000_baseline`, `001_…`, `002_…`
- [ ] Re-running `npm run db:migrate` logs `skip` for all three (idempotent)
- [ ] Seed prints the credentials block

Expected fixtures:

| Role | Credential |
|---|---|
| Superuser | `superadmin` / `SuperAdmin@2026` |
| Unit | `5BUILDING` PIN `1234` · `DEERA` PIN `1234` |
| Agent (5BUILDING) | `8888999955` / `agent1234` · `8888999956` |
| Agent (DEERA) | `8888999957` / `agent1234` |

### 1.4b ⚠ If you see `Cannot find module './912.js'`

Or any missing-chunk error out of `.next/server/`. **This is not a stale cache
you can simply delete** — it means a `next dev` / `next start` was left running
while `next build` rewrote `.next` underneath it. The live server keeps serving
a manifest that points at chunks which no longer exist.

Compounding it: this repository lives on an **NTFS-3G (fuseblk) mount**. FUSE
cannot unlink a file another process holds open, so it renames it to
`.fuse_hidden<inode>` — and `rm -rf .next` then fails with
*"Directory not empty"*, regenerating a new `.fuse_hidden` on every attempt.

**Kill the server first, then clear:**

```bash
pkill -f next-server ; pkill -f "next dev"     # both, in case either is up
cd "/run/media/fedgen/New Volume/pravasi-sangama"
rm -rf frontend/.next frontend/node_modules/.cache
npm run build:shared
npm run dev:web
```

If `rm -rf` still reports "Directory not empty", something still holds a
handle. Find it precisely rather than guessing:

```bash
for p in $(ls /proc | grep -E '^[0-9]+$'); do
  ls -l /proc/$p/fd 2>/dev/null | grep -q '\.next' && \
    echo "$p → $(tr '\0' ' ' < /proc/$p/cmdline | cut -c1-70)"
done
```

**Never run `dev:web` and `build` against the same `.next` at once.** On this
filesystem that reliably corrupts the chunk manifest.

### 1.5 Run both tiers

Two terminals:

```bash
npm run dev:api      # :4000
npm run dev:web      # :3000
```

- [ ] API logs `listening on :4000`
- [ ] `curl -s localhost:4000/api/health` → `{"status":"ok","db":"up"}`
- [ ] `http://localhost:3000` redirects to `/login`

---

## 2. Auth & Roles

### 2.1 Agent two-step — success path

Go to `http://localhost:3000/login`, **Agent** tab.

- [ ] Step 1 shows Unit Code + Unit PIN, **not** a mobile field
- [ ] `5BUILDING` / `1234` → advances to Step 2
- [ ] Step 2 subtitle reads "Unit authenticated · 5 Building"
- [ ] `8888999955` / `agent1234` → lands on `/ticketing`
- [ ] The agent context card shows **Rajesh Nair**, **BATHA**, **5 Building**

**⚠ If Step 2 bounces back to Step 1**, the cookie is not persisting — check
`COOKIE_SAMESITE=none` and that DevTools → Application → Cookies shows
`ps_session` on `localhost:4000`.

### 2.2 Step 2 cannot be reached alone

```bash
curl -i -X POST localhost:4000/api/auth/agent-login \
  -H 'Content-Type: application/json' \
  -d '{"mobile_number":"8888999955","password":"agent1234"}'
```

- [ ] **401** — never a token. This is the §3.2 invariant; if it returns a
      session, stop and report it.

### 2.3 ⚠ AGENT_UNIT_MISMATCH

The important negative test: correct credentials, wrong unit.

```bash
rm -f /tmp/jar.txt

# Step 1 as 5BUILDING
curl -s -c /tmp/jar.txt -X POST localhost:4000/api/auth/unit-login \
  -H 'Content-Type: application/json' \
  -d '{"unit_code":"5BUILDING","pin":"1234"}' | head -c 200

# Step 2 as the DEERA agent — valid password, wrong unit
curl -i -b /tmp/jar.txt -X POST localhost:4000/api/auth/agent-login \
  -H 'Content-Type: application/json' \
  -d '{"mobile_number":"8888999957","password":"agent1234"}'
```

- [ ] **403** with `"code":"FORBIDDEN"`, message "You are not assigned to this unit"
- [ ] Audit row exists:
      ```sql
      SELECT action, metadata FROM audit_logs
       WHERE action = 'AGENT_UNIT_MISMATCH' ORDER BY created_at DESC LIMIT 1;
      ```
- [ ] Bad password on the *right* unit returns **401**, not 403
      (distinct codes: 401 = typo, 403 = misassignment)

### 2.4 Superuser

- [ ] `/login` → **Superuser** tab → `superadmin` / `SuperAdmin@2026` → `/dashboard`
- [ ] Visiting `/ticketing` as superuser redirects to `/login`
- [ ] Visiting `/dashboard` as an agent redirects to `/login`
- [ ] Signed out, `/dashboard` redirects to `/login?next=%2Fdashboard`

### 2.5 Shift change (§3.2)

While signed in as an agent:

```bash
curl -X POST localhost:4000/api/auth/logout -b /tmp/jar.txt
```

- [ ] Reloading `/ticketing` lands on **Step 2**, not Step 1 — the unit session
      outlives agent logout by design
- [ ] "Change unit" returns to Step 1

---

## 3. Ticketing

Signed in as an agent at `/ticketing`.

### 3.1 Normal — 1 QR

- [ ] Ticket Type `Normal` → **Counted Persons** auto-fills `1`, is read-only,
      and is skipped by Tab
- [ ] Helper reads "1 QR code"
- [ ] Submit → success screen showing **three sections**: a navy-dark date box
      (`15` over `Oct 2026`), a `LOCATION INFO` panel, and a `ONE FREE ENTRY`
      panel, separated by thin rules with a gold diamond at each midpoint
- [ ] Only the `ONE FREE ENTRY` code is a real ticket. Scanning `LOCATION INFO`
      on a Normal pass must return **INVALID / unknown** — it is the static
      venue link, and the DB still holds exactly **1** row:
      ```sql
      SELECT COUNT(*) FROM qr_codes q JOIN tickets t ON t.id = q.ticket_id
       WHERE t.ticket_type = 'NORMAL';   -- 1 per Normal ticket
      ```
- [ ] Ticket number matches `TKT-[0-9A-F]{10}` (random, **not** sequential)

### 3.2 SVIP — 5 QR

- [ ] `SVIP` → Counted Persons flips to `4`; helper reads "5 QR codes"
- [ ] Submit → **5** panels: `GUEST 1`–`GUEST 4` + `LOCATION`, separated by
      small gold diamonds
- [ ] Gold **hexagonal badge** at the top reads `SVIP TICKET`
- [ ] Each panel is white with a navy `#062B59` border and a solid `#031F43`
      block beneath the code reading "SCAN FOR ADMISSION" / "SCAN FOR LOCATION"

### 3.3 Server is the authority (§4.3)

```bash
curl -i -b /tmp/jar.txt -X POST localhost:4000/api/tickets/issue \
  -H 'Content-Type: application/json' \
  -d '{"purchaser_name":"Attack Test","mobile_number":"9999999999",
       "ticket_type":"NORMAL","children_below_12":0,"counted_persons":4}'
```

- [ ] **400 VALIDATION_ERROR** — `.strict()` rejects the unknown key outright
- [ ] Database confirms no Normal ticket ever stored capacity 4:
      ```sql
      SELECT COUNT(*) FROM tickets
       WHERE ticket_type = 'NORMAL' AND counted_persons <> 1;   -- must be 0
      ```

### 3.4 QR secrecy (§4.4)

```sql
SELECT qr_hash, code_kind, guest_index FROM qr_codes LIMIT 5;
```

- [ ] `qr_hash` is 64 hex chars — a SHA-256, **never** a readable UUID
- [ ] No column anywhere holds the raw payload

### 3.5 Share modal

- [ ] **Share Ticket** opens a bottom sheet on mobile / centred modal on desktop
- [ ] Glassmorphic backdrop; Escape closes; background does not scroll
- [ ] **Save as PDF** downloads a PDF whose page is cropped to the ticket
      (no A4 white margin)
- [ ] **Save as Image** downloads `PRAVASI-SANGAMA-2026-TKT-….png`
- [ ] **Send Email** expands inline; sending shows a spinner then green **Sent!**
- [ ] API log shows the simulated send:
      ```
      [mail] SMTP not configured — simulated send
      ```
- [ ] Audit row:
      ```sql
      SELECT metadata FROM audit_logs WHERE action = 'TICKET_EMAILED';
      ```
- [ ] **Done** closes the modal and returns to an empty form

**⚠ Watch for 413** on email — if it appears, the `app.ts` body-limit skip is
not matching `/api/tickets/share/email`.

### 3.6 Capture the payloads (needed for section 4)

Keep the issuance response. Re-fetching is impossible by design.

```bash
curl -s -b /tmp/jar.txt -X POST localhost:4000/api/tickets/issue \
  -H 'Content-Type: application/json' \
  -d '{"purchaser_name":"Scan Test","mobile_number":"9876543210",
       "ticket_type":"SVIP","children_below_12":2}' > /tmp/ticket.json

cat /tmp/ticket.json | python3 -m json.tool
```

- [ ] `qr_codes` holds 5 entries: 4 × `GUEST` (index 1–4) + 1 × `LOCATION`
- [ ] Each `payload` is a distinct UUID

```bash
# Real, scannable QR codes from those payloads
GUEST1=$(python3 -c "import json;print(json.load(open('/tmp/ticket.json'))['qr_codes'][0]['payload'])")
LOC=$(python3 -c "import json;d=json.load(open('/tmp/ticket.json'));print([c for c in d['qr_codes'] if c['kind']=='LOCATION'][0]['payload'])")

qrencode -s 10 -o /tmp/guest1.png "$GUEST1"
qrencode -s 10 -o /tmp/location.png "$LOC"
```

---

## 4. Gate Scanner — the crucible

`/scanner?gate=GATE-2` as an agent. Grant camera permission.

> Camera access requires `localhost` or HTTPS. Testing from a phone over a LAN
> IP will silently fail — use `localhost` on a laptop, or tunnel over HTTPS.

### 4.1 Admit

Point the scanner at `GUEST 1 QR` **on the issued ticket** — screen to screen,
or use `/tmp/guest1.png`.

- [ ] **Green** full-screen overlay, large check
- [ ] Reads `SVIP — 1 of 4`
- [ ] Phone vibrates once (single 40ms pulse)
- [ ] Auto-dismisses at ~2.5s with the progress bar draining
- [ ] Footer still reads "All scans synced"

### 4.2 Duplicate

Scan the **same** code again (wait out the 4s repeat-suppression window).

- [ ] **Amber** overlay, "Already Scanned"
- [ ] Shows time, admitting agent name, and `GATE-2`
- [ ] Vibration is the double pattern, not the single
- [ ] `qr_codes.scanned_at` did **not** change — the first admission stands:
      ```sql
      SELECT status, scanned_at FROM qr_codes WHERE guest_index = 1
       ORDER BY created_at DESC LIMIT 1;
      ```

### 4.3 Location pass (never consumed)

Scan `/tmp/location.png` **three times**.

- [ ] Every scan shows the **MapPin** icon, green, "Location Pass"
- [ ] "Not an admission — venue information only"
- [ ] Never turns amber — a location pass must stay scannable all evening
- [ ] Not consumed and not counted:
      ```sql
      SELECT status FROM qr_codes WHERE code_kind = 'LOCATION';   -- ISSUED
      SELECT result, COUNT(*) FROM scan_logs GROUP BY result;     -- 3 LOCATION_INFO
      ```

### 4.4 Unknown code

```bash
qrencode -s 10 -o /tmp/fake.png "00000000-0000-4000-8000-000000000000"
```

- [ ] **Red** overlay, "Invalid"
- [ ] Still logged — every attempt is recorded:
      ```sql
      SELECT result, scanned_hash FROM scan_logs WHERE result = 'UNKNOWN_CODE';
      ```

### 4.5 ⚠ Offline → queue → sync

The single most important test in this document.

1. Scan `guest2` successfully while online.
2. **Stop the API** (`Ctrl-C` on `dev:api`). Leave the scanner open.
3. Scan `guest3`.

- [ ] Overlay is **green with a WifiOff icon** and a **PENDING SYNC** pill —
      visually distinct from a confirmed admission
- [ ] The guest is admitted anyway (the gate never blocks)
- [ ] Header badge flips to **Offline** (amber)
- [ ] Footer reads **1 pending sync**
- [ ] DevTools → Application → IndexedDB → `keyval-store` → `ps.scan_queue`
      holds one row with `client_scan_id`, `payload`, `offline_scanned_at`

4. Scan `guest3` **again** while still offline.

- [ ] Amber "Already Scanned — Admitted on this device at HH:MM" — local
      dedupe caught it without a network

5. **Restart the API** (`npm run dev:api`).

- [ ] Within ~5s the badge goes **Syncing** then **Online**
- [ ] Footer returns to "All scans synced"
- [ ] `ps.scan_queue` is empty
- [ ] Both offline scans landed, and `created_at` is the **capture** time, not
      the sync time:
      ```sql
      SELECT result, created_at, client_scan_id FROM scan_logs
       WHERE client_scan_id IS NOT NULL ORDER BY created_at;
      ```

### 4.6 Idempotency

Replay a completed batch verbatim:

```bash
curl -s -b /tmp/jar.txt -X POST localhost:4000/api/scan/bulk-sync \
  -H 'Content-Type: application/json' \
  -d '{"scans":[{"client_scan_id":"<id from 4.5>","payload":"<guest3 payload>",
       "offline_scanned_at":"2026-07-30T10:00:00.000Z","gate_label":"GATE-2"}]}'
```

- [ ] Returns the **original** verdict with `"replay": true`
- [ ] `SELECT COUNT(*) FROM scan_logs WHERE client_scan_id = '<id>'` is still **1**

### 4.7 Revoked ticket

```sql
UPDATE tickets SET status = 'REVOKED', revoked_at = NOW()
 WHERE ticket_number = '<a ticket with an unscanned guest code>';
```

- [ ] Scanning its unscanned guest code → **red**, "Revoked"
- [ ] `qr_codes.status` is still `ISSUED` — the ticket join blocked it, not a
      pre-check

---

## 5. Real-time analytics

Two windows: `/dashboard` as superuser, `/scanner` as agent (use a private
window or a second browser — one cookie jar per browser profile).

### 5.1 Connection

- [ ] Dashboard header shows a pulsing green **Live** dot
- [ ] API logs `[socket] superuser <id> connected`
- [ ] Killing the API flips the pill to grey **Paused**; restarting recovers it

**⚠ If it never connects**, the handshake cookie is not attaching — the same
`COOKIE_SAMESITE` cause as §2.1.

### 5.2 Live feed

- [ ] A successful scan appears in **Live Gate Feed** within ~1s (1s coalescing
      tick), newest first
- [ ] Row shows time, agent name, `GATE-2` chip, unit, ticket number, green
      **Admitted** pill

### 5.3 Toasts

- [ ] A duplicate scan pops an **amber** toast bottom-right within ~1s
- [ ] Auto-dismisses at 3s; the × dismisses early
- [ ] The same event also appears once in the feed — **not twice**
- [ ] An invalid scan pops a **red** toast

### 5.4 Post-sync duplicate (§10.4)

Force the offline double-admit:

1. Scan `guest4` online.
2. Stop the API. Scan `guest4` again → admits locally as PENDING SYNC.
3. Restart the API with the dashboard open.

- [ ] Toast is **red** and reads "Post-sync duplicate — entry already occurred",
      louder than a live duplicate. That guest is already inside; this is the
      documented, accepted limitation surfacing correctly.

### 5.5 Counters

- [ ] **Scanned Today** increments within 5s of an admission
- [ ] **Active Gates** ≥ 1 while scanning; drops after 5 minutes idle
- [ ] **Total Guests Expected** counts GUEST codes only — issuing one SVIP
      raises it by **4**, not 5
- [ ] Division bar chart and tier donut both populate
- [ ] Backgrounding the dashboard tab stops the poll; returning refreshes at once

---

## 6. PWA

Requires a production build — the worker is inert in dev by design.

```bash
npm run build -w @pravasi/frontend && npm run start -w @pravasi/frontend
```

- [ ] `navigator.serviceWorker.controller` is non-null in the console
- [ ] Application → Service Workers shows `sw.js` activated
- [ ] `[sw] precache miss: /icons/icon-192.png` **is expected** — icons are
      still placeholders
- [ ] DevTools → Network → Offline, then reload → styled offline page, not the
      browser's dinosaur
- [ ] `/api/*` requests never appear as "(from ServiceWorker)"
- [ ] In `npm run dev`, the console logs the worker being unregistered

---

## 7. Result

| Section | Pass | Notes |
|---|---|---|
| 1. Boot | ☐ | |
| 2. Auth & roles | ☐ | |
| 3. Ticketing | ☐ | |
| 4. Gate scanner | ☐ | |
| 5. Real-time | ☐ | |
| 6. PWA | ☐ | |

### Reset to a clean state

```bash
docker compose down -v && docker compose up -d postgres
npm run db:migrate && npm run db:seed
```

### Known, accepted, not bugs

- Gold ribbon's angled notch renders square in the shared image —
  `html2canvas` does not implement `clip-path`.
- Ticket does not reflow on mobile; it scrolls horizontally, deliberately.
- App icons are placeholders; install prompts will not appear.
- Two devices offline simultaneously can both admit one guest code (§10.4).
- `npm audit` reports vulnerabilities, all in transitive dev/build dependencies
  (`html2canvas`, `jspdf`, `xlsx` chains). None sit on a request path. Worth a
  pass before production, not before this test run.
