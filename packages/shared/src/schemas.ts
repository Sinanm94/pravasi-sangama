import { z } from 'zod';
import {
  ACTIVITY_PRIORITIES,
  AGENT_INVITE_PIN_LENGTH,
  AGENT_PASSWORD_MIN_LENGTH,
  GATE_PIN_MAX_LENGTH,
  GATE_PIN_MIN_LENGTH,
  CLIENT_INTERACTION_KINDS,
  CLIENT_STATUSES,
  MOBILE_NUMBER_REGEX,
  SCAN_RESULTS,
  TICKET_STATUSES,
  TICKET_TYPES,
} from './constants.js';

const agentInvitePin = z
  .string()
  .trim()
  .regex(
    new RegExp(`^[0-9]{${AGENT_INVITE_PIN_LENGTH}}$`),
    `Enter the ${AGENT_INVITE_PIN_LENGTH}-digit invite PIN`,
  );

/**
 * Wire contracts. Field names are snake_case to match the Postgres columns —
 * the frontend maps its camelCase form state at the boundary, in one place,
 * rather than the API accepting two spellings of everything.
 */

/* ------------------------------------------------------------------ */
/* Auth — step 2: individual agent                                     */
/* ------------------------------------------------------------------ */

export const AgentLoginSchema = z.object({
  mobile_number: z
    .string()
    .trim()
    .regex(MOBILE_NUMBER_REGEX, 'Enter a valid 10-digit mobile number'),

  password: z.string().min(4, 'Password is required').max(128),
});

export type AgentLoginInput = z.infer<typeof AgentLoginSchema>;

/* ------------------------------------------------------------------ */
/* Auth — superuser                                                    */
/* ------------------------------------------------------------------ */

/**
 * Spec §4: exactly three superusers. The UI's field is labelled "Username"
 * and sends the key below — but the stored login identity can be either the
 * short username (`admin1`) or the full seeded email
 * (`admin1@pravasisangama.com`); `findSuperuserByUsername` matches on both.
 * So this is NOT `.email()`-validated: a plain username must not be
 * rejected here for not looking like an address.
 */
export const SuperuserLoginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username').max(180),
  password: z.string().min(8).max(128),
});

export type SuperuserLoginInput = z.infer<typeof SuperuserLoginSchema>;

/* ------------------------------------------------------------------ */
/* Auth — unit admin (decentralised approvals)                         */
/* ------------------------------------------------------------------ */

/**
 * The login field is labelled "Unit ID" in the UI (e.g. `BAT01`) but wired
 * as `username` — same field name as SuperuserLoginSchema, same table shape
 * (unit_admins mirrors superusers). Not `.min(8)` like the superuser
 * password: these accounts are provisioned in bulk with short fixed
 * passwords (e.g. `BAT01PW`) for non-technical volunteers, matching the
 * gate-PIN trade-off already made in §3.2.
 */
export const UnitAdminLoginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your Unit ID').max(64),
  password: z.string().min(4, 'Password is required').max(128),
});

export type UnitAdminLoginInput = z.infer<typeof UnitAdminLoginSchema>;

/* ------------------------------------------------------------------ */
/* Agent self-registration (spec §3)                                   */
/* ------------------------------------------------------------------ */

export const AgentSignupSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(120),

    /** Agent ID *is* the mobile number. */
    mobile_number: z
      .string()
      .trim()
      .regex(MOBILE_NUMBER_REGEX, 'Enter a valid 10-digit mobile number'),

    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Enter a valid email address')
      .max(180),

    /**
     * Units survive self-registration, so a signup must name one: every
     * ticket carries `unit_id` and `division_id` (§2), and step 1 of login
     * compares the agent's unit against the authenticated location. The unit
     * *code* is not a secret — the unit PIN is.
     *
     * The client still supplies this (never trusted blindly — see
     * agent_invite_pin below), but it is no longer typed or chosen freely:
     * the frontend hardcodes it from the Unit Gateway step the agent already
     * passed (§3.2), so this field is really "which gateway did you clear",
     * re-declared and re-verified server-side rather than taken on faith.
     */
    unit_code: z
      .string()
      .trim()
      .min(1, 'Unit code is required')
      .max(32)
      .transform((v) => v.toUpperCase()),

    /**
     * Re-verified server-side against `units.agent_invite_pin_hash` before
     * the account is created — the Unit Gateway screen is a UX gate, not the
     * security boundary. Without this check, anyone could bypass the
     * gateway UI entirely and POST any unit_code directly, defeating the
     * whole point of the gate (§3.2).
     */
    agent_invite_pin: agentInvitePin,

    /**
     * OPTIONAL. Many field agents are coming off paper systems and would
     * rather be handed a password than invent one; leaving these blank makes
     * the server generate a temporary one and return it once, so an account
     * is never created without a credential. An agent who does type a
     * password still gets exactly the old behaviour.
     */
    password: z
      .string()
      .min(
        AGENT_PASSWORD_MIN_LENGTH,
        `Password must be at least ${AGENT_PASSWORD_MIN_LENGTH} characters`,
      )
      .max(128)
      .optional(),

    confirm_password: z.string().optional(),
  })
  .strict()
  // Only meaningful when one was supplied; both blank is the generate path.
  .refine((data) => !data.password || data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

export type AgentSignupInput = z.infer<typeof AgentSignupSchema>;

/* ------------------------------------------------------------------ */
/* Unit Gateway — agent invite PIN (§3.2)                               */
/* ------------------------------------------------------------------ */

/**
 * POST /api/auth/unit-gateway. Checked fresh on every attempt — no session
 * or cookie is issued here, this only unlocks the agent portal client-side
 * and hands back the unit to hardcode into the signup form.
 */
export const UnitGatewaySchema = z
  .object({
    unit_code: z
      .string()
      .trim()
      .min(1, 'Enter your unit code')
      .max(32)
      .transform((v) => v.toUpperCase()),
    agent_invite_pin: agentInvitePin,
  })
  .strict();

export type UnitGatewayInput = z.infer<typeof UnitGatewaySchema>;

/* ------------------------------------------------------------------ */
/* Password reset (spec §3)                                            */
/* ------------------------------------------------------------------ */

/**
 * Keyed on MOBILE NUMBER, not email — this is the whole reason the flow
 * could be restored at all.
 *
 * The original version took an email address, and migration 013 retired it
 * for a concrete reason: `agents.email` stopped being unique (field agents
 * share their unit head's inbox), so looking an agent up by address returns
 * an ARBITRARY one of them, and the reset link could be minted for someone
 * other than the person who asked.
 *
 * `mobile_number` is still UNIQUE and is the documented Agent ID (§2), so
 * it resolves exactly one agent. The link is then sent to whatever address
 * sits on THAT agent's row.
 *
 * What this does NOT solve, and cannot: if several agents share an inbox,
 * any of them can open the link once it arrives. That residual risk is
 * bounded by a short expiry and single use, and is why the admin-driven
 * reset (§3.4) remains the recommended path for a shared address.
 */
export const ForgotPasswordSchema = z
  .object({
    mobile_number: z
      .string()
      .trim()
      .regex(MOBILE_NUMBER_REGEX, 'Enter a valid 10-digit mobile number'),
  })
  .strict();

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z
  .object({
    token: z.string().trim().min(16).max(256),
    password: z
      .string()
      .min(
        AGENT_PASSWORD_MIN_LENGTH,
        `Password must be at least ${AGENT_PASSWORD_MIN_LENGTH} characters`,
      )
      .max(128),
    confirm_password: z.string(),
  })
  .strict()
  .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

/* ------------------------------------------------------------------ */
/* Gate scanner login (spec §2, Option A)                              */
/* ------------------------------------------------------------------ */

const gatePin = z
  .string()
  .trim()
  .regex(
    new RegExp(`^[0-9]{${GATE_PIN_MIN_LENGTH},${GATE_PIN_MAX_LENGTH}}$`),
    `PIN must be ${GATE_PIN_MIN_LENGTH}–${GATE_PIN_MAX_LENGTH} digits`,
  );

export const GateLoginSchema = z
  .object({
    gate_code: z
      .string()
      .trim()
      .min(1, 'Select a gate')
      .max(32)
      .transform((v) => v.toUpperCase()),
    pin: gatePin,
  })
  .strict();

export type GateLoginInput = z.infer<typeof GateLoginSchema>;

/* ------------------------------------------------------------------ */
/* Admin — gate management and agent approval                          */
/* ------------------------------------------------------------------ */

export const CreateGateSchema = z
  .object({
    gate_code: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .transform((v) => v.toUpperCase()),
    name: z.string().trim().min(1).max(100),
    division_code: z
      .string()
      .trim()
      .max(32)
      .transform((v) => v.toUpperCase())
      .optional(),
    pin: gatePin,
    /** ISO date. Set it for a PIN that must stop working after event day. */
    pin_valid_on: z.string().date().optional(),
  })
  .strict();

export type CreateGateInput = z.infer<typeof CreateGateSchema>;

export const RotateGatePinSchema = z
  .object({
    pin: gatePin,
    pin_valid_on: z.string().date().optional(),
  })
  .strict();

export type RotateGatePinInput = z.infer<typeof RotateGatePinSchema>;

export const AgentDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

export type AgentDecisionInput = z.infer<typeof AgentDecisionSchema>;

/* ------------------------------------------------------------------ */
/* Ticket issuance                                                     */
/* ------------------------------------------------------------------ */

/**
 * NOTE what is absent: `counted_persons`, `request_number`, `ticket_number`,
 * `agent_id`, `unit_id`. All are derived server-side.
 *
 * A client that posts `{ ticket_type: 'NORMAL', counted_persons: 4 }` must not
 * merely be rejected — the field must never be readable from the request in
 * the first place. `.strict()` makes an unknown key a validation error rather
 * than silently ignored input.
 */
export const IssueTicketSchema = z
  .object({
    purchaser_name: z
      .string()
      .trim()
      .min(2, 'Purchaser name is required')
      .max(120),

    mobile_number: z
      .string()
      .trim()
      .regex(MOBILE_NUMBER_REGEX, 'Enter a valid 10-digit mobile number'),

    email: z
      .string()
      .trim()
      .email('Enter a valid email address')
      .max(180)
      .optional()
      .or(z.literal('').transform(() => undefined)),

    ticket_type: z.enum(TICKET_TYPES),

    /** Free, and excluded from ticket capacity. Headcount only. */
    children_below_12: z.coerce
      .number()
      .int('Must be a whole number')
      .min(0)
      .max(20)
      .default(0),

    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export type IssueTicketInput = z.infer<typeof IssueTicketSchema>;

/* ------------------------------------------------------------------ */
/* Ticket delivery                                                     */
/* ------------------------------------------------------------------ */

/** Roughly 9MB of PNG once base64 expands it by ~33%. */
export const MAX_TICKET_IMAGE_BASE64 = 12_000_000;

export const ShareTicketEmailSchema = z
  .object({
    ticket_id: z.string().uuid('ticket_id must be a UUID'),
    email_address: z
      .string()
      .trim()
      .email('Enter a valid email address')
      .max(180),
    /**
     * The rendered pass, as a data URL or bare base64. Sent by the client
     * rather than re-rendered server-side: headless Chrome on the API just to
     * redraw a pass the agent is already looking at is a lot of infrastructure
     * for no gain in fidelity.
     */
    base64_image: z
      .string()
      .min(100, 'Ticket image is required')
      .max(MAX_TICKET_IMAGE_BASE64, 'Ticket image is too large'),
  })
  .strict();

export type ShareTicketEmailInput = z.infer<typeof ShareTicketEmailSchema>;

/* ------------------------------------------------------------------ */
/* Gate scanning                                                       */
/* ------------------------------------------------------------------ */

export const VerifyScanSchema = z
  .object({
    /** The raw value read off the QR. Hashed server-side before any lookup. */
    payload: z.string().trim().min(8, 'Scan payload is required').max(512),

    /**
     * Client-generated at capture time, before any network call. Makes the
     * request idempotent: a retry after a lost response returns the original
     * result instead of re-running the admission and reporting DUPLICATE
     * against itself. See CLAUDE.md §10.4.
     */
    client_scan_id: z.string().uuid('client_scan_id must be a UUID').optional(),

    gate_label: z.string().trim().max(64).optional(),
  })
  .strict();

export type VerifyScanInput = z.infer<typeof VerifyScanSchema>;

/**
 * Offline queue drain. Unlike /verify, `client_scan_id` is REQUIRED — a
 * replayed batch with no idempotency key would double-record admissions.
 *
 * `offline_scanned_at` is the client's capture time. It orders the batch and
 * becomes `scan_logs.created_at`, so analytics reflect when people physically
 * walked through the gate rather than when the network came back.
 */
export const BulkSyncScanSchema = z.object({
  payload: z.string().trim().min(8).max(512),
  client_scan_id: z.string().uuid('client_scan_id must be a UUID'),
  offline_scanned_at: z.string().datetime({
    offset: true,
    message: 'offline_scanned_at must be an ISO 8601 timestamp',
  }),
  gate_label: z.string().trim().max(64).optional(),
});

export type BulkSyncScanInput = z.infer<typeof BulkSyncScanSchema>;

export const BULK_SYNC_MAX_BATCH = 200;

export const BulkSyncSchema = z
  .object({
    scans: z
      .array(BulkSyncScanSchema)
      .min(1, 'At least one scan is required')
      .max(
        BULK_SYNC_MAX_BATCH,
        `Send at most ${BULK_SYNC_MAX_BATCH} scans per request`,
      ),
  })
  .strict();

export type BulkSyncInput = z.infer<typeof BulkSyncSchema>;

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

export const TicketSearchSchema = z.object({
  /** REQ number, TKT number, or 10-digit mobile — resolved server-side. */
  q: z.string().trim().min(3, 'Enter at least 3 characters').max(64),
});

export type TicketSearchInput = z.infer<typeof TicketSearchSchema>;

/* ------------------------------------------------------------------ */
/* Admin — master ticket ledger                                        */
/* ------------------------------------------------------------------ */

/**
 * Query for GET /api/admin/tickets.
 *
 * The id filters are validated as UUIDs here so a malformed value is a 400.
 * Passed straight to Postgres they would raise 22P02 (invalid input syntax
 * for type uuid), which surfaces as an opaque 500.
 *
 * Not `.strict()`: this parses `req.query`, and rejecting an unknown key
 * would break the moment anyone appends a cache-buster or a tracking param.
 */
export const AdminTicketQuerySchema = z.object({
  agent_id: z.string().uuid('agent_id must be a UUID').optional(),
  unit_id: z.string().uuid('unit_id must be a UUID').optional(),
  division_id: z.string().uuid('division_id must be a UUID').optional(),
  /**
   * Sector is a NAME, not a UUID — `units.sector` is a text column, not a
   * table (migration 010 explains why). Uppercased here so a hand-built
   * query string like `?sector=batha` still matches; the column itself is
   * normalised to uppercase by that same migration.
   */
  sector: z
    .string()
    .trim()
    .max(64)
    .transform((v) => v.toUpperCase())
    .optional(),
  search: z.string().trim().max(120).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(300),
});

export type AdminTicketQuery = z.infer<typeof AdminTicketQuerySchema>;

/**
 * Query for GET /api/admin/tickets/export — the same filters as the ledger
 * above, minus `limit`. The export has its own fixed row cap
 * (EXPORT_ROW_LIMIT in admin.controller.ts) precisely so the client cannot
 * ask for a small page OR override the cap to something unbounded — a CSV
 * export is either "everything matching the filters" or nothing, there is
 * no in-between page size to request.
 */
export const AdminTicketExportQuerySchema = AdminTicketQuerySchema.omit({
  limit: true,
});

export type AdminTicketExportQuery = z.infer<typeof AdminTicketExportQuerySchema>;

/** Query for GET /api/admin/scans — the superuser's scan log. */
export const AdminScanQuerySchema = z.object({
  result: z.enum(SCAN_RESULTS).optional(),
  gate_label: z.string().trim().max(120).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(300),
});

export type AdminScanQuery = z.infer<typeof AdminScanQuerySchema>;

/**
 * Query for GET /api/unit-admin/tickets.
 *
 * Deliberately no unit_id/division_id filter here, unlike AdminTicketQuerySchema
 * — the caller's scope IS the boundary (§3.3's OR-scope, resolved server-side
 * from the admin's own id), not something the client narrows further. `limit`
 * is capped lower than the superuser ledger's: a unit or zone scope is a much
 * smaller slice of the event than the whole thing.
 */
export const UnitAdminTicketQuerySchema = z.object({
  agent_id: z.string().uuid('agent_id must be a UUID').optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

export type UnitAdminTicketQuery = z.infer<typeof UnitAdminTicketQuerySchema>;

/* ------------------------------------------------------------------ */
/* Premium client tracking (migration 015)                             */
/* ------------------------------------------------------------------ */

/**
 * Only `name` is required. These records are created mid-conversation —
 * often the superuser has a name and nothing else yet — and demanding a
 * mobile or a tier up front would push people into typing placeholders,
 * which is worse than an empty column.
 *
 * `mobile` is NOT MOBILE_NUMBER_REGEX-validated: a premium guest may be
 * reached on an international number, unlike an agent whose 10-digit mobile
 * is their login identity.
 */
export const CreateClientSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a name').max(120),
    mobile: z.string().trim().max(32).optional(),
    email: z.string().trim().toLowerCase().max(180).optional(),
    organisation: z.string().trim().max(160).optional(),
    intended_tier: z.enum(TICKET_TYPES).optional(),
    status: z.enum(CLIENT_STATUSES).default('PROSPECT'),
    /** ISO date, no time — "chase them on this day". */
    follow_up_on: z.string().date().optional(),
    unit_id: z.string().uuid().optional(),
  })
  .strict();

export type CreateClientInput = z.infer<typeof CreateClientSchema>;

/** Every field optional — this patches one record, it does not replace it. */
export const UpdateClientSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    mobile: z.string().trim().max(32).nullable().optional(),
    email: z.string().trim().toLowerCase().max(180).nullable().optional(),
    organisation: z.string().trim().max(160).nullable().optional(),
    intended_tier: z.enum(TICKET_TYPES).nullable().optional(),
    status: z.enum(CLIENT_STATUSES).optional(),
    follow_up_on: z.string().date().nullable().optional(),
    ticket_id: z.string().uuid().nullable().optional(),
    unit_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;

/**
 * One entry on the timeline.
 *
 * `occurred_at` is optional and defaults server-side to now: a call taken on
 * Sunday is often logged on Monday, and forcing a date on every entry would
 * make the common case slower for the sake of the rare one.
 */
export const CreateClientInteractionSchema = z
  .object({
    kind: z.enum(CLIENT_INTERACTION_KINDS).default('NOTE'),
    body: z.string().trim().min(1, 'Say what happened').max(4000),
    occurred_at: z.string().datetime().optional(),
  })
  .strict();

export type CreateClientInteractionInput = z.infer<
  typeof CreateClientInteractionSchema
>;

export const ClientQuerySchema = z.object({
  status: z.enum(CLIENT_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  unit_id: z.string().uuid().optional(),
  sector: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

export type ClientQuery = z.infer<typeof ClientQuerySchema>;

/* ------------------------------------------------------------------ */
/* Activities — the organiser's own task list (migration 018)          */
/* ------------------------------------------------------------------ */

export const CreateActivitySchema = z
  .object({
    title: z.string().trim().min(2, 'Say what needs doing').max(200),
    notes: z.string().trim().max(4000).optional(),
    priority: z.enum(ACTIVITY_PRIORITIES).default('NORMAL'),
    /** ISO date, no time — a task is due on a DAY, not at an instant. */
    due_on: z.string().date().optional(),
    assigned_to: z.string().uuid().optional(),
  })
  .strict();

export type CreateActivityInput = z.infer<typeof CreateActivitySchema>;

/**
 * Every field optional — a patch, not a replace, for the same reason as
 * UpdateClientSchema: three superusers share this list, and a full-row
 * update would let one silently revert another's change to a field it
 * never touched.
 *
 * `done` is a BOOLEAN on the wire but a TIMESTAMP in the table. The client
 * says "tick this off"; the server decides what time that was. Letting the
 * client post its own `done_at` would import whatever its clock says, and
 * these are shared phones (§3.2).
 */
export const UpdateActivitySchema = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    priority: z.enum(ACTIVITY_PRIORITIES).optional(),
    due_on: z.string().date().nullable().optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    done: z.boolean().optional(),
  })
  .strict();

export type UpdateActivityInput = z.infer<typeof UpdateActivitySchema>;

export const ActivityQuerySchema = z.object({
  /** open = not done; done = done; omitted = everything. */
  state: z.enum(['open', 'done']).optional(),
  assigned_to: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;
