import { z } from 'zod';
/**
 * Wire contracts. Field names are snake_case to match the Postgres columns —
 * the frontend maps its camelCase form state at the boundary, in one place,
 * rather than the API accepting two spellings of everything.
 */
export declare const UnitLoginSchema: z.ZodObject<{
    unit_code: z.ZodEffects<z.ZodString, string, string>;
    pin: z.ZodString;
    /**
     * Unit codes are unique per division, not globally (see the
     * `units_division_code_key` constraint). Optional here: only required when
     * the same code exists in more than one division, in which case the API
     * replies AMBIGUOUS_UNIT_CODE and the client re-submits with it.
     */
    division_code: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, "strip", z.ZodTypeAny, {
    unit_code: string;
    pin: string;
    division_code?: string | undefined;
}, {
    unit_code: string;
    pin: string;
    division_code?: string | undefined;
}>;
export type UnitLoginInput = z.infer<typeof UnitLoginSchema>;
export declare const AgentLoginSchema: z.ZodObject<{
    mobile_number: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    mobile_number: string;
    password: string;
}, {
    mobile_number: string;
    password: string;
}>;
export type AgentLoginInput = z.infer<typeof AgentLoginSchema>;
/** Spec §4: superusers are identified by email, and there are exactly three. */
export declare const SuperuserLoginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    password: string;
    email: string;
}, {
    password: string;
    email: string;
}>;
export type SuperuserLoginInput = z.infer<typeof SuperuserLoginSchema>;
export declare const AgentSignupSchema: z.ZodEffects<z.ZodObject<{
    name: z.ZodString;
    /** Agent ID *is* the mobile number. */
    mobile_number: z.ZodString;
    email: z.ZodString;
    /**
     * Units survive self-registration, so a signup must name one: every
     * ticket carries `unit_id` and `division_id` (§2), and step 1 of login
     * compares the agent's unit against the authenticated location. The unit
     * *code* is not a secret — the unit PIN is.
     */
    unit_code: z.ZodEffects<z.ZodString, string, string>;
    password: z.ZodString;
    confirm_password: z.ZodString;
}, "strict", z.ZodTypeAny, {
    unit_code: string;
    mobile_number: string;
    password: string;
    email: string;
    name: string;
    confirm_password: string;
}, {
    unit_code: string;
    mobile_number: string;
    password: string;
    email: string;
    name: string;
    confirm_password: string;
}>, {
    unit_code: string;
    mobile_number: string;
    password: string;
    email: string;
    name: string;
    confirm_password: string;
}, {
    unit_code: string;
    mobile_number: string;
    password: string;
    email: string;
    name: string;
    confirm_password: string;
}>;
export type AgentSignupInput = z.infer<typeof AgentSignupSchema>;
export declare const ForgotPasswordSchema: z.ZodObject<{
    email: z.ZodString;
}, "strict", z.ZodTypeAny, {
    email: string;
}, {
    email: string;
}>;
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;
export declare const ResetPasswordSchema: z.ZodEffects<z.ZodObject<{
    token: z.ZodString;
    password: z.ZodString;
    confirm_password: z.ZodString;
}, "strict", z.ZodTypeAny, {
    password: string;
    confirm_password: string;
    token: string;
}, {
    password: string;
    confirm_password: string;
    token: string;
}>, {
    password: string;
    confirm_password: string;
    token: string;
}, {
    password: string;
    confirm_password: string;
    token: string;
}>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
export declare const GateLoginSchema: z.ZodObject<{
    gate_code: z.ZodEffects<z.ZodString, string, string>;
    pin: z.ZodString;
}, "strict", z.ZodTypeAny, {
    pin: string;
    gate_code: string;
}, {
    pin: string;
    gate_code: string;
}>;
export type GateLoginInput = z.infer<typeof GateLoginSchema>;
export declare const CreateGateSchema: z.ZodObject<{
    gate_code: z.ZodEffects<z.ZodString, string, string>;
    name: z.ZodString;
    division_code: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    pin: z.ZodString;
    /** ISO date. Set it for a PIN that must stop working after event day. */
    pin_valid_on: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    pin: string;
    name: string;
    gate_code: string;
    division_code?: string | undefined;
    pin_valid_on?: string | undefined;
}, {
    pin: string;
    name: string;
    gate_code: string;
    division_code?: string | undefined;
    pin_valid_on?: string | undefined;
}>;
export type CreateGateInput = z.infer<typeof CreateGateSchema>;
export declare const RotateGatePinSchema: z.ZodObject<{
    pin: z.ZodString;
    pin_valid_on: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    pin: string;
    pin_valid_on?: string | undefined;
}, {
    pin: string;
    pin_valid_on?: string | undefined;
}>;
export type RotateGatePinInput = z.infer<typeof RotateGatePinSchema>;
export declare const AgentDecisionSchema: z.ZodObject<{
    decision: z.ZodEnum<["APPROVED", "REJECTED"]>;
    reason: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    decision: "APPROVED" | "REJECTED";
    reason?: string | undefined;
}, {
    decision: "APPROVED" | "REJECTED";
    reason?: string | undefined;
}>;
export type AgentDecisionInput = z.infer<typeof AgentDecisionSchema>;
/**
 * NOTE what is absent: `counted_persons`, `request_number`, `ticket_number`,
 * `agent_id`, `unit_id`. All are derived server-side.
 *
 * A client that posts `{ ticket_type: 'NORMAL', counted_persons: 4 }` must not
 * merely be rejected — the field must never be readable from the request in
 * the first place. `.strict()` makes an unknown key a validation error rather
 * than silently ignored input.
 */
export declare const IssueTicketSchema: z.ZodObject<{
    purchaser_name: z.ZodString;
    mobile_number: z.ZodString;
    email: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodEffects<z.ZodLiteral<"">, undefined, "">]>;
    ticket_type: z.ZodEnum<["NORMAL", "VIP", "VVIP", "SVIP"]>;
    /** Free, and excluded from ticket capacity. Headcount only. */
    children_below_12: z.ZodDefault<z.ZodNumber>;
    notes: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    mobile_number: string;
    purchaser_name: string;
    ticket_type: "NORMAL" | "VIP" | "VVIP" | "SVIP";
    children_below_12: number;
    email?: string | undefined;
    notes?: string | undefined;
}, {
    mobile_number: string;
    purchaser_name: string;
    ticket_type: "NORMAL" | "VIP" | "VVIP" | "SVIP";
    email?: string | undefined;
    children_below_12?: number | undefined;
    notes?: string | undefined;
}>;
export type IssueTicketInput = z.infer<typeof IssueTicketSchema>;
/** Roughly 9MB of PNG once base64 expands it by ~33%. */
export declare const MAX_TICKET_IMAGE_BASE64 = 12000000;
export declare const ShareTicketEmailSchema: z.ZodObject<{
    ticket_id: z.ZodString;
    email_address: z.ZodString;
    /**
     * The rendered pass, as a data URL or bare base64. Sent by the client
     * rather than re-rendered server-side: headless Chrome on the API just to
     * redraw a pass the agent is already looking at is a lot of infrastructure
     * for no gain in fidelity.
     */
    base64_image: z.ZodString;
}, "strict", z.ZodTypeAny, {
    ticket_id: string;
    email_address: string;
    base64_image: string;
}, {
    ticket_id: string;
    email_address: string;
    base64_image: string;
}>;
export type ShareTicketEmailInput = z.infer<typeof ShareTicketEmailSchema>;
export declare const VerifyScanSchema: z.ZodObject<{
    /** The raw value read off the QR. Hashed server-side before any lookup. */
    payload: z.ZodString;
    /**
     * Client-generated at capture time, before any network call. Makes the
     * request idempotent: a retry after a lost response returns the original
     * result instead of re-running the admission and reporting DUPLICATE
     * against itself. See CLAUDE.md §10.4.
     */
    client_scan_id: z.ZodOptional<z.ZodString>;
    gate_label: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    payload: string;
    client_scan_id?: string | undefined;
    gate_label?: string | undefined;
}, {
    payload: string;
    client_scan_id?: string | undefined;
    gate_label?: string | undefined;
}>;
export type VerifyScanInput = z.infer<typeof VerifyScanSchema>;
/**
 * Offline queue drain. Unlike /verify, `client_scan_id` is REQUIRED — a
 * replayed batch with no idempotency key would double-record admissions.
 *
 * `offline_scanned_at` is the client's capture time. It orders the batch and
 * becomes `scan_logs.created_at`, so analytics reflect when people physically
 * walked through the gate rather than when the network came back.
 */
export declare const BulkSyncScanSchema: z.ZodObject<{
    payload: z.ZodString;
    client_scan_id: z.ZodString;
    offline_scanned_at: z.ZodString;
    gate_label: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    payload: string;
    client_scan_id: string;
    offline_scanned_at: string;
    gate_label?: string | undefined;
}, {
    payload: string;
    client_scan_id: string;
    offline_scanned_at: string;
    gate_label?: string | undefined;
}>;
export type BulkSyncScanInput = z.infer<typeof BulkSyncScanSchema>;
export declare const BULK_SYNC_MAX_BATCH = 200;
export declare const BulkSyncSchema: z.ZodObject<{
    scans: z.ZodArray<z.ZodObject<{
        payload: z.ZodString;
        client_scan_id: z.ZodString;
        offline_scanned_at: z.ZodString;
        gate_label: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        payload: string;
        client_scan_id: string;
        offline_scanned_at: string;
        gate_label?: string | undefined;
    }, {
        payload: string;
        client_scan_id: string;
        offline_scanned_at: string;
        gate_label?: string | undefined;
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    scans: {
        payload: string;
        client_scan_id: string;
        offline_scanned_at: string;
        gate_label?: string | undefined;
    }[];
}, {
    scans: {
        payload: string;
        client_scan_id: string;
        offline_scanned_at: string;
        gate_label?: string | undefined;
    }[];
}>;
export type BulkSyncInput = z.infer<typeof BulkSyncSchema>;
export declare const TicketSearchSchema: z.ZodObject<{
    /** REQ number, TKT number, or 10-digit mobile — resolved server-side. */
    q: z.ZodString;
}, "strip", z.ZodTypeAny, {
    q: string;
}, {
    q: string;
}>;
export type TicketSearchInput = z.infer<typeof TicketSearchSchema>;
//# sourceMappingURL=schemas.d.ts.map