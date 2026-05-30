const express = require('express');
const router = express.Router();
const { protect, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const rateLimiter = require('../middleware/rateLimiter');
const { requireAdmin } = require('../middleware/admin');

const pageController = require('../controllers/pageController');
const authController = require('../controllers/authController');
const auditController = require('../controllers/auditController');
const paymentController = require('../controllers/paymentController');
const localBusinessController = require('../controllers/localBusinessController');
const adminController = require('../controllers/adminController');
const scheduledAuditController = require('../controllers/scheduledAuditController');
const apiController = require('../controllers/apiController');
const chatController = require('../controllers/chatController');

// ── Public Pages ─────────────────────────────────────────────
router.get('/', optionalAuth, pageController.landing);
router.get('/pricing', optionalAuth, pageController.pricing);
router.get('/privacy', optionalAuth, pageController.privacy);
router.get('/terms', optionalAuth, pageController.terms);

router.get('/login', optionalAuth, (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Login - AuditPro', user: req.user || null });
});
router.get('/register', optionalAuth, (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('register', { title: 'Register - AuditPro', user: req.user || null });
});

// ── Auth ─────────────────────────────────────────────────────
router.post('/register', rateLimiter.authLimiter, validate('register'), authController.register);
router.post('/login', rateLimiter.authLimiter, validate('login'), authController.login);
router.get('/logout', authController.logout);
router.post('/logout', validate('emptyBody'), authController.logout);

// ── Password Reset (public) ─────────────────────────────────
router.get('/forgot-password', optionalAuth, pageController.forgotPasswordPage);
router.post('/forgot-password', rateLimiter.authLimiter, validate('forgotPassword'), authController.forgotPassword);
router.get('/reset-password', optionalAuth, pageController.resetPasswordPage);
router.post('/reset-password', rateLimiter.authLimiter, validate('resetPassword'), authController.resetPassword);

// Backward/alternate compatible token-in-path reset URLs
router.get('/reset-password/:token', optionalAuth, pageController.resetPasswordPage);
router.post(
  '/reset-password/:token',
  rateLimiter.authLimiter,
  (req, _res, next) => {
    // Allow submitting password with token in the URL.
    if (!req.body || typeof req.body !== 'object') req.body = {};
    if (!req.body.token) req.body.token = req.params.token;
    next();
  },
  validate('resetPassword'),
  authController.resetPassword
);

// ── Email Verification (public, optional auth) ──────────────
router.get('/verify-email', optionalAuth, authController.verifyEmail);

// ── Public API v1 (API key auth) ─────────────────────────────
const apiLimiter = require('../middleware/rateLimiter').apiLimiter;
router.post('/api/v1/audit', apiLimiter, apiController.apiAuth, validate('apiAudit'), apiController.runAudit);
router.get('/api/v1/audits', apiLimiter, apiController.apiAuth, apiController.listAudits);
router.get('/api/v1/audits/:id', apiLimiter, apiController.apiAuth, apiController.getAudit);

// ── Protected Routes ─────────────────────────────────────────
router.use(protect);

router.get('/dashboard', pageController.dashboard);

// Assistant (Chat)
router.post('/assistant/chat', rateLimiter.chatLimiter, validate('chat'), chatController.chat);

router.get('/audit', pageController.auditForm);
router.post('/audit', rateLimiter.auditLimiter, validate('audit'), auditController.run);
router.get('/audit/:id', auditController.view);
router.get('/audit/:id/pdf', auditController.downloadPdf);
router.post('/audit/:id/email', validate('idParamOnly'), auditController.emailPdf);
router.get('/api/audits', auditController.list);

// Competitor Comparison
router.get('/compare', pageController.comparePage);
router.post('/compare', rateLimiter.auditLimiter, validate('compare'), auditController.compare);

// Audit Backup / Export
router.get('/backup', auditController.backup);

router.get('/payment/create-order', paymentController.createOrder);
router.post('/payment/verify', validate('paymentVerify'), paymentController.verifyPayment);

// Local Business / Restaurant Audit
router.get('/local-audit', pageController.localAuditForm);
router.post('/local-audit', rateLimiter.auditLimiter, validate('localAudit'), localBusinessController.run);
router.get('/local-audit/:id', localBusinessController.view);
router.get('/local-audit/:id/pdf', localBusinessController.downloadPdf);
router.post('/local-audit/:id/email', validate('idParamOnly'), localBusinessController.emailPdf);

// ── Settings / Profile ───────────────────────────────────────
router.get('/settings', pageController.settings);
router.post('/settings/profile', validate('updateProfile'), authController.updateProfile);
router.post('/settings/password', validate('changePassword'), authController.changePassword);
router.post('/settings/delete-account', validate('deleteAccount'), authController.deleteAccount);
router.get('/resend-verification', authController.resendVerification);

// API Key Management (web UI)
router.post('/settings/api-keys', validate('apiKeyCreate'), apiController.createKey);
router.post('/settings/api-keys/:id/revoke', validate('idParamOnly'), apiController.revokeKey);
router.post('/settings/api-keys/:id/delete', validate('idParamOnly'), apiController.deleteKey);

// ── Scheduled Audits ─────────────────────────────────────────
router.get('/scheduled-audits', scheduledAuditController.list);
router.post('/scheduled-audits', validate('scheduledAudit'), scheduledAuditController.create);
router.post('/scheduled-audits/:id/toggle', validate('idParamOnly'), scheduledAuditController.toggle);
router.post('/scheduled-audits/:id/delete', validate('idParamOnly'), scheduledAuditController.remove);

// ── Admin ────────────────────────────────────────────────────
router.get('/admin', requireAdmin, adminController.dashboard);

module.exports = router;
