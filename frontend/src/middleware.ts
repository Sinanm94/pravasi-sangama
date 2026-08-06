import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, type AuthRole } from '@pravasi/shared';

/**
 * Edge route guard.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  THIS IS NOT AN AUTHORIZATION BOUNDARY. It is navigation UX.
 * ─────────────────────────────────────────────────────────────────────
 *
 * The JWT is signed with a secret that lives on the API, not here, so this
 * decodes the payload WITHOUT verifying the signature. A forged cookie can
 * therefore reach an admin *shell* — and find it empty, because every request
 * it makes is checked by `requireSuperuser` / `requireAgent` against the real
 * signature. The data is protected; the route is merely tidy.
 *
 * Sharing JWT_SECRET with the Next server to verify here would let the web
 * tier mint tokens, which is a materially worse trade than an empty shell.
 *
 * Route groups — `(admin)`, `(agent)` — produce NO URL segment, so the paths
 * below are the real ones. Adding a page means adding it here.
 */

/**
 * Checked BEFORE ROUTE_ROLES, so a public page nested under a guarded prefix
 * stays reachable. `/scanner/login` is the case that matters: it lives under
 * `/scanner`, and without this exemption an event volunteer with no session
 * would be bounced to the agent login and could never sign in at all.
 *
 * `/management` is a login page and must be reachable with no session, for
 * the same reason. It is listed here rather than simply left out of the
 * matcher so that an already-signed-in visitor is bounced to their own home
 * instead of being shown a role chooser they have no use for.
 *
 * Note this is also exactly why the management portal is NOT at `/admin`:
 * ROUTE_ROLES guards that whole prefix with SUPERUSER, so an unauthenticated
 * visitor would be redirected to /login and could never reach the form.
 */
const PUBLIC_ROUTES = ['/scanner/login', '/management'];

const ROUTE_ROLES: Array<{ prefix: string; allow: AuthRole[] }> = [
  { prefix: '/dashboard', allow: ['SUPERUSER'] },
  // Everything under /admin creates or revokes the ability to issue tickets
  // and admit people. One prefix rule, so a new admin page is guarded by
  // default rather than by remembering to add it.
  { prefix: '/admin', allow: ['SUPERUSER'] },
  { prefix: '/ticketing', allow: ['AGENT'] },
  // The agent's own ledger. Same role as /ticketing; a separate prefix
  // because the URL is not nested under it.
  { prefix: '/agent', allow: ['AGENT'] },
  // A unit admin's own approvals screen — scoped to one unit, nothing else.
  { prefix: '/unit', allow: ['UNIT_ADMIN'] },
  // Agents scan between registrations; gate accounts do nothing else.
  { prefix: '/scanner', allow: ['AGENT', 'SCANNER'] },
];

/** Base64url payload decode. No verification — see the note above. */
function readRole(token: string | undefined): AuthRole | null {
  if (!token) return null;

  try {
    const payload = token.split('.')[1];
    if (!payload) return null;

    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { role?: AuthRole; exp?: number };

    // Cheap expiry check so a stale cookie doesn't hold a route open.
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;

    return claims.role ?? null;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const role = readRole(req.cookies.get(SESSION_COOKIE_NAME)?.value);

  /* Public routes win over every prefix rule below. A volunteer arriving at
   * the gate with no session must be able to reach /scanner/login. */
  if (PUBLIC_ROUTES.includes(pathname)) {
    // Already signed in — send them on rather than showing a login form.
    // A gate session has only one destination; everyone else gets their home.
    if (role === 'SCANNER') {
      return NextResponse.redirect(new URL('/scanner', req.url));
    }
    if (pathname === '/management' && role) {
      return NextResponse.redirect(new URL(homeFor(role), req.url));
    }
    return NextResponse.next();
  }

  /* Already signed in and sitting on /login — send them where they belong. */
  if (pathname === '/login' && role) {
    return NextResponse.redirect(new URL(homeFor(role), req.url));
  }

  /* Legacy deep links. `/login?mode=admin|unit-admin` used to open those
   * forms inline, before they moved to /management. Redirect rather than
   * drop, so a bookmark saved off a shared event phone still lands
   * somewhere useful instead of on a gateway asking for a unit PIN. */
  if (pathname === '/login') {
    const legacy = req.nextUrl.searchParams.get('mode');
    if (legacy === 'admin' || legacy === 'unit-admin') {
      const url = new URL('/management', req.url);
      url.searchParams.set(
        'role',
        legacy === 'admin' ? 'superuser' : 'unit-admin',
      );
      const next = req.nextUrl.searchParams.get('next');
      if (next) url.searchParams.set('next', next);
      return NextResponse.redirect(url);
    }
  }

  const rule = ROUTE_ROLES.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );

  if (!rule) return NextResponse.next();

  if (!role || !rule.allow.includes(role)) {
    /* Send would-be scanners to their own door. Bouncing a volunteer to the
     * agent login — which asks for a personal password they do not have —
     * is a dead end on event day. */
    const target = pathname.startsWith('/scanner') && role === null
      ? '/scanner/login'
      : '/login';

    const url = new URL(target, req.url);
    url.searchParams.set('next', pathname);

    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export function homeFor(role: AuthRole): string {
  if (role === 'SUPERUSER') return '/dashboard';
  if (role === 'AGENT') return '/agent/dashboard';
  if (role === 'UNIT_ADMIN') return '/unit/dashboard';
  // A gate session can only scan — there is nowhere else for it to go.
  if (role === 'SCANNER') return '/scanner';
  return '/login';
}

export const config = {
  matcher: [
    '/login',
    '/management',
    '/dashboard/:path*',
    '/admin/:path*',
    '/ticketing/:path*',
    '/agent/:path*',
    '/unit/:path*',
    '/scanner/:path*',
  ],
};
