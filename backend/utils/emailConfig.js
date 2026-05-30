const nodemailer = require('nodemailer');

let testAccount = null;
let cachedTransporter = null;

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getEmailFrom() {
  if (process.env.SMTP_FROM && process.env.SMTP_FROM.trim()) {
    return process.env.SMTP_FROM.trim();
  }
  if (process.env.SMTP_USER && process.env.SMTP_USER.includes('@')) {
    return `"AuditPro" <${process.env.SMTP_USER.trim()}>`;
  }
  return '"AuditPro" <noreply@auditpro.com>';
}

async function getEmailTransporter() {
  if (cachedTransporter) return cachedTransporter;
  

  const smtpHost = (process.env.SMTP_HOST || '').trim();
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  const hasAnySmtpConfig = !!(smtpHost || smtpUser || smtpPass);

  // Use configured SMTP if all required values are present.
  if (smtpHost && smtpUser && smtpPass) {
    const smtpPort = Number(process.env.SMTP_PORT || 587);
    if (Number.isNaN(smtpPort)) {
      throw new Error('SMTP_PORT must be a valid number.');
    }

    const secure = parseBoolean(process.env.SMTP_SECURE, smtpPort === 465);
    cachedTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    // Fail early with a clear error if credentials or host are invalid.
    await cachedTransporter.verify();
    return cachedTransporter;
  }

  if (hasAnySmtpConfig) {
    const missing = [];
    if (!smtpHost) missing.push('SMTP_HOST');
    if (!String(process.env.SMTP_PORT || '').trim()) missing.push('SMTP_PORT');
    if (!smtpUser) missing.push('SMTP_USER');
    if (!smtpPass) missing.push('SMTP_PASS');
    const suffix = missing.length ? ` Missing: ${missing.join(', ')}.` : '';
    throw new Error(`Incomplete SMTP configuration. Please set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS together.${suffix}`);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS.');
  }

  // For development/testing, create Ethereal test account
  if (!testAccount) {
    console.log('Creating test email account...');
    testAccount = await nodemailer.createTestAccount();
    console.log('Test email created:', testAccount.user);
  }

  cachedTransporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: testAccount.user,
      pass: testAccount.pass
    }
  });

  await cachedTransporter.verify();
  return cachedTransporter;
}

module.exports = { getEmailTransporter, getEmailFrom };