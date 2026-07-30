import Image from 'next/image';
import Link from 'next/link';

/**
 * The event emblem, linked home.
 *
 * `/Pravasi-Sangama.svg` is a 1600×1600 square mark (verified against the
 * actual file — it is not the ~3:1 wordmark the usual placeholder numbers
 * assume). The intrinsic `width`/`height` below exist only to satisfy
 * next/image's required aspect ratio; the real rendered size is `className`,
 * and every call site pairs an equal height and width utility so the mark is
 * never stretched into an oval.
 *
 * `unoptimized`: Next's built-in image optimizer refuses local SVGs unless
 * `images.dangerouslyAllowSVG` is set in next.config.mjs, which also pulls in
 * a CSP consideration for a flag that would apply to every image in the app.
 * Raster optimization has no meaning for vector data anyway, so bypassing the
 * optimizer for this one asset is the narrower fix.
 */
export function Logo({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Pravasi Sangama 2026 — home"
      className="inline-flex shrink-0"
    >
      <Image
        src="/Pravasi-Sangama.svg"
        alt="Pravasi Sangama 2026"
        width={160}
        height={160}
        priority
        unoptimized
        className={className}
      />
    </Link>
  );
}
