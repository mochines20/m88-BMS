import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const normalizeEmailAddress = (value?: string) => String(value || '').trim();
const isValidEmailAddress = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  auth:
    process.env.SMTP_USER && process.env.SMTP_PASS
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      : undefined
});

export const sendEmail = (to: string, subject: string, text: string, html?: string) => {
  const from = normalizeEmailAddress(process.env.EMAIL_FROM || process.env.SMTP_USER);
  const recipient = normalizeEmailAddress(to);

  if (!from) {
    return Promise.reject(new Error('Email sender is not configured.'));
  }

  if (!isValidEmailAddress(from)) {
    return Promise.reject(new Error('Email sender address is invalid.'));
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return Promise.reject(new Error('SMTP credentials are missing.'));
  }

  if (!recipient || !isValidEmailAddress(recipient)) {
    return Promise.reject(new Error(`Recipient email is invalid: ${recipient || '(empty)'}`));
  }

  return transporter.sendMail({ from, to: recipient, subject, text, html }).catch((error: any) => {
    const message = String(error?.message || '');

    if (/Invalid to/i.test(message)) {
      throw new Error(`Recipient email was rejected by the mail server: ${recipient}`);
    }

    throw error;
  });
};
