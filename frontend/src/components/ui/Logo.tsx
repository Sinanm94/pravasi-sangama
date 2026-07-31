import Image from 'next/image';
import Link from 'next/link';

/**
 * The event emblem.
 *
 * Two assets, because the artwork is a PORTRAIT LOCKUP — flame mark above a
 * "PRAVASI SANGAMA 2026" wordmark — not a square icon:
 *
 *   full  `/Pravasi-Sangama.svg`       the complete lockup, 1600×1600 viewBox
 *   mark  `/Pravasi-Sangama-mark.svg`  the flame alone, viewBox cropped to it
 *
 * Below roughly 64px the wordmark in `full` is an illegible smudge, so
 * anything small — nav bars, footers, badges — must use `mark`. The mark file
 * is the same source SVG with its viewBox narrowed onto the flame: the
 * wordmark paths are still in the file but fall outside the box and are
 * clipped, so the two assets cannot drift apart.
 *
 * `unoptimized`: Next's image optimizer refuses local SVGs unless
 * `images.dangerouslyAllowSVG` is set, which would apply to every image in
 * the app and drags in a CSP consideration. Raster optimization is meaningless
 * for vector data, so bypassing it for this one asset is the narrower fix.
 */

const SOURCES = {
  full: { src: '/Pravasi-Sangama.svg', box: 1600 },
  mark: { src: '/Pravasi-Sangama-mark.svg', box: 616 },
} as const;

export function Logo({
  className = 'h-10 w-10',
  variant = 'mark',
  /** Drop the home link where the surrounding surface is already a target. */
  linked = true,
  priority = false,
}: {
  className?: string;
  variant?: keyof typeof SOURCES;
  linked?: boolean;
  priority?: boolean;
}) {
  const { src, box } = SOURCES[variant];

  /* width/height are the intrinsic ratio next/image requires — the rendered
   * size is `className`. Both assets are square, so call sites pair equal
   * h-/w- utilities and the mark is never stretched into an oval. */
  const image = (
    <Image
      src={src}
      alt="Pravasi Sangama 2026"
      width={box}
      height={box}
      priority={priority}
      unoptimized
      className={className}
    />
  );

  if (!linked) return image;

  return (
    <Link
      href="/"
      aria-label="Pravasi Sangama 2026 — home"
      className="inline-flex shrink-0 rounded-xl transition-opacity duration-200 hover:opacity-80 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
    >
      {image}
    </Link>
  );
}
