require('dotenv').config();

const { getEmailTransporter, getEmailFrom } = require('../utils/emailConfig');

(async () => {
  try {
    const transporter = await getEmailTransporter();

    const to = (process.env.SMTP_USER && process.env.SMTP_USER.includes('@'))
      ? process.env.SMTP_USER
      : 'test@example.com';

    const info = await transporter.sendMail({
      from: getEmailFrom(),
      to,
      subject: 'AuditPro mail test',
      text: 'If you see this in a real inbox, SMTP is working. In dev, use the preview URL printed by this script.'
    });

    console.log('sent messageId:', info.messageId);

    const preview = require('nodemailer').getTestMessageUrl(info);
    if (preview) {
      console.log('preview url:', preview);
    } else {
      console.log('no preview url (likely real SMTP)');
    }
  } catch (e) {
    console.error('mail test failed:', (e && e.message) ? e.message : e);
    process.exitCode = 1;
  }
})();
