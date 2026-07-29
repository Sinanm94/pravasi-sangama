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

const ROUTE_ROLES: Array<{ prefix: string; allow: AuthRole[] }> = [
  { prefix: '/dashboard', allow: ['SUPERUSER'] },
  { prefix: '/ticketing', allow: ['AGENT'] },
  { prefix: '/scanner', allow: ['AGENT'] },
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

  const rule = ROUTE_ROLES.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );

  const role = readRole(req.cookies.get(SESSION_COOKIE_NAME)?.value);

  /* Already signed in and sitting on /login — send them where they belong,
   * so a returning agent does not re-enter a unit PIN for no reason. */
  if (pathname === '/login' && role && role !== 'UNIT_PENDING') {
    return NextResponse.redirect(new URL(homeFor(role), req.url));
  }

  if (!rule) return NextResponse.next();

  if (!role || !rule.allow.includes(role)) {
    const url = new URL('/login', req.url);
    // Return the user to where they were headed once they authenticate.
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
  return '/login';
}

export const config = {
  matcher: ['/login', '/dashboard/:path*', '/ticketing/:path*', '/scanner/:path*'],
};
