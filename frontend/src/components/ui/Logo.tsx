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
 * never drift apart; regenerate it with the command in the repo README if the
 * source artwork changes.
 *
 * ---------------------------------------------------------------------
 * `plate` — REQUIRED on navy.
 *
 * The artwork is purple. Measured against the navy masthead, ~59% of its ink
 * sits at 1.0–1.5:1 contrast: the deep-violet and black passes disappear
 * entirely and the mark reads as broken rather than as a logo. (The previous
 * red/orange artwork measured 3.7:1 and needed no help.) On white it is
 * 8.9–13:1 and perfect.
 *
 * `plate` plants it on a small light rounded square, which is the standard
 * treatment for a dark-ink logo on a dark surface and keeps the brand colour
 * exact. Do not "fix" this by recolouring the artwork.
 * ---------------------------------------------------------------------
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
  /** Light backing square. Use on any navy surface — see the note above. */
  plate = false,
}: {
  className?: string;
  variant?: keyof typeof SOURCES;
  linked?: boolean;
  priority?: boolean;
  plate?: boolean;
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

  const framed = plate ? (
    <span className="inline-flex shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-black/5">
      {image}
    </span>
  ) : (
    image
  );

  if (!linked) return framed;

  return (
    <Link
      href="/"
      aria-label="Pravasi Sangama 2026 — home"
      className="inline-flex shrink-0 rounded-xl transition-opacity duration-200 hover:opacity-80 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
    >
      {framed}
    </Link>
  );
}
