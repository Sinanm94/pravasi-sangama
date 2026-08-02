import Image from 'next/image';
import Link from 'next/link';

/**
 * The event emblem.
 *
 * Two assets, because the artwork is a PORTRAIT LOCKUP — swoosh above a
 * "PRAVASI SANGAMA 2026" wordmark — not a square icon:
 *
 *   full  `/Pravasi-sangama-Photoroom.png`  the complete lockup, 2000×2000
 *   mark  `/Pravasi-sangama-mark.png`       the swoosh alone, cropped from it
 *
 * Below roughly 64px the wordmark in `full` is an illegible smudge, so
 * anything small — nav bars, footers, badges — must use `mark`. The mark file
 * is a straight crop of the same PNG (660×660 at +652+471), so the two can
 * never drift apart.
 *
 * The artwork is dark violet, so it needs a LIGHT surface behind it. That is
 * why the mastheads are white rather than a dark band — see §5.3. It carries
 * no plate or chip of its own; if it is ever placed on a dark surface it will
 * disappear, and the surface is what should change.
 *
 * `unoptimized`: the source is already a compressed PNG served from /public
 * and is only ever rendered small; running it through the optimizer buys
 * nothing and adds a build step per size.
 */

const SOURCES = {
  full: { src: '/Pravasi-sangama-Photoroom.png', box: 2000 },
  mark: { src: '/Pravasi-sangama-mark.png', box: 660 },
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
