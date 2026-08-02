import type { Config } from 'tailwindcss';

/**
 * The official palette, and nothing else — there is no maroon in this system.
 * Navy is the single action colour across the app shell; gold is an accent on
 * navy surfaces only.
 *
 * The ticket keeps using inline styles with the NAVY / NAVY_DARK / GOLD /
 * GOLD_LIGHT / GREY_LIGHT constants: gold appears there at several alphas, and
 * inline styles survive print, PDF and email rendering far more reliably than
 * generated utility classes (CLAUDE.md §5.3).
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'var(--font-montserrat)',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        // Official brand palette, sampled from the event logo. These are the
        // only violet/amber values in the system — do not introduce a shade
        // that is not listed here.
        //
        // `violet` and `violet-deep` are BOTH needed and are not
        // interchangeable. The action colour has to read on white; the ticket
        // surface has to let amber read on IT. One value cannot do both:
        // amber on `violet` measures 3.81:1, which fails at the 8-10px the
        // ticket sets its eyebrows in.
        brand: {
          violet: '#5E17EB', // primary action — buttons, focus rings, links
          'violet-deep': '#37098C', // dark surfaces — ticket body, bands
          'violet-dark': '#2E0775', // deepest — caption blocks, footers
          amber: '#FFA51F', // accents, borders, icons (on dark only)
          'amber-light': '#FFD79A', // highlights, small text on dark violet
          grey: '#E6E6E6', // dividers, subtle lines
        },
      },
      boxShadow: {
        card: '0 8px 30px rgb(0 0 0 / 0.04)',
        ticket: '0 20px 60px -15px rgb(55 9 140 / 0.45)',
      },
    },
  },
  plugins: [],
};

export default config;
