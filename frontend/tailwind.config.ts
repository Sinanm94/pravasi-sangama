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
        // Official brand palette. These are the only navy/gold values in the
        // system — do not introduce a shade that is not listed here.
        brand: {
          navy: '#062B59', // primary — backgrounds, headers
          'navy-dark': '#031F43', // shadows, footer, buttons, QR label block
          gold: '#D4AF37', // accents, borders, icons
          'gold-light': '#F7E7B5', // highlights, light accents
          grey: '#E6E6E6', // dividers, subtle lines
        },
      },
      boxShadow: {
        card: '0 8px 30px rgb(0 0 0 / 0.04)',
        ticket: '0 20px 60px -15px rgb(6 43 89 / 0.45)',
      },
    },
  },
  plugins: [],
};

export default config;
