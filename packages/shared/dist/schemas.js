import { z } from 'zod';
import { AGENT_PASSWORD_MIN_LENGTH, GATE_PIN_MAX_LENGTH, GATE_PIN_MIN_LENGTH, MOBILE_NUMBER_REGEX, TICKET_TYPES, } from './constants.js';
/**
 * Wire contracts. Field names are snake_case to match the Postgres columns —
 * the frontend maps its camelCase form state at the boundary, in one place,
 * rather than the API accepting two spellings of everything.
 */
/* ------------------------------------------------------------------ */
/* Auth — step 1: unit location                                        */
/* ------------------------------------------------------------------ */
export const UnitLoginSchema = z.object({
    unit_code: z
        .string()
        .trim()
        .min(1, 'Unit code is required')
        .max(32)
        .transform((v) => v.toUpperCase()),
    pin: z.string().min(4, 'PIN must be at least 4 characters').max(128),
    /**
     * Unit codes are unique per division, not globally (see the
     * `units_division_code_key` constraint). Optional here: only required when
     * the same code exists in more than one division, in which case the API
     * replies AMBIGUOUS_UNIT_CODE and the client re-submits with it.
     */
    division_code: z
        .string()
        .trim()
        .max(32)
        .transform((v) => v.toUpperCase())
        .optional(),
});
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
     */
    unit_code: z
        .string()
        .trim()
        .min(1, 'Unit code is required')
        .max(32)
        .transform((v) => v.toUpperCase()),
    password: z
        .string()
        .min(AGENT_PASSWORD_MIN_LENGTH, `Password must be at least ${AGENT_PASSWORD_MIN_LENGTH} characters`)
        .max(128),
    confirm_password: z.string(),
})
    .strict()
    .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
});
/* ------------------------------------------------------------------ */
/* Password reset (spec §3)                                            */
/* ------------------------------------------------------------------ */
export const ForgotPasswordSchema = z
    .object({
    email: z
        .string()
        .trim()
        .toLowerCase()
        .email('Enter a valid email address')
        .max(180),
})
    .strict();
export const ResetPasswordSchema = z
    .object({
    token: z.string().trim().min(16).max(256),
    password: z
        .string()
        .min(AGENT_PASSWORD_MIN_LENGTH, `Password must be at least ${AGENT_PASSWORD_MIN_LENGTH} characters`)
        .max(128),
    confirm_password: z.string(),
})
    .strict()
    .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
});
/* ------------------------------------------------------------------ */
/* Gate scanner login (spec §2, Option A)                              */
/* ------------------------------------------------------------------ */
const gatePin = z
    .string()
    .trim()
    .regex(new RegExp(`^[0-9]{${GATE_PIN_MIN_LENGTH},${GATE_PIN_MAX_LENGTH}}$`), `PIN must be ${GATE_PIN_MIN_LENGTH}–${GATE_PIN_MAX_LENGTH} digits`);
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
export const RotateGatePinSchema = z
    .object({
    pin: gatePin,
    pin_valid_on: z.string().date().optional(),
})
    .strict();
export const AgentDecisionSchema = z
    .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().max(300).optional(),
})
    .strict();
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
export const BULK_SYNC_MAX_BATCH = 200;
export const BulkSyncSchema = z
    .object({
    scans: z
        .array(BulkSyncScanSchema)
        .min(1, 'At least one scan is required')
        .max(BULK_SYNC_MAX_BATCH, `Send at most ${BULK_SYNC_MAX_BATCH} scans per request`),
})
    .strict();
/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */
export const TicketSearchSchema = z.object({
    /** REQ number, TKT number, or 10-digit mobile — resolved server-side. */
    q: z.string().trim().min(3, 'Enter at least 3 characters').max(64),
});
//# sourceMappingURL=schemas.js.map