import type { PoolClient } from 'pg';
import type { QrCodeKind, TicketType } from '@pravasi/shared';
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
