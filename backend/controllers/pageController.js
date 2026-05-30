const { getMonthlyAuditLimit, isMonthlyAuditLimitReached, getPlanLimits } = require('../config/planLimits');

exports.landing = (req, res) => {
  res.render('landing', {
    title: 'AuditPro - Website SEO & Performance Audits',
    user: req.user || null,
    showThemeToggle: true
  });
};

exports.dashboard = async (req, res, next) => {
  try {
    const Audit = require('../models/Audit');
    const userId = req.user.id || req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const search = (req.query.search || '').trim();
    const scoreFilter = req.query.score || '';
    const { audits, total } = await Audit.findPaginated(
      { user: userId, page, limit, search, scoreFilter },
      { accessToken: req.accessToken }
    );
    const normalizedAudits = (audits || []).map((a) => ({
      ...a,
      _id: a._id || a.id,
      seoScore: a.seoScore ?? a.seo_score ?? 0,
      createdAt: a.createdAt || a.created_at
    }));
    const totalPages = Math.ceil(total / limit);
    const now = new Date();
    const currentMonth = now.getMonth();
    const User = require('../models/User');
    const user = await User.findById(userId, { accessToken: req.accessToken });
    let auditsThisMonth = user.audit_count || 0;
    if (user.audit_reset_month !== currentMonth) {
      auditsThisMonth = 0;
    }
    const monthlyLimit = getMonthlyAuditLimit(user.plan);
    const freeLimit = Number.isFinite(monthlyLimit) ? monthlyLimit : null;
    const canAudit = !isMonthlyAuditLimitReached(user.plan, auditsThisMonth);

    // Score history for trend chart (last 30 audits)
    const scoreHistory = await Audit.getScoreHistory({ user: userId, limit: 30 }, { accessToken: req.accessToken });

    res.render('dashboard', {
      title: 'Dashboard',
      user: req.user,
      audits: normalizedAudits,
      auditsThisMonth,
      freeLimit,
      canAudit,
      page,
      totalPages,
      search,
      scoreFilter,
      scoreHistory: JSON.stringify(scoreHistory),
      error: req.query.error || null,
      upgraded: !!req.query.upgraded
    });
  } catch (err) {
    next(err);
  }
};

exports.pricing = (req, res) => {
  res.render('pricing', { title: 'Pricing - AuditPro', user: req.user || null, upgrade: !!req.query.upgrade });
};

exports.auditForm = (req, res) => {
  res.render('audit', { title: 'Run Audit - AuditPro', user: req.user });
};

exports.localAuditForm = (req, res) => {
  res.render('local-audit', { title: 'Restaurant Growth Audit - AuditPro', user: req.user });
};

exports.comparePage = (req, res) => {
  res.render('compare-form', { title: 'Competitor Comparison - AuditPro', user: req.user });
};

exports.settings = async (req, res, next) => {
  try {
    const User = require('../models/User');
    const ApiKey = require('../models/ApiKey');
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId, { accessToken: req.accessToken });
    const apiKeys = await ApiKey.findByUser(userId, { accessToken: req.accessToken });
    res.render('settings', {
      title: 'Settings - AuditPro',
      user: { ...req.user, email_verified: user ? user.email_verified : false },
      freePlan: getPlanLimits('free'),
      apiKeys: apiKeys || [],
      newKey: req.query.newKey || null,
      success: req.query.success || null,
      error: req.query.error || null,
      info: req.query.info || null
    });
  } catch (err) {
    next(err);
  }
};

exports.privacy = (req, res) => {
  res.render('privacy', { title: 'Privacy Policy - AuditPro', user: req.user || null });
};

exports.terms = (req, res) => {
  res.render('terms', { title: 'Terms of Service - AuditPro', user: req.user || null });
};

exports.forgotPasswordPage = (req, res) => {
  res.render('forgot-password', { title: 'Forgot Password - AuditPro', user: null, success: false });
};

exports.resetPasswordPage = (req, res) => {
  const token = (req.params && req.params.token) ? req.params.token : (req.query.token || '');
  res.render('reset-password', { title: 'Reset Password - AuditPro', user: null, token, error: null });
};
