import type {
  AgentClaims,
  IssueTicketInput,
  QrCodeKind,
  TicketType,
} from '@pravasi/shared';
import {
  SEATS_PER_TIER,
  TICKET_TYPE_LABELS,
  qrCodePlanFor,
} from '@pravasi/shared';
import { withTransaction } from '../../db/index.js';
import { generateQrPayload, hashQrPayload } from '../../lib/identifiers.js';
import { AppError } from '../../lib/errors.js';
import * as repo from './tickets.repository.js';

/* ------------------------------------------------------------------ */

/**
 * A QR payload, returned to the caller exactly once. The database holds only
 * `hashQrPayload(payload)`, so these values are unrecoverable after the
 * response is sent — reissuing means generating new codes.
 */
export interface IssuedQrCode {
  id: string;
  kind: QrCodeKind;
  guest_index: number | null;
  /** Raw value to encode into the printed QR. Never stored. */
  payload: string;
}

export interface IssuedTicket {
  ticket: {
    id: string;
    request_number: string;
    ticket_number: string;
    ticket_type: TicketType;
    ticket_type_label: string;
    purchaser_name: string;
    purchaser_mobile: string;
    purchaser_email: string | null;
    counted_persons: number;
    children_below_12: number;
    status: 'ACTIVE' | 'REVOKED';
    created_at: string;
  };
  qr_codes: IssuedQrCode[];
}

interface IssueContext {
  ip?: string | null;
}

const UNIQUE_VIOLATION = '23505';
const NUMBER_COLLISION_RETRIES = 5;

function isNumberCollision(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; constraint?: string };
  return (
    e.code === UNIQUE_VIOLATION &&
    (e.constraint === 'tickets_request_number_key' ||
      e.constraint === 'tickets_ticket_number_key')
  );
}

/* ------------------------------------------------------------------ */

export async function issueTicket(
  input: IssueTicketInput,
  scope: AgentClaims,
  ctx: IssueContext = {},
): Promise<IssuedTicket> {
  // Derived server-side from the tier, never read from the request. The DB
  // constraint `tickets_capacity_matches_tier` is the backstop if this is
  // ever wrong.
  const countedPersons = SEATS_PER_TIER[input.ticket_type];

  /* Numbers now come from a sequence (migration 016), which never hands the
   * same value to two callers — so the ordinary collision this loop was
   * built for cannot happen any more.
   *
   * It is kept, narrowed to its remaining job: a database that still holds
   * tickets from an older numbering scheme could contain a number the
   * sequence is about to reach. Migration 016 starts the sequence above the
   * highest existing NUMERIC number precisely to avoid that, but it cannot
   * see legacy hex/alphanumeric numbers, and a hand-inserted row could
   * collide too. Retrying simply draws the next value, which steps past the
   * obstruction — so this is now a cheap guard rather than a hot path. */
  for (let attempt = 1; attempt <= NUMBER_COLLISION_RETRIES; attempt += 1) {
    try {
      return await issueOnce(input, scope, countedPersons, ctx);
    } catch (err) {
      if (isNumberCollision(err) && attempt < NUMBER_COLLISION_RETRIES) {
        console.warn(
          `[tickets] number collision, retrying (${attempt}/${NUMBER_COLLISION_RETRIES})`,
        );
        continue;
      }
      throw err;
    }
  }

  // Unreachable: the loop either returns or throws.
  throw new AppError(
    500,
    'NUMBER_GENERATION_FAILED',
    'Could not allocate a unique ticket number',
  );
}

async function issueOnce(
  input: IssueTicketInput,
  scope: AgentClaims,
  countedPersons: number,
  ctx: IssueContext,
): Promise<IssuedTicket> {
  /* The whole fan-out is one transaction. A ticket that commits with a
   * partial set of QR codes admits the wrong number of people, which is the
   * single worst failure this system can produce. */
  return withTransaction(async (client) => {
    /* Drawn inside the transaction, from the sequences. Two agents issuing
     * in the same millisecond receive different values by construction —
     * the same "never read-then-write" rule §10.2 applies to admission. */
    const numbers = await repo.nextTicketNumbers(client);

    const ticket = await repo.insertTicket(client, {
      requestNumber: numbers.requestNumber,
      ticketNumber: numbers.ticketNumber,
      ticketType: input.ticket_type,

      // Scope comes from the JWT, never from the request body.
      agentId: scope.agentId,
      unitId: scope.unitId,
      divisionId: scope.divisionId,
      unitSessionId: scope.sessionId,

      purchaserName: input.purchaser_name,
      purchaserMobile: input.mobile_number,
      purchaserEmail: input.email ?? null,
      countedPersons,
      childrenBelow12: input.children_below_12,
    });

    // The plan is the shared one — the same function TicketReceipt renders
    // from. NORMAL -> 1 guest code; premium -> 4 guest codes + 1 location.
    const plan = qrCodePlanFor(input.ticket_type);

    const generated = plan.map((slot) => {
      const payload = generateQrPayload();
      return {
        payload,
        hash: hashQrPayload(payload),
        kind: slot.kind,
        guestIndex: slot.guestIndex,
      };
    });

    const inserted = await repo.insertQrCodes(client, ticket.id, generated);

    await repo.writeAudit(client, {
      actorId: scope.agentId,
      action: 'TICKET_ISSUED',
      entityId: ticket.id,
      metadata: {
        ticket_number: ticket.ticket_number,
        ticket_type: ticket.ticket_type,
        counted_persons: countedPersons,
        qr_code_count: generated.length,
        unit_id: scope.unitId,
      },
      ip: ctx.ip,
    });

    // Match the inserted rows back to their raw payloads. Ordering of a
    // multi-row INSERT ... RETURNING follows the VALUES order in Postgres,
    // but pairing on (kind, guest_index) is explicit and does not rely on it.
    const qrCodes: IssuedQrCode[] = generated.map((g) => {
      const row = inserted.find(
        (r) => r.code_kind === g.kind && r.guest_index === g.guestIndex,
      );

      if (!row) {
        // Cannot happen without a bug; throwing rolls the transaction back
        // rather than returning a ticket with unusable codes.
        throw new AppError(
          500,
          'QR_FANOUT_MISMATCH',
          'QR code generation did not match the inserted rows',
        );
      }

      return {
        id: row.id,
        kind: row.code_kind,
        guest_index: row.guest_index,
        payload: g.payload,
      };
    });

    return {
      ticket: {
        id: ticket.id,
        request_number: ticket.request_number,
        ticket_number: ticket.ticket_number,
        ticket_type: ticket.ticket_type,
        ticket_type_label: TICKET_TYPE_LABELS[ticket.ticket_type],
        purchaser_name: ticket.purchaser_name,
        purchaser_mobile: ticket.purchaser_mobile,
        purchaser_email: ticket.purchaser_email,
        counted_persons: ticket.counted_persons,
        children_below_12: ticket.children_below_12,
        status: ticket.status,
        created_at: ticket.created_at.toISOString(),
      },
      qr_codes: qrCodes,
    };
  });
}
