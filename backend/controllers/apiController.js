const ApiKey = require('../models/ApiKey');
const Audit = require('../models/Audit');
const User = require('../models/User');
const { runAudit } = require('../utils/auditEngine');
const { isMonthlyAuditLimitReached } = require('../config/planLimits');

// Middleware: authenticate API requests via API key
exports.apiAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const key = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.query.api_key;

  if (!key || !key.startsWith('ap_')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid API key. Include it as Bearer token or api_key query param.' });
  }

  try {
    const apiKey = await ApiKey.findByKey(key);
    if (!apiKey) {
      return res.status(401).json({ success: false, error: 'Invalid or revoked API key.' });
    }

    const user = await User.findById(apiKey.user_id);
    if (!user) {
      return res.status(401).json({ success: false, error: 'API key owner not found.' });
    }

    // Update last used timestamp (fire and forget)
    ApiKey.updateLastUsed(apiKey.id).catch(() => {});

    req.user = user;
    req.apiKey = apiKey;
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: 'Authentication failed.' });
  }
};

// POST /api/v1/audit
exports.runAudit = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL is required.' });

    // Keep API limits aligned with web app plan rules.
    const now = new Date();
    const currentMonth = now.getMonth();
    const auditsThisMonth = req.user.audit_reset_month === currentMonth ? (req.user.audit_count || 0) : 0;
    if (isMonthlyAuditLimitReached(req.user.plan, auditsThisMonth)) {
      return res.status(403).json({ success: false, error: 'Free plan limit reached. Upgrade to Pro.' });
    }

    const analysis = await runAudit(url);
    const audit = await Audit.create({
      user: userId,
      url: analysis.url,
      seoScore: analysis.seoScore,
      results: {
        title: analysis.title,
        metaDescription: analysis.metaDescription,
        h1Count: analysis.h1Count,
        imagesWithAlt: analysis.imagesWithAlt,
        imagesWithoutAlt: analysis.imagesWithoutAlt,
        hasHttps: analysis.hasHttps,
        securityHeaders: analysis.securityHeaders,
        wordCount: analysis.wordCount,
        recommendations: analysis.recommendations,
        auditDate: analysis.auditDate,
        httpStatusCode: analysis.httpStatusCode,
        crawlBlock: analysis.crawlBlock,
        lighthouseSEOScore: analysis.lighthouseSEOScore,
        pageMetadata: analysis.pageMetadata,
        categorisedIssues: analysis.issues,
        issuesSummary: analysis.issuesSummary,
        optimizedMeta: analysis.optimizedMeta,
        actionPlan: analysis.actionPlan,
        pageSpeedInsights: analysis.pageSpeedInsights,
        sitemapRobots: analysis.sitemapRobots,
        brokenLinks: analysis.brokenLinks
      }
    });

    // Bump usage
    const isNewMonth = req.user.audit_reset_month !== currentMonth;
    await User.updateOne(
      { id: userId },
      isNewMonth
        ? { $set: { auditCount: 1, auditResetMonth: currentMonth } }
        : { $inc: { auditCount: 1 } }
    );

    res.json({
      success: true,
      audit: {
        id: audit.id,
        url: audit.url,
        seoScore: audit.seo_score,
        createdAt: audit.created_at,
        results: audit.results
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Audit failed.' });
  }
};

// GET /api/v1/audits
exports.listAudits = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const { audits, total } = await Audit.findPaginated({ user: userId, page, limit });
    res.json({
      success: true,
      data: audits.map(a => ({
        id: a.id,
        url: a.url,
        seoScore: a.seo_score,
        createdAt: a.created_at
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to list audits.' });
  }
};

// GET /api/v1/audits/:id
exports.getAudit = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const audit = await Audit.findOne({ id: req.params.id, user: userId });
    if (!audit) return res.status(404).json({ success: false, error: 'Audit not found.' });
    res.json({
      success: true,
      audit: {
        id: audit.id,
        url: audit.url,
        seoScore: audit.seo_score,
        createdAt: audit.created_at,
        results: audit.results
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get audit.' });
  }
};

// ── API key management (web UI - uses cookie auth) ──

exports.createKey = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const name = (req.body.name || 'Default').slice(0, 100);
    const result = await ApiKey.create({ user: userId, name }, { accessToken: req.accessToken });
    // Flash the raw key - only shown once
    res.redirect(`/settings?success=api_key_created&newKey=${encodeURIComponent(result.rawKey)}`);
  } catch (err) {
    res.redirect('/settings?error=Failed+to+create+API+key');
  }
};

exports.revokeKey = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    await ApiKey.revoke(req.params.id, userId, { accessToken: req.accessToken });
    res.redirect('/settings?success=api_key_revoked');
  } catch (err) {
    res.redirect('/settings?error=Failed+to+revoke+key');
  }
};

exports.deleteKey = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    await ApiKey.delete(req.params.id, userId, { accessToken: req.accessToken });
    res.redirect('/settings?success=api_key_deleted');
  } catch (err) {
    res.redirect('/settings?error=Failed+to+delete+key');
  }
};
