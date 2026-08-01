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
      {/* Two soft washes on the diagonal. Large and very faint, so they read
          as a warm cast on the grey rather than as shapes. */}
      <div
        className="absolute -left-[10%] -top-[12%] h-[78vh] w-[78vh] rounded-full"
        style={{
          background: `radial-gradient(circle, ${GOLD}1F 0%, ${GOLD}10 45%, transparent 72%)`,
        }}
      />
      <div
        className="absolute -bottom-[14%] -right-[8%] h-[84vh] w-[84vh] rounded-full"
        style={{
          background: `radial-gradient(circle, ${GOLD}1C 0%, ${GOLD}0E 45%, transparent 72%)`,
        }}
      />

      {/* A single cool wash keeps the gold from tipping the page sepia. */}
      <div
        className="absolute -right-[10%] top-[8%] h-[40vh] w-[40vh] rounded-full"
        style={{
          background: `radial-gradient(circle, ${NAVY}12 0%, transparent 70%)`,
        }}
      />

      {/* Corner dot fields — the ticket's own ornament (§9), reused at a
          fraction of its strength so the app and the pass feel related. */}
      <div
        className="absolute left-8 top-24 hidden h-40 w-40 sm:block"
        style={{
          backgroundImage: `radial-gradient(${GOLD}59 1px, transparent 1px)`,
          backgroundSize: '14px 14px',
          opacity: 0.5,
          maskImage: 'radial-gradient(circle at 0% 0%, #000 10%, transparent 72%)',
          WebkitMaskImage:
            'radial-gradient(circle at 0% 0%, #000 10%, transparent 72%)',
        }}
      />
      <div
        className="absolute bottom-16 right-10 hidden h-44 w-44 sm:block"
        style={{
          backgroundImage: `radial-gradient(${GOLD}59 1px, transparent 1px)`,
          backgroundSize: '14px 14px',
          opacity: 0.5,
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
        <circle cx="100" cy="100" r="96" stroke={GOLD} strokeWidth="0.6" opacity="0.22" />
        <circle cx="100" cy="100" r="74" stroke={GOLD} strokeWidth="0.4" opacity="0.14" />
      </svg>
      <svg
        className="absolute -right-28 top-[6%] hidden h-[380px] w-[380px] lg:block"
        viewBox="0 0 200 200"
        fill="none"
      >
        <circle cx="100" cy="100" r="96" stroke={GOLD} strokeWidth="0.6" opacity="0.2" />
      </svg>
    </div>
  );
}
