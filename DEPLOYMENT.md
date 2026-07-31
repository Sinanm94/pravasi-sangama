# DEPLOYMENT.md

Production deployment: **Supabase** (Postgres), **Render** (Express + socket.io),
**Vercel** (Next.js).

Read §0 before creating anything. One decision there determines whether
authentication works at all, and it is far cheaper to make now than to retrofit.

---

## 0. The decision that dominates everything: cookie domains

The session JWT lives in an **httpOnly cookie** (§3.2). The browser only sends
that cookie back if the cookie policy matches how your two origins relate. Get
this wrong and login "succeeds" while every request after it is anonymous.

### Option A — custom domain (strongly recommended)

```
app.pravasisangama.org   → Vercel
api.pravasisangama.org   → Render
```

Both share the registrable domain `pravasisangama.org`, so requests between
them are **same-site**. Set `COOKIE_SAMESITE=lax` **and
`COOKIE_DOMAIN=.pravasisangama.org`**.

`COOKIE_DOMAIN` is not optional on this option, and it is the one people miss.
Without it the API sets a **host-only** cookie bound to `api.`; `middleware.ts`
runs on `app.` and cannot read it, so login returns 200 and the very next
navigation 307s straight back to `/login`. Same-site is about whether the
browser *sends* the cookie; `Domain` is about which hosts it is *scoped* to.
You need both.

- Safari and Brave ship with third-party cookie blocking on by default. A Lax
  same-site cookie is unaffected. `SameSite=None` on a genuinely cross-site
  pair **is** affected, and iPhone is the primary device at this event.
- This is the difference between "works on my Android" and "works at a gate."

### Option B — default platform domains

```
pravasi.vercel.app  →  pravasi-api.onrender.com
```

`vercel.app` and `onrender.com` are both on the Public Suffix List, so these
are **different sites**. You must set `COOKIE_SAMESITE=none`, which forces
`Secure` (both are HTTPS, so that is fine).

**Acceptable for staging. Do not run the event on it.** Safari's ITP may drop
the cookie, and there is no configuration that fixes it from your side.

> Take five minutes and point a domain at both services. Everything below
> assumes Option A and notes the Option B delta where it matters.

---

## 1. Supabase — database

### 1.1 Create the project

1. New project → choose the region **closest to the venue**, not to you. Every
   gate scan is a round trip; §10.1 budgets the whole interaction at 300ms.
2. Save the database password. Supabase shows it once.

### 1.2 Pick the right connection string

Supabase offers three. They are not interchangeable here.

| Use | Which | Why |
|---|---|---|
| **Migrations** (from your laptop) | **Direct** `db.<ref>.supabase.co:5432` | DDL runs inside transactions; the migration runner wraps each file in one |
| **Render runtime** | **Session pooler** `aws-0-<region>.pooler.supabase.com:5432` | IPv4. Render has no guaranteed IPv6 egress, and direct connections are IPv6-only on newer projects |
| Not used | Transaction pooler `:6543` | Does not hold a session across statements; our `withTransaction` needs one |

If the app cannot reach the database from Render but migrations worked from
your laptop, you are on the direct string. Switch to the session pooler.

### 1.3 Run the migrations from your machine

`db:migrate` boots the same env validator as the server, so it needs the full
required set — not just `DATABASE_URL`. `JWT_SECRET` is never used by the
migration; a throwaway value is fine.

```bash
cd ~/pravasi-sangama

DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.YOUR_REF.supabase.co:5432/postgres" \
PGSSL=true \
JWT_SECRET="migration-only-placeholder-value-at-least-32-chars" \
npm run db:migrate
```

Expected:

```
[migrate] applied 000_baseline
[migrate] applied 001_scan_logs_client_scan_id
[migrate] applied 002_scan_result_location_info
[migrate] done
```

Re-run it. Every line must read `skip` — that proves the ledger works and a
redeploy cannot re-apply DDL.

<details>
<summary>If <code>CREATE EXTENSION pgcrypto</code> errors</summary>

Supabase pre-installs pgcrypto in the `extensions` schema, so the statement is
normally a no-op. If permissions bite, run this once in the SQL editor and
re-run the migration:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
```
</details>

### 1.4 ⚠ Do NOT run `db:seed` against production

The seeder creates `superadmin` / `SuperAdmin@2026` and unit PIN `1234`. Those
credentials are in this repository. Running it in production hands anyone with
the repo a superuser account and a working gate login.

It refuses to run when `NODE_ENV=production`, but nothing stops you running it
locally *pointed at* the production URL. Don't.

**Create the real superuser instead**, generating the hash locally so the
password never leaves your machine:

```bash
cd ~/pravasi-sangama/backend
node -e "
  const b = require('bcrypt');
  b.hash(process.argv[1], 12).then(h => console.log(h));
" 'YOUR-REAL-STRONG-PASSWORD'
```

Paste the hash into the Supabase SQL editor:

```sql
INSERT INTO superusers (username, password_hash, name)
VALUES ('admin', '<paste-the-$2b$12$-hash>', 'Event Administrator');
```

Then create real divisions, units and agents the same way — units need
`access_code_hash`, agents need `pin_hash`, both bcrypt at cost 12.

---

## 2. Render — backend (Express + socket.io)

### 2.1 Service settings

New → **Web Service** → connect the repo.

| Field | Value |
|---|---|
| **Root Directory** | *(leave blank — repository root)* |
| **Runtime** | Node |
| **Build Command** | `npm ci && npm run build:shared && npm run build -w @pravasi/backend` |
| **Start Command** | `npm run start -w @pravasi/backend` |
| **Health Check Path** | `/api/health` |
| **Instance Type** | **Starter or higher — not Free** (see §2.4) |

**Root Directory must stay at the repository root.** This is an npm workspaces
monorepo: `package-lock.json` and the workspace links live at the root. Setting
it to `backend/` gives you a bare `backend/package.json` with a `"@pravasi/shared": "*"`
dependency that resolves against the public npm registry and fails.

`build:shared` runs before the backend build because `@pravasi/shared` is
consumed as **compiled** output — `packages/shared/dist`, not its source.

> The backend build also copies `schema.sql` and `migrations/*.sql` into
> `dist/` (`build:sql`). `tsc` only emits JavaScript, so without that step
> `dist/db/migrate.js` throws ENOENT. You will not hit this if you only ever
> migrate from your laptop, but the deployed image is now self-sufficient:
> `npm run db:migrate:prod -w @pravasi/backend` works on the box.

### 2.2 Environment variables

| Key | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DATABASE_URL` | Supabase **session pooler** URI | §1.2 |
| `PGSSL` | `true` | Supabase requires TLS |
| `JWT_SECRET` | `openssl rand -base64 48` | ≥32 chars or the server refuses to boot |
| `JWT_ISSUER` | `pravasi-sangama-2026` | |
| `CORS_ORIGIN` | `https://app.pravasisangama.org` | Exact origin, scheme included, **no trailing slash** |
| `COOKIE_SAMESITE` | `lax` (Option A) / `none` (Option B) | §0 |
| `COOKIE_DOMAIN` | `.pravasisangama.org` (Option A) / **unset** (Option B) | §0. Required when `app.` and `api.` are separate subdomains — omit it and login 200s, then bounces to `/login`. Leave unset on Option B: `vercel.app` and `onrender.com` share no parent you control |
| `EVENT_TIMEZONE` | `Asia/Riyadh` | Drives "today" in analytics |
| `UNIT_SESSION_TTL_MINUTES` | `720` | Survives a full shift |
| `AGENT_TOKEN_TTL_MINUTES` | `480` | |
| `SUPERUSER_TOKEN_TTL_MINUTES` | `120` | |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | your provider | Optional — but see below |
| `MAIL_FROM` | `"Pravasi Sangama 2026 <tickets@yourdomain>"` | |

**Do not set `PORT`.** Render injects it; the env schema reads it.

**If SMTP is unset, production returns `503 EMAIL_NOT_CONFIGURED`** on the
email-share action rather than silently discarding a ticket someone is waiting
for. That is deliberate — but it means the button is broken until you configure
it. Decide before the event.

### 2.3 CORS and previews

`CORS_ORIGIN` accepts a comma-separated list:

```
https://app.pravasisangama.org,https://pravasi.vercel.app
```

Vercel gives every preview deployment a **unique** hostname, so previews will
fail CORS against production. That is correct behaviour — point previews at a
separate staging Render service instead of widening production's allowlist.

### 2.4 WebSockets

socket.io works on Render with no extra configuration — the `/live` namespace
shares the HTTP server and therefore the port and TLS termination.

**Free instances spin down after ~15 minutes idle.** Every dashboard socket
drops, and the next request pays a 30–60s cold start. During an event that
reads as "the system is down." Use Starter or above.

`app.set('trust proxy', 1)` is already configured, which is what makes `req.ip`
(audit logs, rate limiting) reflect the real client rather than Render's proxy.

---

## 3. Vercel — frontend (Next.js)

### 3.1 Project settings

New Project → import the repo.

| Field | Value |
|---|---|
| **Root Directory** | `frontend` |
| **Include source files outside the Root Directory** | **ON** — required |
| **Framework Preset** | Next.js |
| **Install Command** | *(default)* |
| **Build Command** | `cd .. && npm run build:shared && cd frontend && next build` |
| **Output Directory** | *(default)* |
| **Node.js Version** | 20.x or 22.x |

The "include files outside root" toggle is what lets Vercel see the root
`package-lock.json` and `packages/shared`. With it off, the build fails
resolving `@pravasi/shared`.

The explicit `build:shared` in the build command is belt-and-braces: the
package's `prepare` script builds it during install, but a cached install can
skip that and `next build` then compiles against a stale `dist`.

### 3.2 Environment variables

Set for **Production**, **Preview**, and **Development**:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.pravasisangama.org/api` |
| `NEXT_PUBLIC_SOCKET_URL` | `https://api.pravasisangama.org` |

Two things that cost an hour if missed:

- `NEXT_PUBLIC_API_URL` **includes** `/api`; `NEXT_PUBLIC_SOCKET_URL` **does
  not** — socket.io appends its own `/socket.io` path and the namespace.
- `NEXT_PUBLIC_*` values are **inlined at build time**. Changing one requires a
  redeploy, not a restart.

### 3.3 Service worker headers

`frontend/vercel.json` (already in the repo) marks `/sw.js` and
`/manifest.json` `no-cache`, and `/_next/static/*` immutable.

Without the first rule a CDN-cached service worker keeps serving an old shell
after every deploy, and it can persist for a *very* long time — the worker's
job is to survive network loss, which also makes it excellent at surviving your
fixes. The static rule is safe because that output is content-hashed.

---

## 4. Deploy order

The two services reference each other, so first deploy needs one pass:

1. **Supabase** — project, migrations (§1.3), real superuser (§1.4).
2. **Render** — deploy with a placeholder `CORS_ORIGIN`. Note the URL.
3. **Vercel** — deploy with the Render URL in both `NEXT_PUBLIC_*`. Note the URL.
4. **Render** — set the real `CORS_ORIGIN`, save (triggers redeploy).
5. Custom domains on both, then update `CORS_ORIGIN` and both `NEXT_PUBLIC_*`
   to the final hostnames and redeploy each once more.

---

## 5. Smoke test — in this order

Each step depends on the one above. Stop at the first failure; the cause is
almost always in that step, not later.

```bash
API=https://api.pravasisangama.org

# 1. Service and database
curl -s $API/api/health
# {"status":"ok","db":"up",...}   "db":"down" → DATABASE_URL / PGSSL / pooler
```

- [ ] **2. CORS.** Load the Vercel app, open DevTools → Network. No CORS errors
      on `/api/auth/session`. If blocked: `CORS_ORIGIN` mismatch — check scheme
      and trailing slash.
- [ ] **3. The cookie.** Sign in as superuser. Application → Cookies →
      `ps_session` present, `HttpOnly` ✓, `Secure` ✓, `SameSite` matching §0.
      **If it is set but not resent on the next request, that is the §0
      failure.**
- [ ] **4. Session survives reload.** Refresh `/dashboard`. Staying signed in
      proves the cookie is actually round-tripping.
- [ ] **5. Socket.** Dashboard shows a pulsing green **Live**. Grey/"Paused"
      means the handshake was rejected — same cookie cause as step 3.
- [ ] **6. Two-step agent login**, both steps, on a real phone.
- [ ] **7. Issue a ticket.** QR renders; ticket number matches `TKT-[0-9A-F]{10}`.
- [ ] **8. Scan it.** Green ADMITTED. Scan again → amber DUPLICATE.
- [ ] **9. Airplane mode, scan.** Amber **PENDING SYNC**. Restore network →
      queue drains within ~5s.
- [ ] **10. Install the PWA** from the phone browser menu.

Then run the full [TESTING.md](TESTING.md) against production.

---

## 6. Before event day

- [ ] **Real app icons** in `frontend/public/icons/` — install prompts do not
      appear without them (192, 512, maskable-512).
- [ ] **`VENUE_INFO_URL`** in `packages/shared/src/constants.ts` replaced with
      the real venue map link. It is currently a placeholder and it is printed
      on every Normal ticket.
- [ ] **Render instance sized above Free**, and confirm it does not sleep.
- [ ] **Supabase backups** enabled; know how to restore.
- [ ] **SMTP verified** by sending one real ticket, or accept that the email
      button will 503.
- [ ] **Dev seed credentials absent from production.**
      ```sql
      SELECT username FROM superusers WHERE username = 'superadmin';  -- 0 rows
      SELECT unit_code FROM units WHERE unit_code IN ('5BUILDING','DEERA'); -- 0 rows
      ```
- [ ] **Load check.** Issue ~200 tickets and scan a few hundred codes against
      production before the day. Gate p99 should stay under 50ms server-side.
- [ ] **`npm audit`** cleared — currently transitive dev/build only, none on a
      request path, but review before going live.

---

## 7. Rollback

**Frontend** — Vercel → Deployments → previous → *Promote to Production*.
Instant; no build.

**Backend** — Render → Events → previous deploy → *Rollback*.

**Database** — migrations are **forward-only**; there are no down scripts.
`schema_migrations` records what ran. To undo, write a new numbered migration
that reverses the change. Restoring a Supabase backup discards every ticket and
scan committed since the snapshot — on event day that is almost never the right
call. Prefer fixing forward.

---

## 8. Reference

**Ports and paths**

| Thing | Value |
|---|---|
| API base | `https://api.…/api` |
| Health | `GET /api/health` |
| Socket | `https://api.…` namespace `/live` |
| Cookie | `ps_session`, httpOnly, path `/` |

**Rebuild after editing `packages/shared`** — both tiers consume `dist`:

```bash
npm run build:shared    # then redeploy both services
```

**Generate a secret**

```bash
openssl rand -base64 48
```
