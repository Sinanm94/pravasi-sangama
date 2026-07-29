import type { SessionClaims } from '@pravasi/shared';

declare global {
  namespace Express {
    interface Request {
      /** Populated by the auth middleware. Absent on public routes. */
      auth?: SessionClaims;
      /** The raw signed token, needed to match against unit_sessions.token_hash. */
      rawToken?: string;
    }
  }
}

export {};
