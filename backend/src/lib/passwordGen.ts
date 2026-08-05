import { randomInt } from 'node:crypto';

/**
 * Ambiguous characters dropped — 0/O, 1/l/I — because these strings are read
 * off a printed distribution list or a phone screen and typed by hand,
 * often by a volunteer under time pressure. One alphabet, shared by every
 * db/provision-*.ts and db/bulk-rotate-*.ts script, so "what counts as
 * ambiguous" is answered in exactly one place rather than copied per file.
 */
export const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const PASSWORD_LOWER = 'abcdefghijkmnopqrstuvwxyz';
export const PASSWORD_DIGITS = '23456789';
export const PASSWORD_ALPHABET = PASSWORD_UPPER + PASSWORD_LOWER + PASSWORD_DIGITS;

/** One crypto-secure pick from `pool` — never Math.random. */
export function randomChar(pool: string): string {
  return pool[randomInt(0, pool.length)]!;
}

/**
 * `length` characters, guaranteeing at least one upper/lower/digit rather
 * than leaving it to chance — "a mix" is the requirement, not merely a pool
 * large enough that a mix is likely. The three guaranteed picks are placed
 * at random positions via a Fisher–Yates shuffle using `randomInt`
 * (crypto-secure), not `Math.random`, so they don't always land in the same
 * three slots.
 */
export function generateSecurePassword(length: number): string {
  if (length < 3) {
    throw new Error('generateSecurePassword: length must be at least 3');
  }

  const chars = [
    randomChar(PASSWORD_UPPER),
    randomChar(PASSWORD_LOWER),
    randomChar(PASSWORD_DIGITS),
  ];
  while (chars.length < length) {
    chars.push(randomChar(PASSWORD_ALPHABET));
  }

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join('');
}
