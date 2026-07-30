import { EVENT_NAME, ORGANISATION_NAME } from '@pravasi/shared';
import { env } from '../../config/env.js';
import { sendMail } from '../../lib/mailer.js';

/**
 * Password-reset email.
 *
 * Table layout and inline styles only, same reasoning as the ticket email:
 * Gmail and Outlook strip `<style>` blocks, and a reset link an agent cannot
 * find is a support call on event day.
 */

const NAVY = '#062B59';
const GOLD = '#D4AF37';

export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  token: string;
}): Promise<void> {
  const link = `${env.APP_URL.replace(/\/$/, '')}/login/reset?token=${encodeURIComponent(params.token)}`;

  await sendMail({
    to: params.to,
    subject: `Reset your ${EVENT_NAME} agent password`,
    text: [
      `${params.name},`,
      '',
      `Use this link to set a new password for your ${EVENT_NAME} agent account:`,
      link,
      '',
      'The link expires in 60 minutes and can be used once.',
      'If you did not request this, ignore this email — nothing has changed.',
      '',
      ORGANISATION_NAME,
    ].join('\n'),
    html: `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f9fafb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;">
          <tr>
            <td style="background:${NAVY};padding:24px 28px;">
              <p style="margin:0;font:600 10px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;letter-spacing:2.6px;text-transform:uppercase;color:${GOLD};">
                ${escapeHtml(ORGANISATION_NAME)}
              </p>
              <h1 style="margin:6px 0 0;font:700 21px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#ffffff;text-transform:uppercase;letter-spacing:-0.3px;">
                ${escapeHtml(EVENT_NAME)}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0;font:600 16px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111827;">
                ${escapeHtml(params.name)}, reset your password
              </p>
              <p style="margin:8px 0 0;font:400 14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#6b7280;">
                Tap the button to choose a new password for your agent account.
              </p>

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;">
                <tr><td style="border-radius:14px;background:${NAVY};">
                  <a href="${link}"
                     style="display:inline-block;padding:14px 26px;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase;">
                    Set New Password
                  </a>
                </td></tr>
              </table>

              <p style="margin:20px 0 0;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#9ca3af;word-break:break-all;">
                Or paste this into your browser:<br />${link}
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
                <tr><td style="border-left:3px solid ${GOLD};background:rgba(212,175,55,0.08);border-radius:10px;padding:12px 14px;">
                  <p style="margin:0;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#4b5563;">
                    This link expires in 60 minutes and works once. If you did
                    not request it, ignore this email — nothing has changed.
                  </p>
                </td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
