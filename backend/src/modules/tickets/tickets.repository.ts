import type { PoolClient } from 'pg';
import {
  REQUEST_NUMBER_LENGTH,
  REQUEST_NUMBER_PREFIX,
  TICKET_NUMBER_LENGTH,
  TICKET_NUMBER_PREFIX,
  type QrCodeKind,
  type TicketStatus,
  type TicketType,
} from '@pravasi/shared';
import { query } from '../../db/index.js';

export interface TicketRow {
  id: string;
  request_number: string;
  ticket_number: string;
  ticket_type: TicketType;
  agent_id: string;
  unit_id: string;
  division_id: string;
  purchaser_name: string;
  purchaser_mobile: string;
  purchaser_email: string | null;
  counted_persons: number;
  children_below_12: number;
  status: 'ACTIVE' | 'REVOKED';
  created_at: Date;
}

export interface QrCodeRow {
  id: string;
  code_kind: QrCodeKind;
  guest_index: number | null;
  status: 'ISSUED' | 'SCANNED' | 'REVOKED';
}

/**
 * Draws the next request/ticket number pair from the sequences
 * (migration 016).
 *
 * Both come from ONE round trip, and both are drawn inside the caller's
 * transaction. `nextval` is safe under concurrency by construction — two
 * agents issuing simultaneously can never receive the same value — which is
 * why this is a sequence rather than `SELECT MAX(...) + 1`, a pattern that
 * races exactly the way §10.2 warns about for admission.
 *
 * Sequences deliberately do not roll back: if the surrounding transaction
 * aborts, the drawn numbers are simply never used and the series has a gap.
 * A gap is harmless; a reused number is two tickets with one identity.
 *
 * Zero-padded to REQUEST/TICKET_NUMBER_LENGTH so the printed width is
 * fixed — leading zeros are significant (§4.4), so ticket 41 is TKT-0041.
 *
 * ⚠ NOT `LPAD`. Postgres' LPAD TRUNCATES when the input is longer than the
 * target width — `LPAD('687223', 4, '0')` returns `'6872'`, silently. That
 * is catastrophic here rather than merely ugly: truncation is not
 * injective, so two different sequence values can collapse to the same
 * printed number and the uniqueness the sequence exists to guarantee is
 * destroyed on the way out. It also made the numbers LOOK random, because
 * the visible digits were the tail of a much larger counter.
 *
 * `to_char(n, 'FM0000')` pads to the width and, crucially, GROWS past it
 * rather than cutting — 10000 renders as `10000`, not `0000`. The number
 * gets one character wider and stays correct, which is the right failure
 * direction for an identifier.
 *
 * The format string is built from the length constant rather than
 * hardcoded, so raising REQUEST/TICKET_NUMBER_LENGTH in packages/shared
 * remains the only edit needed (§4.5).
 */
export async function nextTicketNumbers(
  client: PoolClient,
): Promise<{ requestNumber: string; ticketNumber: string }> {
  const reqFormat = `FM${'0'.repeat(REQUEST_NUMBER_LENGTH)}`;
  const tktFormat = `FM${'0'.repeat(TICKET_NUMBER_LENGTH)}`;

  const { rows } = await client.query<{
    request_number: string;
    ticket_number: string;
  }>(
    `SELECT $1::text || to_char(nextval('request_number_seq'), $2)
              AS request_number,
            $3::text || to_char(nextval('ticket_number_seq'), $4)
              AS ticket_number`,
    [REQUEST_NUMBER_PREFIX, reqFormat, TICKET_NUMBER_PREFIX, tktFormat],
  );

  const row = rows[0]!;
  return {
    requestNumber: row.request_number,
    ticketNumber: row.ticket_number,
  };
}

export async function insertTicket(
  client: PoolClient,
  params: {
    requestNumber: string;
    ticketNumber: string;
    ticketType: TicketType;
    agentId: string;
    unitId: string;
    divisionId: string;
    unitSessionId: string | null;
    purchaserName: string;
    purchaserMobile: string;
    purchaserEmail: string | null;
    countedPersons: number;
    childrenBelow12: number;
  },
): Promise<TicketRow> {
  const { rows } = await client.query<TicketRow>(
    `INSERT INTO tickets (
       request_number, ticket_number, ticket_type,
       agent_id, unit_id, division_id, unit_session_id,
       purchaser_name, purchaser_mobile, purchaser_email,
       counted_persons, children_below_12
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, request_number, ticket_number, ticket_type,
               agent_id, unit_id, division_id,
               purchaser_name, purchaser_mobile, purchaser_email,
               counted_persons, children_below_12, status, created_at`,
    [
      params.requestNumber,
      params.ticketNumber,
      params.ticketType,
      params.agentId,
      params.unitId,
      params.divisionId,
      params.unitSessionId,
      params.purchaserName,
      params.purchaserMobile,
      params.purchaserEmail,
      params.countedPersons,
      params.childrenBelow12,
    ],
  );

  return rows[0]!;
}

/**
 * All codes for a ticket in one statement. A partial insert would leave a
 * ticket that admits the wrong number of people, so this never runs outside
 * the issuance transaction.
 */
export async function insertQrCodes(
  client: PoolClient,
  ticketId: string,
  codes: ReadonlyArray<{
    hash: string;
    kind: QrCodeKind;
    guestIndex: number | null;
  }>,
): Promise<QrCodeRow[]> {
  const values: unknown[] = [ticketId];
  const tuples = codes.map((code, i) => {
    const base = i * 3 + 2;
    values.push(code.hash, code.kind, code.guestIndex);
    return `($1, $${base}, $${base + 1}::qr_code_kind, $${base + 2}::SMALLINT)`;
  });

  const { rows } = await client.query<QrCodeRow>(
    `INSERT INTO qr_codes (ticket_id, qr_hash, code_kind, guest_index)
     VALUES ${tuples.join(', ')}
     RETURNING id, code_kind, guest_index, status`,
    values,
  );

  return rows;
}

export interface ShareableTicketRow {
  id: string;
  request_number: string;
  ticket_number: string;
  ticket_type: TicketType;
  purchaser_name: string;
  purchaser_email: string | null;
  counted_persons: number;
  status: 'ACTIVE' | 'REVOKED';
}

/**
 * Scoped to the caller's unit. An agent may only share tickets their own unit
 * issued — without the unit predicate, a valid agent could enumerate ticket
 * UUIDs and mail other units' tickets anywhere.
 */
export async function findTicketForShare(
  ticketId: string,
  unitId: string,
): Promise<ShareableTicketRow | null> {
  const { rows } = await query<ShareableTicketRow>(
    `SELECT id, request_number, ticket_number, ticket_type,
            purchaser_name, purchaser_email, counted_persons, status
       FROM tickets
      WHERE id = $1 AND unit_id = $2`,
    [ticketId, unitId],
  );
  return rows[0] ?? null;
}

export async function recordEmailDelivery(
  ticketId: string,
  email: string,
): Promise<void> {
  // Backfills the address when the purchaser gave one only at share time, so
  // a reissue can reach them without asking again.
  await query(
    `UPDATE tickets
        SET purchaser_email = COALESCE(purchaser_email, $2)
      WHERE id = $1`,
    [ticketId, email],
  );
}

export async function writeAudit(
  client: PoolClient,
  params: {
    actorId: string;
    action: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    ip?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs
       (actor_role, actor_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES ('AGENT', $1, $2, 'ticket', $3, $4, $5)`,
    [
      params.actorId,
      params.action,
      params.entityId,
      JSON.stringify(params.metadata ?? {}),
      params.ip ?? null,
    ],
  );
}

/* ------------------------------------------------------------------ */
/* An agent's own ledger                                               */
/* ------------------------------------------------------------------ */

export interface AgentTicketRow {
  id: string;
  request_number: string;
  ticket_number: string;
  ticket_type: TicketType;
  purchaser_name: string;
  purchaser_mobile: string;
  purchaser_email: string | null;
  counted_persons: number;
  children_below_12: number;
  status: TicketStatus;
  created_at: Date;
}

/**
 * Every ticket this agent issued, newest first.
 *
 * `agent_id = $1` is the whole authorization story and it comes from the
 * verified token, never the request body — §2. There is deliberately no
 * unit-wide or division-wide variant here: an agent sees their own
 * registrations, nothing else.
 *
 * Runs on idx_tickets_agent_created, so the ORDER BY is an index read.
 */
export async function listTicketsByAgent(
  agentId: string,
  limit = 500,
): Promise<AgentTicketRow[]> {
  const { rows } = await query<AgentTicketRow>(
    `SELECT id, request_number, ticket_number, ticket_type,
            purchaser_name, purchaser_mobile, purchaser_email,
            counted_persons, children_below_12, status, created_at
       FROM tickets
      WHERE agent_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [agentId, limit],
  );
  return rows;
}

/* ------------------------------------------------------------------ */
/* Reissue — shared by the superuser reprint and the agent's own       */
/* ------------------------------------------------------------------ */

/**
 * The agent's own ticket, or null.
 *
 * `agent_id = $2` is the whole authorization story, and it is in the WHERE
 * clause rather than checked afterwards — a ticket belonging to another
 * agent matches zero rows, so "not found" and "not yours" are the same
 * answer and neither can be probed for.
 */
export async function findTicketForAgent(
  ticketId: string,
  agentId: string,
): Promise<{ id: string; ticket_number: string; ticket_type: TicketType; status: 'ACTIVE' | 'REVOKED' } | null> {
  const { rows } = await query<{
    id: string;
    ticket_number: string;
    ticket_type: TicketType;
    status: 'ACTIVE' | 'REVOKED';
  }>(
    `SELECT id, ticket_number, ticket_type, status
       FROM tickets
      WHERE id = $1 AND agent_id = $2`,
    [ticketId, agentId],
  );
  return rows[0] ?? null;
}
