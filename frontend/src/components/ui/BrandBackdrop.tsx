const GOLD = '#D4AF37';

/**
 * Decorative gold ornament for the empty page background.
 *
 * THREE LAYERS, none of them a coloured blob:
 *
 *   1. an even dot lattice across the whole viewport, masked clear through
 *      the middle so content never sits on texture,
 *   2. long hairline arcs anchored well past the corners,
 *   3. one very flat diagonal warm gradient.
 *
 * Earlier versions used large soft radial gradients in the corners. They read
 * as stains at every strength tried — faint enough to be invisible, or strong
 * enough to look like a spill, with nothing usable in between. A blurred
 * circle on a light background has no craft in it; an even lattice and a
 * precise arc do. The rule that came out of it, worth keeping: on a light
 * surface, ornament comes from texture and line work, not from colour washes.
 *
 * Constraints this must keep:
 *   - `print:hidden`. It must never reach a printed ticket or the manual.
 *   - `pointer-events-none` + `aria-hidden`. It is not content and must not
 *     intercept a tap at a registration desk.
 *   - `fixed`, so a long ledger scrolls over a stationary field rather than
 *     dragging a repeating pattern with it.
 *
 * §5.3 bans gold on a light surface as TEXT OR AN ACTION — a contrast rule
 * about 10–11px type. None of this is type or a control.
 */
export default function BrandBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden print:hidden"
    >
      {/* 1 — Warm diagonal. `linear`, deliberately, spanning the whole
             viewport: a radial gradient concentrates into a visible disc,
             where a flat linear sweep reads as light falling across a page. */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${GOLD}1F 0%, ${GOLD}0D 26%, transparent 58%)`,
        }}
      />

      {/* 2 — Dot lattice. Even pitch across the full viewport, then masked so
             the middle stays clean and texture only builds toward the edges.
             The evenness is what makes it read as intentional rather than as
             dirt on the screen. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(${GOLD}80 1px, transparent 1px)`,
          backgroundSize: '22px 22px',
          maskImage:
            'radial-gradient(ellipse 62% 62% at 50% 46%, transparent 38%, #000 100%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 62% 62% at 50% 46%, transparent 38%, #000 100%)',
        }}
      />

      {/* 3 — Hairline arcs, anchored well past the corners so only a long
             shallow curve crosses the page. A full circle sitting on the
             canvas reads as a stray ring. vector-effect keeps the stroke a
             true hairline however the vh-sized box scales. */}
      <svg
        className="absolute -left-[38vh] -top-[30vh] h-[132vh] w-[132vh]"
        viewBox="0 0 100 100"
        fill="none"
      >
        <circle
          cx="50"
          cy="50"
          r="46"
          stroke={GOLD}
          strokeOpacity="0.32"
          strokeWidth="0.18"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx="50"
          cy="50"
          r="37"
          stroke={GOLD}
          strokeOpacity="0.20"
          strokeWidth="0.14"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <svg
        className="absolute -bottom-[34vh] -right-[34vh] h-[126vh] w-[126vh]"
        viewBox="0 0 100 100"
        fill="none"
      >
        <circle
          cx="50"
          cy="50"
          r="46"
          stroke={GOLD}
          strokeOpacity="0.30"
          strokeWidth="0.18"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx="50"
          cy="50"
          r="35"
          stroke={GOLD}
          strokeOpacity="0.18"
          strokeWidth="0.14"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
