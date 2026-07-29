import {
  EVENT_DATE_LABEL,
  EVENT_NAME,
  ORGANISATION_NAME,
  TICKET_TYPE_LABELS,
  type TicketType,
} from '@pravasi/shared';

/**
 * The delivery email.
 *
 * Written for email clients, not browsers: table layout, inline styles only,
 * no flexbox, no external CSS. Outlook and Gmail strip <style> blocks, and a
 * ticket that arrives unstyled is the one the purchaser cannot read at a gate.
 *
 * The pass is attached twice over — inline via `cid:` so it renders in the
 * body, and as a downloadable attachment for clients that block images.
 */

export const TICKET_IMAGE_CID = 'pravasi-ticket-image';

const NAVY = '#0f2850';
const GOLD = '#d4af37';
const MAROON = '#800000';

export interface TicketEmailData {
  purchaserName: string;
  ticketNumber: string;
  requestNumber: string;
  ticketType: TicketType;
  countedPersons: number;
}

export function ticketEmailSubject(data: TicketEmailData): string {
  return `Your ${EVENT_NAME} e-ticket — ${data.ticketNumber}`;
}

export function ticketEmailText(data: TicketEmailData): string {
  return [
    `${data.purchaserName},`,
    '',
    `Your e-ticket for ${EVENT_NAME} has been issued.`,
    '',
    `Ticket number:  ${data.ticketNumber}`,
    `Request number: ${data.requestNumber}`,
    `Type:           ${TICKET_TYPE_LABELS[data.ticketType]}`,
    `Admits:         ${data.countedPersons} ${data.countedPersons === 1 ? 'person' : 'people'}`,
    `Date:           ${EVENT_DATE_LABEL}`,
    '',
    'Your ticket is attached. Please present the QR code at the gate.',
    'Children below 12 enter free and are not counted against this ticket.',
    '',
    ORGANISATION_NAME,
  ].join('\n');
}

export function ticketEmailHtml(data: TicketEmailData): string {
  const rows: Array<[string, string]> = [
    ['Ticket Number', data.ticketNumber],
    ['Request Number', data.requestNumber],
    ['Ticket Type', TICKET_TYPE_LABELS[data.ticketType]],
    [
      'Admits',
      `${data.countedPersons} ${data.countedPersons === 1 ? 'person' : 'people'}`,
    ],
    ['Event Date', EVENT_DATE_LABEL],
  ];

  const detailRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:7px 0;font:400 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#6b7280;">${label}</td>
          <td style="padding:7px 0;text-align:right;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111827;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(EVENT_NAME)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f9fafb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;">

            <!-- Header -->
            <tr>
              <td style="background:${NAVY};padding:26px 28px;">
                <p style="margin:0;font:600 10px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;letter-spacing:2.6px;text-transform:uppercase;color:${GOLD};">
                  ${escapeHtml(ORGANISATION_NAME)}
                </p>
                <h1 style="margin:6px 0 0;font:700 24px/1.15 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;letter-spacing:-0.4px;color:#ffffff;text-transform:uppercase;">
                  ${escapeHtml(EVENT_NAME)}
                </h1>
              </td>
            </tr>

            <!-- Greeting -->
            <tr>
              <td style="padding:28px 28px 0;">
                <p style="margin:0;font:600 17px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111827;">
                  ${escapeHtml(data.purchaserName)}, your e-ticket is ready.
                </p>
                <p style="margin:8px 0 0;font:400 14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#6b7280;">
                  Present the QR code below at the gate. The ticket is also
                  attached to this email.
                </p>
              </td>
            </tr>

            <!-- The pass -->
            <tr>
              <td style="padding:22px 28px 0;">
                <img src="cid:${TICKET_IMAGE_CID}"
                     alt="${escapeHtml(EVENT_NAME)} ticket ${escapeHtml(data.ticketNumber)}"
                     width="504"
                     style="display:block;width:100%;max-width:504px;height:auto;border-radius:12px;border:1px solid #e5e7eb;" />
              </td>
            </tr>

            <!-- Details -->
            <tr>
              <td style="padding:22px 28px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                       style="border-top:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;">
                  ${detailRows}
                </table>
              </td>
            </tr>

            <!-- Note -->
            <tr>
              <td style="padding:20px 28px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-left:3px solid ${GOLD};background:rgba(212,175,55,0.08);border-radius:10px;padding:12px 14px;">
                      <p style="margin:0;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#4b5563;">
                        Children below 12 enter free and are not counted against
                        this ticket. This ticket is non-transferable.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:24px 28px 28px;">
                <p style="margin:0;font:400 11px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#9ca3af;">
                  Issued by ${escapeHtml(ORGANISATION_NAME)}. If you did not
                  request this ticket, contact the issuing agent.
                </p>
                <p style="margin:10px 0 0;font:600 11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:${MAROON};">
                  ${escapeHtml(data.ticketNumber)}
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Ticket data is agent-entered free text; it must never reach the DOM raw. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
