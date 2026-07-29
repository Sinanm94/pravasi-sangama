'use client';

import { MotionConfig } from 'framer-motion';

/**
 * `reducedMotion="user"` honours the OS setting globally. This matters more
 * here than on a typical site: the gate scanner throws full-screen colour
 * flashes several times a minute, and for a motion-sensitive agent working a
 * six-hour shift that is a real problem. With the flag set, framer-motion
 * keeps opacity changes and drops transforms.
 */
export default function MotionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
