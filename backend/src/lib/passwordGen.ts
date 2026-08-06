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
 * `count` crypto-random decimal digits.
 *
 * Deliberately the FULL 0–9, not PASSWORD_DIGITS above. The ambiguous-digit
 * exclusion exists to stop `0`/`O` and `1`/`l` being confused inside a mixed
 * alphanumeric string; in an all-digit run there is no letter to confuse
 * them with, and dropping two of ten digits would cut the space by a third
 * (8^n vs 10^n) for no readability gain. Used for the unit-admin password
 * suffix and the gate PINs.
 */
export function randomDigits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    out += randomInt(0, 10).toString();
  }
  return out;
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

/**
 * An agent's temporary password: `psa<4 digits>-pw`, e.g. `psa4821-pw`.
 *
 * Same shape as the unit-admin format (lowercase, one digit run, a fixed
 * suffix) so staff learn one pattern, but with a constant `psa` stem rather
 * than a unit prefix — an agent's password must not be derivable from
 * anything printed on a roster, and unlike a unit admin there is no public
 * code to build from anyway.
 *
 * ⚠ Same 4-digit entropy caveat as the unit-admin passwords: 10,000 per
 * account, with the rest of the string constant. It is a TEMPORARY
 * credential — handed over in person, meant to be used and then changed —
 * and an agent can only issue tickets for their own unit, never approve
 * anyone. Raise the digit count here if that stops being an acceptable
 * trade; do not reintroduce mixed case, which is what this format exists to
 * avoid.
 */
export function generateAgentPassword(): string {
  return `psa${randomDigits(4)}-pw`;
}
