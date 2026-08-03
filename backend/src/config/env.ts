import 'dotenv/config';
import { z } from 'zod';

/**
 * Fail fast at boot rather than at the first request. A gate that starts
 * without a JWT secret is worse than a gate that refuses to start.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),
  PGSSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('pravasi-sangama-2026'),

  UNIT_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(720),
  AGENT_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(480),
  SUPERUSER_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(120),
  /**
   * Between agent (480) and superuser (120). A unit head checks this on
   * their own phone occasionally through the day rather than holding it
   * open for a shift, but the account can approve real agents, so it should
   * not linger signed in for days like a bookmark.
   */
  UNIT_ADMIN_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(240),
  /**
   * Gate scanner sessions. Long enough to cover one event day without a
   * volunteer re-entering the PIN, short enough that a shared PIN cannot mint
   * a token that outlives the event.
   */
  GATE_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(900),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  /** Public web origin. Used to build password-reset links in emails. */
  APP_URL: z.string().url().default('http://localhost:3000'),

  /**
   * Timezone the event runs in. Drives "today" in analytics — a container on
   * UTC would roll the daily counter over at 3am local, mid-event.
   */
  EVENT_TIMEZONE: z.string().default('Asia/Riyadh'),

  /**
   * Session cookie SameSite policy.
   *
   * 'lax' is correct in production, where the web and API share an origin.
   * In development they do not (:3000 vs :4000), and a Lax cookie set by a
   * cross-site response is never sent back — login succeeds and every request
   * after it is anonymous. Set 'none' locally; browsers treat localhost as a
   * secure context, so Secure works over plain http there.
   */
  COOKIE_SAMESITE: z.enum(['lax', 'none', 'strict']).default('lax'),

  /**
   * Cookie Domain attribute. Leave unset in development.
   *
   * Unset means a host-only cookie: it is returned only to the exact host
   * that set it. That is correct locally, and correct in any deployment
   * where the web tier and the API share one hostname.
   *
   * It is WRONG when they are split across subdomains
   * (`app.` + `api.pravasisangama.com`). The API sets the cookie host-only on
   * `api.`, `middleware.ts` runs on `app.` and cannot read it, and every
   * navigation bounces back to /login even though login returned 200. Set
   * `COOKIE_DOMAIN=.pravasisangama.com` there to scope it to the parent.
   *
   * Only ever set this to a domain you control. A cookie scoped to a parent
   * domain is sent to every subdomain under it.
   */
  COOKIE_DOMAIN: z.string().optional(),

  /* SMTP — all optional. Without SMTP_HOST + MAIL_FROM, development logs the
   * message instead of sending; production returns 503. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
