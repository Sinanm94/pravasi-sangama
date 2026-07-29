import { query } from '../../db/index.js';
export async function insertTicket(client, params) {
    const { rows } = await client.query(`INSERT INTO tickets (
       request_number, ticket_number, ticket_type,
       agent_id, unit_id, division_id, unit_session_id,
       purchaser_name, purchaser_mobile, purchaser_email,
       counted_persons, children_below_12
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, request_number, ticket_number, ticket_type,
               agent_id, unit_id, division_id,
               purchaser_name, purchaser_mobile, purchaser_email,
               counted_persons, children_below_12, status, created_at`, [
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
    ]);
    return rows[0];
}
/**
 * All codes for a ticket in one statement. A partial insert would leave a
 * ticket that admits the wrong number of people, so this never runs outside
 * the issuance transaction.
 */
export async function insertQrCodes(client, ticketId, codes) {
    const values = [ticketId];
    const tuples = codes.map((code, i) => {
        const base = i * 3 + 2;
        values.push(code.hash, code.kind, code.guestIndex);
        return `($1, $${base}, $${base + 1}::qr_code_kind, $${base + 2}::SMALLINT)`;
    });
    const { rows } = await client.query(`INSERT INTO qr_codes (ticket_id, qr_hash, code_kind, guest_index)
     VALUES ${tuples.join(', ')}
     RETURNING id, code_kind, guest_index, status`, values);
    return rows;
}
/**
 * Scoped to the caller's unit. An agent may only share tickets their own unit
 * issued — without the unit predicate, a valid agent could enumerate ticket
 * UUIDs and mail other units' tickets anywhere.
 */
export async function findTicketForShare(ticketId, unitId) {
    const { rows } = await query(`SELECT id, request_number, ticket_number, ticket_type,
            purchaser_name, purchaser_email, counted_persons, status
       FROM tickets
      WHERE id = $1 AND unit_id = $2`, [ticketId, unitId]);
    return rows[0] ?? null;
}
export async function recordEmailDelivery(ticketId, email) {
    // Backfills the address when the purchaser gave one only at share time, so
    // a reissue can reach them without asking again.
    await query(`UPDATE tickets
        SET purchaser_email = COALESCE(purchaser_email, $2)
      WHERE id = $1`, [ticketId, email]);
}
export async function writeAudit(client, params) {
    await client.query(`INSERT INTO audit_logs
       (actor_role, actor_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES ('AGENT', $1, $2, 'ticket', $3, $4, $5)`, [
        params.actorId,
        params.action,
        params.entityId,
        JSON.stringify(params.metadata ?? {}),
        params.ip ?? null,
    ]);
}
//# sourceMappingURL=tickets.repository.js.map