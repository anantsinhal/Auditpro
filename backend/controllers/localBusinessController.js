const Audit = require('../models/Audit');
const User = require('../models/User');
const { runLocalBusinessAudit } = require('../utils/localBusinessEngine');
const nodemailer = require('nodemailer');
const { isMonthlyAuditLimitReached } = require('../config/planLimits');

async function getAuditsThisMonth(userId, accessToken) {
  const user = await User.findById(userId, accessToken ? { accessToken } : undefined);
  if (!user) return { count: 0, plan: 'free' };
  const now = new Date();
  const currentMonth = now.getMonth();
  if (user.audit_reset_month !== currentMonth) return { count: 0, plan: user.plan || 'free' };
  return { count: user.audit_count || 0, plan: user.plan || 'free' };
}

// ── POST /local-audit ───────
exports.run = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const { count, plan } = await getAuditsThisMonth(userId, req.accessToken);

    if (isMonthlyAuditLimitReached(plan, count)) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({ success: false, message: 'Free plan limit reached. Upgrade to Pro for unlimited audits.' });
      }
      return res.redirect('/pricing?upgrade=1');
    }

    // Build input object from form
    const input = {
      restaurantName: req.body.restaurantName || '',
      url:            req.body.url || '',
      city:           req.body.city || '',
      metaTags: {
        title:       req.body.metaTitle || '',
        description: req.body.metaDescription || ''
      },
      headings: {
        h1: req.body.h1 || '',
        h2: req.body.h2 || ''
      },
      wordCount:    Number(req.body.wordCount)  || 0,
      pageSpeed:    req.body.pageSpeed || '',
      googleRating: req.body.googleRating || null,
      reviewCount:  Number(req.body.reviewCount) || 0,
      hasSchema:    req.body.hasSchema === 'yes',
      competitor: {
        name:        req.body.compName || '',
        rating:      req.body.compRating || 0,
        reviewCount: Number(req.body.compReviewCount) || 0,
        pageSpeed:   req.body.compPageSpeed || 0,
        wordCount:   Number(req.body.compWordCount) || 0,
        hasSchema:   req.body.compHasSchema === 'yes',
        metaTags: {
          title:       req.body.compMetaTitle || '',
          description: req.body.compMetaDescription || ''
        }
      },
      sampleReviews: req.body.sampleReviews || '',
      menuItems:     req.body.menuItems || ''
    };

    const report = runLocalBusinessAudit(input);

    const audit = await Audit.create({
      user: userId,
      url: input.url || `local-audit:${input.restaurantName}`,
      seoScore: report.local_seo_analysis.issuesFound.filter(i => i.impact === 'High').length === 0 ? 80
              : report.local_seo_analysis.issuesFound.filter(i => i.impact === 'High').length <= 2  ? 60 : 40,
      results: { auditType: 'local_business', report }
    }, { accessToken: req.accessToken });

    // Bump usage counter
    const now = new Date();
    const currentMonth = now.getMonth();
    const u = await User.findById(userId, { accessToken: req.accessToken });
    const isNewMonth = !u || u.audit_reset_month !== currentMonth;
    await User.updateOne(
      { id: userId },
      isNewMonth
        ? { $set: { auditCount: 1, auditResetMonth: currentMonth } }
        : { $inc: { auditCount: 1 } },
      { accessToken: req.accessToken }
    );

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, audit: { id: audit.id, report } });
    }
    res.redirect(`/local-audit/${audit.id}`);
  } catch (err) {
    const code = err.code || '';
    const msg = code === 'ENOTFOUND' ? 'Domain not found. Check the URL.'
              : code === 'ECONNREFUSED' ? 'Connection refused by the server.'
              : code === 'ETIMEDOUT' || code === 'ECONNABORTED' ? 'Request timed out. Try again.'
              : err.message || 'Local audit failed.';
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: msg });
    }
    res.redirect(`/dashboard?error=${encodeURIComponent(msg)}`);
  }
};

// ── GET /local-audit/:id ──────────────────────────────────────────────────────
exports.view = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const audit = await Audit.findOne({ id: req.params.id, user: userId }, { accessToken: req.accessToken });
    if (!audit) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Audit not found.', statusCode: 404, user: req.user });
    }
    res.render('local-audit-result', {
      title: 'Restaurant Audit Report - AuditPro',
      user: req.user,
      audit
    });
  } catch (err) {
    next(err);
  }
};

exports.downloadPdf = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const audit = await Audit.findOne({ id: req.params.id, user: userId }, { accessToken: req.accessToken });
    
    if (!audit) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Audit not found.', statusCode: 404, user: req.user });
    }

    const ejs = require('ejs');
    const path = require('path');
    const fs = require('fs');
    const { getAppBaseUrl } = require('../utils/appUrl');
    const { generatePdfBufferFromHtml } = require('../utils/pdfRenderer');

    const pdfCss = fs.readFileSync(
      path.join(__dirname, '../../frontend/public/css/style.css'),
      'utf8'
    );

    const html = await ejs.renderFile(
      path.join(__dirname, '../../frontend/views/local-audit-result.ejs'), 
      { title: 'Restaurant Audit Report - AuditPro', user: req.user, audit, isPdf: true, assetBaseUrl: getAppBaseUrl(req), pdfCss }
    );

    const pdfBuffer = await generatePdfBufferFromHtml(html, {
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=local-audit-${audit.url.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
    res.send(pdfBuffer);

  } catch (err) {
    next(err);
  }
};

exports.emailPdf = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const audit = await Audit.findOne({ id: req.params.id, user: userId }, { accessToken: req.accessToken });
    
    if (!audit) {
      return res.status(404).json({ success: false, message: 'Audit not found.' });
    }

    const ejs = require('ejs');
    const path = require('path');
    const fs = require('fs');
    const { getEmailTransporter, getEmailFrom } = require('../utils/emailConfig');
    const { getAppBaseUrl } = require('../utils/appUrl');
    const { generatePdfBufferFromHtml } = require('../utils/pdfRenderer');

    const pdfCss = fs.readFileSync(
      path.join(__dirname, '../../frontend/public/css/style.css'),
      'utf8'
    );

    const html = await ejs.renderFile(
      path.join(__dirname, '../../frontend/views/local-audit-result.ejs'), 
      { title: 'Restaurant Audit Report - AuditPro', user: req.user, audit, isPdf: true, assetBaseUrl: getAppBaseUrl(req), pdfCss }
    );

    const pdfBuffer = await generatePdfBufferFromHtml(html, {
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });

    const transporter = await getEmailTransporter();

    const mailOptions = {
      from: getEmailFrom(),
      to: req.user.email,
      subject: `Your Local Business Audit Report for ${audit.url}`,
      text: `Hello ${req.user.name},\n\nPlease find attached the local business audit report for ${audit.url}.\n\nBest regards,\nThe AuditPro Team`,
      attachments: [
        {
          filename: `local-audit-${audit.url.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`,
          content: pdfBuffer
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    
    // Log preview URL for Ethereal in dev (no-op for real SMTP)
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log('Preview URL: %s', preview);

    res.json({ success: true, message: 'Email sent successfully!' });

  } catch (err) {
    console.error('Email Sending Error:', err);
    res.status(500).json({ success: false, message: 'Failed to send email.' });
  }
};
