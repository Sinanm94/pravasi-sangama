import nodemailer, { type Transporter } from 'nodemailer';
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

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.MAIL_FROM);
}

function getTransport(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE, // true for 465, false for 587 + STARTTLS
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
    // A gate desk should not sit on a hung connection.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return transporter;
}

/** nodemailer's shape for a failed SMTP operation. */
interface SmtpError {
  code?: string;
  responseCode?: number;
  response?: string;
  message?: string;
}

/**
 * Turns an SMTP failure into something the operator can act on.
 *
 * Shared by the send path and /api/health/mail so the two can never
 * disagree about what a given failure means.
 */
function smtpHint(e: SmtpError): string {
  if (e.code === 'EAUTH' || e.responseCode === 535)
    return 'the mail server rejected the login';
  if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT')
    return 'the mail server did not respond';
  if (e.code === 'EENVELOPE')
    return 'the sender or recipient address was rejected';
  return 'the mail server refused the message';
}

/**
 * Opens a real connection and authenticates, without sending anything.
 *
 * Never throws — the caller is a health endpoint, and an unreachable mail
 * server is the ANSWER there, not an error.
 */
export async function verifyMailTransport(): Promise<{
  ok: boolean;
  error?: string;
  hint?: string;
}> {
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (err: unknown) {
    const e = err as SmtpError;
    console.error(
      `[mail] verify failed against ${env.SMTP_HOST}:${env.SMTP_PORT} ` +
        `secure=${env.SMTP_SECURE} — ${e.code ?? '?'} ${e.message ?? String(err)}`,
    );
    return {
      ok: false,
      error: `${e.code ?? 'ERROR'}: ${e.message ?? String(err)}`,
      hint: smtpHint(e),
    };
  }
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Referenced from the HTML as `cid:<this>` so it renders inline. */
  cid?: string;
}

export interface SendMailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
}

export interface SendMailResult {
  delivered: boolean;
  messageId: string | null;
  /** Set when the message was logged rather than sent (dev, no SMTP). */
  simulated?: boolean;
}

export async function sendMail(params: SendMailParams): Promise<SendMailResult> {
  if (!isMailConfigured()) {
    if (isProduction) {
      throw new AppError(
        503,
        'EMAIL_NOT_CONFIGURED',
        'Email delivery is not configured on this server.',
      );
    }

    console.warn(
      `[mail] SMTP not configured — simulated send\n` +
        `      to:      ${params.to}\n` +
        `      subject: ${params.subject}\n` +
        `      attach:  ${params.attachments?.map((a) => a.filename).join(', ') || 'none'}`,
    );

    return { delivered: true, messageId: null, simulated: true };
  }

  try {
    const info = await getTransport().sendMail({
      from: env.MAIL_FROM,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments,
    });

    return { delivered: true, messageId: info.messageId ?? null };
  } catch (err: unknown) {
    /* Everything below is about DIAGNOSABILITY, not recovery.
     *
     * An SMTP failure used to reach the error handler as an unknown
     * exception, which returns a bare 500 "Something went wrong" — the same
     * answer a wrong password, an unreachable host, a blocked port and a
     * rejected sender address all produced. That is unactionable at a desk
     * and, worse, indistinguishable from a bug in the ticket code itself.
     *
     * nodemailer puts the useful part in `err.code` (ECONNREFUSED,
     * ETIMEDOUT, EAUTH, EENVELOPE) and `err.responseCode` (the SMTP reply,
     * e.g. 535). Both are surfaced: logged in full server-side, and
     * summarised to the agent as a 502 — the upstream failed, this server
     * did not. */
    const e = err as SmtpError;

    console.error(
      `[mail] SMTP send failed\n` +
        `      to:      ${params.to}\n` +
        `      host:    ${env.SMTP_HOST}:${env.SMTP_PORT} secure=${env.SMTP_SECURE}\n` +
        `      from:    ${env.MAIL_FROM}\n` +
        `      auth:    ${env.SMTP_USER ? 'yes' : 'NONE'}\n` +
        `      code:    ${e.code ?? '(none)'} responseCode=${e.responseCode ?? '(none)'}\n` +
        `      reply:   ${e.response ?? '(none)'}\n` +
        `      message: ${e.message ?? String(err)}`,
    );

    /* A hint the person reading the toast can act on. Deliberately says
     * nothing about credentials beyond "rejected" — the agent holding the
     * phone cannot fix SMTP, but the operator reading a screenshot of it
     * can tell which knob to turn. */
    throw new AppError(
      502,
      'EMAIL_SEND_FAILED',
      `Could not send the ticket — ${smtpHint(e)}. The ticket itself is safe; save or share it another way.`,
    );
  }
}

export async function closeMailer(): Promise<void> {
  transporter?.close();
  transporter = null;
}
