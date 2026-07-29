import type { Transition, Variants } from 'framer-motion';

/**
 * One motion vocabulary for the whole app.
 *
 * Apple's feel comes from springs that settle rather than tweens that stop.
 * All of these are critically-to-slightly-under damped — they arrive and
 * stay. Nothing here bounces past its target (CLAUDE.md §5.1: "Nothing
 * bounces"), which is why damping never drops below ~26.
 */

/** Sheets, modals, page-level swaps. Weighty but quick. */
export const springSurface: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
  mass: 0.9,
};

/** Small elements: inline errors, pills, list rows. Snappier. */
export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 30,
  mass: 0.6,
};

/** The scanner verdict. Fast enough to feel instant at a gate. */
export const springVerdict: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 26,
  mass: 0.8,
};

/** Opacity-only. Backdrops and cross-fades, where movement adds nothing. */
export const fade: Transition = { duration: 0.2, ease: [0.4, 0, 0.2, 1] };

/* ------------------------------------------------------------------ */
/* Reusable variants                                                   */
/* ------------------------------------------------------------------ */

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

/**
 * Sheet on mobile, modal on desktop. The caller picks by passing `custom`:
 * true → slides from the bottom edge, false → scales in place.
 */
export const sheetVariants: Variants = {
  hidden: (isSheet: boolean) =>
    isSheet
      ? { y: '100%', opacity: 1 }
      : { y: 12, scale: 0.96, opacity: 0 },
  visible: { y: 0, scale: 1, opacity: 1 },
  exit: (isSheet: boolean) =>
    isSheet
      ? { y: '100%', opacity: 1 }
      : { y: 8, scale: 0.97, opacity: 0 },
};

/** Full-screen scan verdict. */
export const verdictVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.16 } },
};

/**
 * Form ↔ receipt. The outgoing screen lifts and fades while the incoming one
 * rises — a handoff, not a slideshow.
 */
export const screenVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
};

/** Inline validation messages. Height animates so the layout does not jump. */
export const fieldErrorVariants: Variants = {
  hidden: { opacity: 0, height: 0, y: -4 },
  visible: { opacity: 1, height: 'auto', y: 0 },
  exit: { opacity: 0, height: 0, y: -4 },
};
