/**
 * Registry for the real ticket design assets.
 *
 * Files live in `frontend/public/assets/ticket-design/` and are referenced by
 * absolute URL (not webpack imports) so the same paths resolve from the print
 * renderer, the PDF builder and the email template.
 *
 * EVERY ENTRY IS OPTIONAL. Anything left undefined falls back to the CSS-drawn
 * shape inside TicketReceipt. Uncomment a line only once the file is actually
 * in place — a missing file renders as a broken image, whereas `undefined`
 * renders as the designed fallback.
 */

import type { TicketType } from '@pravasi/shared';

export interface TicketAssets {
  /** Full-bleed surface for the main body. Layered over the navy base color. */
  background?: string;
  /** Optional separate surface for the stub panel. */
  stubBackground?: string;
  /** Paper grain / noise. Must have an alpha channel — it sits on top. */
  texture?: string;
  /** Fixed-width gold banner, one export per tier. */
  ribbon?: Partial<Record<TicketType, string>>;
  /**
   * True (default) when the tier name is baked into the ribbon artwork.
   * Set to false if the exports are blank plates and the label should be
   * overlaid by the component.
   */
  ribbonHasLabel?: boolean;
  ornaments?: {
    /** Replaces the CSS radial-gradient corner grids. */
    cornerDots?: string;
    /** Vertical dash tile, repeated down the stub divider. */
    divider?: string;
    /** Replaces the rotate-45 bullet square. */
    diamond?: string;
  };
  brand?: {
    /** Foundation mark, shown beside the organisation line. */
    logo?: string;
    /** "PRAVASI SANGAMA 2026" as artwork, replaces the type lockup. */
    lockup?: string;
  };
}

const BASE = '/assets/ticket-design';

export const TICKET_ASSETS: TicketAssets = {
  // background:     `${BASE}/backgrounds/ticket-bg.png`,
  // stubBackground: `${BASE}/backgrounds/stub-bg.png`,
  // texture:        `${BASE}/backgrounds/texture-overlay.png`,

  ribbon: {
    // NORMAL: `${BASE}/ribbons/ribbon-normal.svg`,
    // VIP:    `${BASE}/ribbons/ribbon-vip.svg`,
    // VVIP:   `${BASE}/ribbons/ribbon-vvip.svg`,
    // SVIP:   `${BASE}/ribbons/ribbon-svip.svg`,
  },
  ribbonHasLabel: true,

  ornaments: {
    // cornerDots: `${BASE}/ornaments/corner-dots.svg`,
    // divider:    `${BASE}/ornaments/divider-dashed.svg`,
    // diamond:    `${BASE}/ornaments/diamond.svg`,
  },

  brand: {
    // logo:   `${BASE}/brand/kcf-logo.svg`,
    // lockup: `${BASE}/brand/event-lockup.svg`,
  },
};

export { BASE as TICKET_ASSET_BASE };
