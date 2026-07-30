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
 */
const PUBLIC_ROUTES = ['/scanner/login'];

const ROUTE_ROLES: Array<{ prefix: string; allow: AuthRole[] }> = [
  { prefix: '/dashboard', allow: ['SUPERUSER'] },
  // Everything under /admin creates or revokes the ability to issue tickets
  // and admit people. One prefix rule, so a new admin page is guarded by
  // default rather than by remembering to add it.
  { prefix: '/admin', allow: ['SUPERUSER'] },
  { prefix: '/ticketing', allow: ['AGENT'] },
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
    // Already holding a gate session — skip the form.
    if (role === 'SCANNER') {
      return NextResponse.redirect(new URL('/scanner', req.url));
    }
    return NextResponse.next();
  }

  /* Already signed in and sitting on /login — send them where they belong,
   * so a returning agent does not re-enter a unit PIN for no reason. */
  if (pathname === '/login' && role && role !== 'UNIT_PENDING') {
    return NextResponse.redirect(new URL(homeFor(role), req.url));
  }

  const rule = ROUTE_ROLES.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );

  if (!rule) return NextResponse.next();

  if (!role || !rule.allow.includes(role)) {
    /* Send would-be scanners to their own door. Bouncing a volunteer to the
     * agent login — which asks for a unit code and a personal password they
     * do not have — is a dead end on event day. */
    const target = pathname.startsWith('/scanner') && role === null
      ? '/scanner/login'
      : '/login';

    const url = new URL(target, req.url);
    url.searchParams.set('next', pathname);

    // A unit session is step 1 of 2 — the login page reads this and opens
    // directly on the agent step rather than asking for the unit again.
    if (role === 'UNIT_PENDING') url.searchParams.set('step', 'agent');

    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export function homeFor(role: AuthRole): string {
  if (role === 'SUPERUSER') return '/dashboard';
  if (role === 'AGENT') return '/ticketing';
  // A gate session can only scan — there is nowhere else for it to go.
  if (role === 'SCANNER') return '/scanner';
  return '/login';
}

export const config = {
  matcher: [
    '/login',
    '/dashboard/:path*',
    '/admin/:path*',
    '/ticketing/:path*',
    '/scanner/:path*',
  ],
};
