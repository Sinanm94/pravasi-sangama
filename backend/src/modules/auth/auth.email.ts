import { EVENT_NAME, ORGANISATION_NAME } from '@pravasi/shared';
import { env } from '../../config/env.js';

/**
 * The password-reset email.
 *
 * Same constraints as the ticket email: table layout, inline styles only,
 * no external CSS. Gmail and Outlook strip <style> blocks.
 *
 * Brand violet rather than the navy/gold in tickets.email.ts — that file
 * predates the palette change (§5.3) and is a separate cleanup; nothing new
 * should be written in the retired colours.
 */

const VIOLET = '#5E17EB';
const VIOLET_DEEP = '#37098C';

export interface PasswordResetEmailData {
  agentName: string;
  token: string;
  expiresAt: Date;
}

/** The link the agent clicks. `/login/reset` reads `?token=`. */
function resetUrl(token: string): string {
  return `${env.APP_URL}/login/reset?token=${encodeURIComponent(token)}`;
}

/**
 * Minutes remaining, rounded. Shown rather than a timestamp: a volunteer
 * reading this may be in a different timezone from the server, and "expires
 * in 30 minutes" needs no conversion to act on.
 */
function minutesUntil(expiresAt: Date): number {
  return Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
}

export function passwordResetSubject(): string {
  return `Reset your ${EVENT_NAME} agent password`;
}

export function passwordResetText(data: PasswordResetEmailData): string {
  return [
    `${data.agentName},`,
    '',
    'Someone asked to reset the password for your agent account.',
    '',
    'Open this link to choose a new one:',
    resetUrl(data.token),
    '',
    `The link expires in ${minutesUntil(data.expiresAt)} minutes and can be`,
    'used only once.',
    '',
    'If you did not ask for this, ignore this email — your password will',
    'not change. If this inbox is shared with other agents, tell your unit',
    'head, who can reset your password directly instead.',
    '',
    ORGANISATION_NAME,
  ].join('\n');
}

export function passwordResetHtml(data: PasswordResetEmailData): string {
  const url = resetUrl(data.token);
  const minutes = minutesUntil(data.expiresAt);

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f5f7;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:${VIOLET_DEEP};padding:24px 28px;">
                <div style="color:#ffffff;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;">${ORGANISATION_NAME}</div>
                <div style="color:#ffffff;font-size:20px;font-weight:bold;padding-top:6px;">${EVENT_NAME}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#111111;">
                  ${escapeHtml(data.agentName)},
                </p>
                <p style="margin:0 0 20px;font-size:15px;line-height:22px;color:#333333;">
                  Someone asked to reset the password for your agent account.
                  Choose a new one using the button below.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
                  <tr>
                    <td style="background:${VIOLET};border-radius:12px;">
                      <a href="${url}"
                         style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;">
                        Set a new password
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 20px;font-size:13px;line-height:20px;color:#666666;">
                  This link expires in <strong>${minutes} minutes</strong> and can be used only once.
                  If the button does not work, copy this address into your browser:
                </p>
                <p style="margin:0 0 24px;font-size:12px;line-height:18px;color:${VIOLET};word-break:break-all;">
                  ${url}
                </p>

                <div style="border-top:1px solid #e6e6e6;padding-top:18px;">
                  <p style="margin:0;font-size:12px;line-height:19px;color:#888888;">
                    If you did not ask for this, ignore this email — your password will not change.
                    <br /><br />
                    <strong>Sharing this inbox with other agents?</strong> Anyone who can read it can
                    open this link. Ask your unit head to reset your password directly instead.
                  </p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** The agent's name is user-supplied at signup and lands in HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
