import nodemailer from 'nodemailer';
import { env, isProduction } from '../config/env.js';
import { AppError } from './errors.js';
/**
 * SMTP transport.
 *
 * Credentials are optional. Without them:
 *   development — the message is logged and reported as sent, so the whole
 *                 share flow is testable before SMTP exists.
 *   production  — a hard 503. Silently swallowing a ticket the purchaser is
 *                 waiting for is the worse failure.
 */
let transporter = null;
export function isMailConfigured() {
    return Boolean(env.SMTP_HOST && env.MAIL_FROM);
}
function getTransport() {
    if (transporter)
        return transporter;
    transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE, // true for 465, false for 587 + STARTTLS
        auth: env.SMTP_USER && env.SMTP_PASS
            ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
            : undefined,
        // A gate desk should not sit on a hung connection.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
    });
    return transporter;
}
export async function sendMail(params) {
    if (!isMailConfigured()) {
        if (isProduction) {
            throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Email delivery is not configured on this server.');
        }
        console.warn(`[mail] SMTP not configured — simulated send\n` +
            `      to:      ${params.to}\n` +
            `      subject: ${params.subject}\n` +
            `      attach:  ${params.attachments?.map((a) => a.filename).join(', ') || 'none'}`);
        return { delivered: true, messageId: null, simulated: true };
    }
    const info = await getTransport().sendMail({
        from: env.MAIL_FROM,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        attachments: params.attachments,
    });
    return { delivered: true, messageId: info.messageId ?? null };
}
export async function closeMailer() {
    transporter?.close();
    transporter = null;
}
//# sourceMappingURL=mailer.js.map