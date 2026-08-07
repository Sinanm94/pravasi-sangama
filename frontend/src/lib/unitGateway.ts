/**
 * Sticky Unit Gateway state (§3.5).
 *
 * Once a device has cleared the gateway for a unit, it should not be asked
 * again on every visit — that repetition is what made the gateway annoying
 * enough to be removed once already. This remembers which unit this device
 * belongs to so a returning agent lands straight on the sign-in form.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  WHAT IS STORED, AND WHAT DELIBERATELY IS NOT
 * ─────────────────────────────────────────────────────────────────────
 *
 *   stored      unit_code, unit name, when it was cleared
 *   NOT stored  the agent invite PIN. Ever.
 *
 * The unit code is public — it is printed on the roster and was a plain
 * dropdown option until recently. The PIN is not, and these are shared
 * phones: writing it here would mean a borrowed or stolen device leaks the
 * unit's PIN in readable form to anyone who opens devtools.
 *
 * That omission is not a gap, it is the design. `agentSignup` re-verifies
 * `agent_invite_pin` server-side on every registration, so a device with
 * sticky state but no PIN can sign an existing agent IN (no PIN required)
 * but cannot register a NEW one without someone typing the PIN again. A
 * borrowed phone therefore cannot mint agents, which is the whole point of
 * the gateway.
 *
 * This does NOT weaken §3.2's rule that JWTs never touch localStorage. No
 * session, token or credential is written here — this is a device
 * preference, and the cookie remains the only thing that authenticates.
 */

const STORAGE_KEY = 'ps26.unitGateway';

export interface StickyUnit {
  unitCode: string;
  unitName: string;
  /** ISO timestamp — informational, and lets a future TTL be added. */
  clearedAt: string;
}

/**
 * All access is wrapped: `localStorage` throws in Safari private mode and is
 * absent during SSR, and neither is worth crashing the login page over. A
 * failure here just means the agent sees the gateway, which is correct.
 */
export function readStickyUnit(): StickyUnit | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StickyUnit>;

    // Shape-check rather than trust: this is user-writable storage, and a
    // half-written or hand-edited value must not render as a unit.
    if (
      typeof parsed.unitCode !== 'string' ||
      typeof parsed.unitName !== 'string' ||
      !parsed.unitCode.trim()
    ) {
      return null;
    }

    return {
      unitCode: parsed.unitCode,
      unitName: parsed.unitName,
      clearedAt:
        typeof parsed.clearedAt === 'string'
          ? parsed.clearedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveStickyUnit(unit: {
  unitCode: string;
  unitName: string;
}): void {
  if (typeof window === 'undefined') return;

  try {
    const value: StickyUnit = {
      unitCode: unit.unitCode,
      unitName: unit.unitName,
      clearedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage full or blocked. The gateway simply asks again next time.
  }
}

/**
 * Forget this device's unit.
 *
 * Not optional polish — without it a phone that cleared the wrong unit has
 * no way back except clearing site data, and a device genuinely moving
 * between units on event day would be stuck on the first one it saw.
 */
export function clearStickyUnit(): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Nothing useful to do — the caller resets its own state regardless. */
  }
}
