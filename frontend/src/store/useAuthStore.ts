import { create } from 'zustand';
import type { AuthRole, SessionResponse } from '@pravasi/shared';

/**
 * Session state.
 *
 * **Deliberately NOT persisted.** Zustand's `persist` middleware writes to
 * localStorage, and these are shared gate phones (CLAUDE.md §3.2). The JWT
 * lives in an httpOnly cookie the browser manages; this store is a render-time
 * mirror of it, rehydrated from `GET /api/auth/session` on every boot.
 *
 * Consequence worth internalising: **this store is not an authorization
 * boundary.** Anyone can set `role: 'SUPERUSER'` from a console. Every real
 * check happens server-side against the signed cookie. This exists so the UI
 * knows what to draw.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export interface SessionUser {
  agentId?: string;
  agentName?: string;
  agentMobile?: string;
  unitId?: string;
  unitCode?: string;
  unitName?: string;
  unitSector?: string | null;
  divisionId?: string;
  divisionName?: string;
  divisionCode?: string;
  /** SCANNER sessions only — a gate is the identity here, not a person. */
  gateId?: string;
  gateCode?: string;
  gateName?: string;
}

type HydrationStatus = 'idle' | 'loading' | 'ready';

interface AuthState {
  isAuth: boolean;
  role: AuthRole | null;
  userData: SessionUser | null;
  /** 'idle' until the first hydrate resolves — guards render an early redirect. */
  status: HydrationStatus;

  /** Step 2 complete, or superuser signed in. Full access for that role. */
  login: (session: SessionResponse) => void;
  /** Step 1 complete. Authenticated location, no agent bound yet. */
  setUnitPending: (session: SessionResponse) => void;
  /** Clears local state. Call after POST /api/auth/logout clears the cookie. */
  logout: () => void;
  /** Reads the verified session from the API. Safe to call repeatedly. */
  hydrate: () => Promise<void>;
}

const EMPTY = {
  isAuth: false,
  role: null,
  userData: null,
} as const;

function toUser(session: SessionResponse): SessionUser {
  return {
    agentId: session.agent?.id,
    agentName: session.agent?.name,
    agentMobile: session.agent?.mobileNumber,
    unitId: session.unit?.id,
    unitCode: session.unit?.unitCode,
    unitName: session.unit?.name,
    unitSector: session.unit?.sector ?? null,
    divisionId: session.division?.id,
    divisionName: session.division?.name,
    divisionCode: session.division?.code,
    gateId: session.gate?.id,
    gateCode: session.gate?.gateCode,
    gateName: session.gate?.name,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...EMPTY,
  status: 'idle',

  login: (session) =>
    set({
      isAuth: true,
      role: session.role,
      userData: toUser(session),
      status: 'ready',
    }),

  // isAuth stays FALSE here. A unit session authenticates a location, not a
  // person, and it cannot issue tickets or scan. Treating it as "logged in"
  // is how a half-authenticated device ends up at a gate.
  setUnitPending: (session) =>
    set({
      isAuth: false,
      role: 'UNIT_PENDING',
      userData: toUser(session),
      status: 'ready',
    }),

  logout: () => set({ ...EMPTY, status: 'ready' }),

  hydrate: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading' });

    try {
      const res = await fetch(`${API_BASE}/auth/session`, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (!res.ok) {
        set({ ...EMPTY, status: 'ready' });
        return;
      }

      const session = (await res.json()) as SessionResponse & {
        role: AuthRole | null;
      };

      if (!session.role) {
        set({ ...EMPTY, status: 'ready' });
        return;
      }

      set({
        isAuth: session.role !== 'UNIT_PENDING',
        role: session.role,
        userData: toUser(session),
        status: 'ready',
      });
    } catch {
      // Offline at a gate is normal. Don't wipe a working session just
      // because one hydration request failed.
      set({ status: 'ready' });
    }
  },
}));

/** Convenience selectors — keep components from subscribing to the whole store. */
export const selectRole = (s: AuthState) => s.role;
export const selectUser = (s: AuthState) => s.userData;
export const selectIsReady = (s: AuthState) => s.status === 'ready';
