import type { ScanResult, TicketType } from '@pravasi/shared';

/**
 * Chart palette.
 *
 * The raw brand colours (§5.3) are the *ticket's* palette, tuned for a deep
 * violet surface. On a white dashboard card they fail a categorical-palette
 * audit: `#37098C` and `#2E0775` both sit far below the light-mode lightness
 * band and read as the same near-black next to each other.
 *
 * These are brand-derived steps lifted into that band. Verified with the
 * palette validator against surface #fcfcfb:
 *
 *   Lightness band      PASS   all four inside L 0.43–0.77
 *   CVD separation      PASS   worst adjacent ΔE 17.7 (protan), 20.0 (tritan)
 *   Normal-vision floor PASS   worst adjacent ΔE 23.2
 *   Contrast            WARN   gold 2.36:1 → relieved by direct slice labels
 *
 * Tier→hue mapping is semantic, not arbitrary: gold is the top tier, slate is
 * the baseline one.
 */
export const TIER_COLORS: Record<TicketType, string> = {
  NORMAL: '#67809b', // slate — the baseline tier
  VIP: '#2f5aa8', // navy, lifted
  VVIP: '#b03a3a', // maroon, lifted
  SVIP: '#c9a227', // gold, lifted
};

/**
 * Client pipeline stages.
 *
 * A SEPARATE palette from TIER_COLORS, not a reuse: those encode ticket
 * tier (identity), these encode pipeline stage (progress), and sharing one
 * ramp would make "VIP" and "Confirmed" the same colour in one dashboard.
 *
 * Verified with the palette validator against surface #ffffff, for the four
 * meaningful stages (PROSPECT is deliberately excluded from the check — see
 * below):
 *
 *   Lightness band      PASS   all four inside L 0.43–0.77
 *   Chroma floor        PASS   all four >= 0.1
 *   CVD separation      PASS   worst adjacent ΔE 11.0 (deutan), 14.2 (tritan)
 *   Normal-vision floor PASS   worst adjacent ΔE 24.1
 *   Contrast            WARN   gold 2.42:1 → relieved by the legend + table view
 *
 * The first attempt used the emerald/red already in STATUS_TONE and FAILED
 * at ΔE 5.6 (deutan) — a deuteranope could not separate CONFIRMED from
 * DECLINED, which is the single most important distinction on this screen.
 * They were re-stepped rather than kept for consistency with the badges.
 *
 * PROSPECT is intentionally near-gray and fails the chroma floor on
 * purpose: it is the "not started" baseline, and a saturated hue would give
 * the largest, least interesting bucket the most visual weight.
 */
export const CLIENT_STAGE_COLORS = {
  PROSPECT: '#8a8f9e', // neutral — untouched, deliberately recessive
  AWAITING_REPLY: '#c9a227', // gold — waiting on them
  CONFIRMED: '#2e9c6e', // green — they said yes
  TICKETED: '#2f5aa8', // navy — pass issued
  DECLINED: '#a8324a', // maroon — they said no
} as const;

/** Single-series bars keep the true brand violet — no adjacent hue to
 *  separate from, and at 7.5:1 it carries strong contrast against white. */
export const BAR_VIOLET = '#5E17EB';

/** Recessive chrome. Grid and axes must never compete with the marks. */
export const CHART_INK = {
  grid: '#f1f2f4',
  axis: '#9ca3af',
  label: '#6b7280',
} as const;

export const SCAN_RESULT_STYLES: Record<
  ScanResult,
  { label: string; className: string }
> = {
  ADMITTED: {
    label: 'Admitted',
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  },
  LOCATION_INFO: {
    label: 'Location',
    className: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  },
  DUPLICATE: {
    label: 'Duplicate',
    className: 'bg-amber-50 text-amber-700 ring-amber-600/15',
  },
  REVOKED: {
    label: 'Revoked',
    className: 'bg-red-50 text-red-700 ring-red-600/15',
  },
  UNKNOWN_CODE: {
    label: 'Unknown',
    className: 'bg-red-50 text-red-700 ring-red-600/15',
  },
};
