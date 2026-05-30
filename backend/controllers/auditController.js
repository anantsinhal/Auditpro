const Audit = require('../models/Audit');
const User = require('../models/User');
const { runAudit } = require('../utils/auditEngine');
const { isMonthlyAuditLimitReached } = require('../config/planLimits');
const { generateInsights } = require('../utils/ai');

function friendlyError(err) {
  const code = err.code || (err.cause && err.cause.code) || '';
  const msg  = (err.message || '').toLowerCase();
  if (code === 'ENOTFOUND')                          return 'Domain not found. Please check the URL is correct and the site is live.';
  if (code === 'ECONNREFUSED')                       return 'Connection refused. The server is not accepting connections right now.';
  if (code === 'ECONNRESET')                         return 'Connection was reset by the server. Please try again.';
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') return 'The request timed out. The site may be too slow or blocking automated requests.';
  if (code === 'EACCES' || code === 'EPERM')         return 'Access denied by the server. The site may be blocking automated requests.';
  if (code === 'ERR_INVALID_URL' || msg.includes('invalid url')) return 'Invalid URL format. Please enter a full URL starting with https://';
  if (msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls')) return 'SSL certificate issue detected on this site (the audit still ran where possible).';
  if (err.response?.status === 404)                  return 'Page not found (404). Check the URL is correct.';
  if (err.response?.status === 403)                  return 'Access forbidden (403). The site is blocking automated access.';
  if (err.response?.status >= 500)                   return `Server error (${err.response.status}). The target site is experiencing issues.`;
  return err.message || 'Audit failed. Please check the URL and try again.';
}

async function getAuditsThisMonth(userId, accessToken) {
  const user = await User.findById(userId, accessToken ? { accessToken } : undefined);
  if (!user) return { count: 0, plan: 'free' };
  const now = new Date();
  const currentMonth = now.getMonth();
  if (user.audit_reset_month !== currentMonth) return { count: 0, plan: user.plan || 'free' };
  return { count: user.audit_count || 0, plan: user.plan || 'free' };
}

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

    const analysis = await runAudit(req.body.url);
    const audit = await Audit.create({
      user: userId,
      url: analysis.url,
      seoScore: analysis.seoScore,
      results: {
        // Legacy flat fields (backwards-compat)
        title: analysis.title,
        metaDescription: analysis.metaDescription,
        h1Count: analysis.h1Count,
        imagesWithAlt: analysis.imagesWithAlt,
        imagesWithoutAlt: analysis.imagesWithoutAlt,
        hasHttps: analysis.hasHttps,
        securityHeaders: analysis.securityHeaders,
        wordCount: analysis.wordCount,
        issues: analysis.recommendations,          // legacy flat list
        recommendations: analysis.recommendations,
        // Rich structured fields
        auditDate: analysis.auditDate,
        httpStatusCode: analysis.httpStatusCode,
        crawlBlock: analysis.crawlBlock,
        lighthouseSEOScore: analysis.lighthouseSEOScore,
        pageMetadata: analysis.pageMetadata,
        categorisedIssues: analysis.issues,
        issuesSummary: analysis.issuesSummary,
        optimizedMeta: analysis.optimizedMeta,
        actionPlan: analysis.actionPlan,
        // New feature data
        pageSpeedInsights: analysis.pageSpeedInsights,
        sitemapRobots: analysis.sitemapRobots,
        brokenLinks: analysis.brokenLinks
      }
    }, { accessToken: req.accessToken });

    // Generate AI insights after audit creation (non-fatal if misconfigured)
    try {
      const aiInsights = await generateInsights(audit.results || {});

      try {
        // Preferred: store in a dedicated DB column
        await Audit.update(audit.id, { ai_insights: aiInsights }, { accessToken: req.accessToken });
      } catch (updateErr) {
        const updateMsg = updateErr?.message || String(updateErr);
        // Fallback: if the column doesn't exist, store inside the results JSON.
        if (/ai_insights/i.test(updateMsg) && (/column/i.test(updateMsg) || /does not exist/i.test(updateMsg))) {
          await Audit.update(
            audit.id,
            { results: { ...(audit.results || {}), ai_insights: aiInsights } },
            { accessToken: req.accessToken }
          );
        } else {
          throw updateErr;
        }
      }
    } catch (aiErr) {
      console.error('AI insights generation/storage failed:', aiErr?.message || aiErr);
    }

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
      return res.json({ success: true, audit: { id: audit.id, url: audit.url, seoScore: audit.seo_score, results: audit.results } });
    }

    // Send audit completion email (fire and forget)
    try {
      const { getEmailTransporter, getEmailFrom } = require('../utils/emailConfig');
      const { getAppBaseUrl } = require('../utils/appUrl');
      const transporter = await getEmailTransporter();
      const appUrl = getAppBaseUrl(req);
      await transporter.sendMail({
        from: getEmailFrom(),
        to: req.user.email,
        subject: `Audit Complete: ${analysis.url} — Score ${analysis.seoScore}/100`,
        html: `<h2>Your SEO Audit is Ready</h2>
          <p>Great news! Your audit for <strong>${analysis.url}</strong> has completed.</p>
          <p style="font-size:24px;font-weight:bold;color:${analysis.seoScore >= 70 ? '#16a34a' : analysis.seoScore >= 40 ? '#d97706' : '#dc2626'}">Score: ${analysis.seoScore}/100</p>
          <p>${analysis.seoScore >= 70 ? '✅ Good' : analysis.seoScore >= 40 ? '⚠️ Needs Work' : '❌ Poor'}</p>
          <p><a href="${appUrl}/audit/${audit.id}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">View Full Report →</a></p>
          <hr><p style="color:#999;font-size:12px">AuditPro — Website SEO Auditing Platform</p>`
      });
    } catch (emailErr) {
      console.error('Audit email notification failed:', emailErr.message);
    }

    res.redirect(`/audit/${audit.id}`);
  } catch (err) {
    const msg = friendlyError(err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: msg });
    }
    res.redirect(`/dashboard?error=${encodeURIComponent(msg)}`);
  }
};

exports.view = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const audit = await Audit.findOne({ id: req.params.id, user: userId }, { accessToken: req.accessToken });
    if (!audit) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Audit not found.', statusCode: 404, user: req.user });
    }
    res.render('audit-result', { title: 'Audit Report - AuditPro', user: req.user, audit });
  } catch (err) {
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const audits = await Audit.find({ user: userId }, { accessToken: req.accessToken });
    res.json({ success: true, audits });
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

    // Render the EJS template to HTML string
    const html = await ejs.renderFile(
      path.join(__dirname, '../../frontend/views/audit-result.ejs'), 
      { title: 'Audit Report - AuditPro', user: req.user, audit, isPdf: true, assetBaseUrl: getAppBaseUrl(req), pdfCss }
    );

    const pdfBuffer = await generatePdfBufferFromHtml(html, {
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=audit-report-${audit.url.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
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
    const nodemailer = require('nodemailer');
    const { getEmailTransporter, getEmailFrom } = require('../utils/emailConfig');
    const { getAppBaseUrl } = require('../utils/appUrl');
    const { generatePdfBufferFromHtml } = require('../utils/pdfRenderer');

    const pdfCss = fs.readFileSync(
      path.join(__dirname, '../../frontend/public/css/style.css'),
      'utf8'
    );

    // Render the EJS template to HTML string
    const html = await ejs.renderFile(
      path.join(__dirname, '../../frontend/views/audit-result.ejs'), 
      { title: 'Audit Report - AuditPro', user: req.user, audit, isPdf: true, assetBaseUrl: getAppBaseUrl(req), pdfCss }
    );

    const pdfBuffer = await generatePdfBufferFromHtml(html, {
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });

    // Get configured email transporter
    const transporter = await getEmailTransporter();

    const mailOptions = {
      from: getEmailFrom(),
      to: req.user.email,
      subject: `Your SEO Audit Report for ${audit.url}`,
      text: `Hello ${req.user.name},\n\nPlease find attached the SEO audit report for ${audit.url}.\n\nBest regards,\nThe AuditPro Team`,
      attachments: [
        {
          filename: `audit-report-${audit.url.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`,
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

// ── Competitor Comparison ─────────────────────────────────────────────────────
exports.compare = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const { count, plan } = await getAuditsThisMonth(userId, req.accessToken);
    if (isMonthlyAuditLimitReached(plan, count)) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({ success: false, message: 'Free plan limit reached. Upgrade to Pro for unlimited audits.' });
      }
      return res.redirect('/pricing?upgrade=1');
    }

    const { url, competitorUrl } = req.body;
    const [yourAudit, compAudit] = await Promise.all([
      runAudit(url),
      runAudit(competitorUrl)
    ]);

    // Bump usage (counts as 1 audit)
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
      return res.json({ success: true, your: yourAudit, competitor: compAudit });
    }

    res.render('compare', {
      title: 'Competitor Comparison - AuditPro',
      user: req.user,
      yours: yourAudit,
      competitor: compAudit
    });
  } catch (err) {
    const msg = friendlyError(err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: msg });
    }
    res.redirect(`/dashboard?error=${encodeURIComponent(msg)}`);
  }
};

// ── Audit History Backup / Export ─────────────────────────────────────────────
exports.backup = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const audits = await Audit.find({ user: userId }, { accessToken: req.accessToken });
    const format = req.query.format || 'json';

    if (format === 'csv') {
      const csvRows = ['ID,URL,SEO Score,Date'];
      audits.forEach(a => {
        const date = a.created_at || a.createdAt || '';
        const score = a.seo_score || a.seoScore || 0;
        csvRows.push(`"${a.id}","${a.url}",${score},"${date}"`);
      });
      const csvData = csvRows.join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=auditpro-backup-${Date.now()}.csv`);
      return res.send(csvData);
    }

    // JSON export (full data)
    const exportData = {
      exportDate: new Date().toISOString(),
      totalAudits: audits.length,
      audits: audits.map(a => ({
        id: a.id,
        url: a.url,
        seoScore: a.seo_score || a.seoScore,
        results: a.results,
        createdAt: a.created_at || a.createdAt
      }))
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=auditpro-backup-${Date.now()}.json`);
    res.send(JSON.stringify(exportData, null, 2));
  } catch (err) {
    next(err);
  }
};
