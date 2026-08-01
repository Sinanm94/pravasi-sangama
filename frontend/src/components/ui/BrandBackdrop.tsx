const GOLD = '#D4AF37';
const NAVY = '#062B59';

/**
 * Decorative gold ornament for the empty page background.
 *
 * §5.3 bans gold "as text or an action on a white or grey surface" — that is
 * a LEGIBILITY rule, about a 2:1 contrast ratio on 10–11px type. Nothing here
 * is text or a control: these are washes and dot fields at 3–7% alpha, sitting
 * behind the content. They are meant to be felt rather than seen, which is
 * also why §5.1's "generous whitespace" survives — the whitespace is still
 * there, it just is not blank.
 *
 * Rules this must keep:
 *   - `print:hidden`. It must never reach a printed ticket or the manual.
 *   - `pointer-events-none` + `aria-hidden`. It is not content and must not
 *     intercept a tap at a registration desk.
 *   - `fixed`, so a long ledger scrolls over a stationary field instead of
 *     dragging a repeating pattern with it.
 *
 * Radial gradients rather than SVG noise or an image: they cost nothing to
 * download, scale to any viewport, and stay crisp on the retina phones the
 * agents actually carry.
 */
export default function BrandBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden print:hidden"
    >
      {/* A warm-to-cool diagonal, which is where the depth comes from: gold
          top-left sweeping into navy bottom-right. Gold alone read as a flat
          cream tint no matter how far it was pushed — it is the temperature
          CONTRAST that makes the page feel lit rather than tinted. Both are
          brand colours (§5.3); nothing new was introduced. */}
      <div
        className="absolute -left-[12%] -top-[14%] h-[85vh] w-[85vh] rounded-full"
        style={{
          background: `radial-gradient(circle, ${GOLD}74 0%, ${GOLD}38 42%, transparent 72%)`,
        }}
      />
      <div
        className="absolute -bottom-[16%] -right-[10%] h-[90vh] w-[90vh] rounded-full"
        style={{
          background: `radial-gradient(circle, ${NAVY}5C 0%, ${NAVY}26 42%, transparent 72%)`,
        }}
      />

      {/* A second, smaller gold bloom on the cool side stops the bottom-right
          reading as a grey shadow. */}
      <div
        className="absolute -right-[12%] top-[2%] h-[48vh] w-[48vh] rounded-full"
        style={{
          background: `radial-gradient(circle, ${GOLD}4C 0%, transparent 70%)`,
        }}
      />

      {/* Corner dot fields — the ticket's own ornament (§9), reused at a
          fraction of its strength so the app and the pass feel related. */}
      <div
        className="absolute left-8 top-24 hidden h-40 w-40 sm:block"
        style={{
          backgroundImage: `radial-gradient(${GOLD}B0 1px, transparent 1px)`,
          backgroundSize: '14px 14px',
          opacity: 0.7,
          maskImage: 'radial-gradient(circle at 0% 0%, #000 10%, transparent 72%)',
          WebkitMaskImage:
            'radial-gradient(circle at 0% 0%, #000 10%, transparent 72%)',
        }}
      />
      <div
        className="absolute bottom-16 right-10 hidden h-44 w-44 sm:block"
        style={{
          backgroundImage: `radial-gradient(${GOLD}B0 1px, transparent 1px)`,
          backgroundSize: '14px 14px',
          opacity: 0.7,
          maskImage:
            'radial-gradient(circle at 100% 100%, #000 10%, transparent 72%)',
          WebkitMaskImage:
            'radial-gradient(circle at 100% 100%, #000 10%, transparent 72%)',
        }}
      />

      {/* Hairline arcs, echoing the gold curves on the pass. Stroked SVG so
          they stay a true hairline at any zoom. */}
      <svg
        className="absolute -left-24 bottom-[12%] hidden h-[420px] w-[420px] lg:block"
        viewBox="0 0 200 200"
        fill="none"
      >
        <circle cx="100" cy="100" r="96" stroke={GOLD} strokeWidth="0.8" opacity="0.4" />
        <circle cx="100" cy="100" r="74" stroke={GOLD} strokeWidth="0.6" opacity="0.26" />
      </svg>
      <svg
        className="absolute -right-28 top-[6%] hidden h-[380px] w-[380px] lg:block"
        viewBox="0 0 200 200"
        fill="none"
      >
        <circle cx="100" cy="100" r="96" stroke={GOLD} strokeWidth="0.8" opacity="0.36" />
      </svg>
    </div>
  );
}
