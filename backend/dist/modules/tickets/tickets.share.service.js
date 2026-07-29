import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { sendMail } from '../../lib/mailer.js';
import { query } from '../../db/index.js';
import { TICKET_IMAGE_CID, ticketEmailHtml, ticketEmailSubject, ticketEmailText, } from './tickets.email.js';
import * as repo from './tickets.repository.js';
/** Accepts a data URL or bare base64; returns PNG bytes. */
function decodeImage(input) {
    const base64 = input.startsWith('data:')
        ? (input.split(',')[1] ?? '')
        : input;
    if (!base64)
        throw badRequest('Ticket image is malformed');
    const buffer = Buffer.from(base64, 'base64');
    // A PNG always starts \x89PNG. Catches a truncated upload or a client
    // sending something other than what it claims.
    const isPng = buffer.length > 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47;
    if (!isPng)
        throw badRequest('Ticket image must be a PNG');
    return buffer;
}
export async function shareTicketByEmail(input, scope) {
    // Unit-scoped lookup: authorization comes from the token, never the body.
    const ticket = await repo.findTicketForShare(input.ticket_id, scope.unitId);
    if (!ticket) {
        throw notFound('Ticket not found for this unit');
    }
    if (ticket.status === 'REVOKED') {
        throw forbidden('This ticket has been revoked and cannot be shared');
    }
    const image = decodeImage(input.base64_image);
    const data = {
        purchaserName: ticket.purchaser_name,
        ticketNumber: ticket.ticket_number,
        requestNumber: ticket.request_number,
        ticketType: ticket.ticket_type,
        countedPersons: ticket.counted_persons,
    };
    const result = await sendMail({
        to: input.email_address,
        subject: ticketEmailSubject(data),
        text: ticketEmailText(data),
        html: ticketEmailHtml(data),
        attachments: [
            {
                filename: `PRAVASI-SANGAMA-2026-${ticket.ticket_number}.png`,
                content: image,
                contentType: 'image/png',
                cid: TICKET_IMAGE_CID, // renders inline AND downloads
            },
        ],
    });
    await repo.recordEmailDelivery(ticket.id, input.email_address);
    await query(`INSERT INTO audit_logs
       (actor_role, actor_id, action, entity_type, entity_id, metadata)
     VALUES ('AGENT', $1, 'TICKET_EMAILED', 'ticket', $2, $3)`, [
        scope.agentId,
        ticket.id,
        JSON.stringify({
            email: input.email_address,
            ticket_number: ticket.ticket_number,
            simulated: result.simulated ?? false,
        }),
    ]);
    return {
        delivered: result.delivered,
        simulated: result.simulated,
        email: input.email_address,
    };
}
//# sourceMappingURL=tickets.share.service.js.map