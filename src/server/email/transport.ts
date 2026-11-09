import type { Transporter } from 'nodemailer';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

export interface MailMessage {
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  text: string;
}

let smtp: Transporter | null = null;

async function getSmtp(): Promise<Transporter> {
  if (smtp) return smtp;
  if (!env.SMTP_HOST) throw new Error('SMTP_HOST is not set');
  const nodemailer = await import('nodemailer');
  smtp = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE ?? false,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return smtp;
}

/**
 * FR-21: EMAIL_TRANSPORT='smtp' → Nodemailer; anything else → console.
 * Config errors throw here so the dispatcher records a retryable failure.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (env.EMAIL_TRANSPORT !== 'smtp') {
    logger.info('Email (console transport)', { to: message.to, subject: message.subject, text: message.text });
    return;
  }
  if (!env.EMAIL_FROM) throw new Error('EMAIL_FROM is not set');
  const transport = await getSmtp();
  await transport.sendMail({
    from: env.EMAIL_FROM,
    to: message.toName ? { name: message.toName, address: message.to } : message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: { 'List-Unsubscribe': `<${env.APP_URL.replace(/\/$/, '')}/account/notifications>` },
  });
}
