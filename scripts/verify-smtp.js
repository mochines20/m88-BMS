require('dotenv').config();

const nodemailer = require('nodemailer');

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

const summarizeConfig = () => ({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  user: process.env.SMTP_USER || '(missing)',
  passConfigured: Boolean(process.env.SMTP_PASS),
  from: process.env.EMAIL_FROM || process.env.SMTP_USER || '(missing)'
});

const run = async () => {
  console.log('Checking SMTP configuration...');
  console.log(JSON.stringify(summarizeConfig(), null, 2));

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP_USER or SMTP_PASS is missing in .env');
  }

  await transporter.verify();
  console.log('SMTP authentication succeeded.');
};

run().catch((error) => {
  console.error('SMTP verification failed.');
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
