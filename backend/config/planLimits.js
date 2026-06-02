function parseLimitEnv(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['inf', 'infinite', 'infinity', 'unlimited'].includes(normalized)) return Number.POSITIVE_INFINITY;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
}

const DEFAULT_LIMITS = Object.freeze({
  free: Object.freeze({
    monthlyAudits: 5,
    scheduledAudits: 5,
    bulkKeywordChecks: 50
  }),
  pro: Object.freeze({
    monthlyAudits: Number.POSITIVE_INFINITY,
    scheduledAudits: 10,
    bulkKeywordChecks: Number.POSITIVE_INFINITY
  })
});

const PLAN_LIMITS = Object.freeze({
  free: Object.freeze({
    monthlyAudits: parseLimitEnv(process.env.FREE_MONTHLY_AUDITS, DEFAULT_LIMITS.free.monthlyAudits),
    scheduledAudits: parseLimitEnv(process.env.FREE_SCHEDULED_AUDITS, DEFAULT_LIMITS.free.scheduledAudits),
    bulkKeywordChecks: parseLimitEnv(process.env.FREE_BULK_KEYWORD_CHECKS, DEFAULT_LIMITS.free.bulkKeywordChecks)
  }),
  pro: Object.freeze({
    monthlyAudits: parseLimitEnv(process.env.PRO_MONTHLY_AUDITS, DEFAULT_LIMITS.pro.monthlyAudits),
    scheduledAudits: parseLimitEnv(process.env.PRO_SCHEDULED_AUDITS, DEFAULT_LIMITS.pro.scheduledAudits),
    bulkKeywordChecks: parseLimitEnv(process.env.PRO_BULK_KEYWORD_CHECKS, DEFAULT_LIMITS.pro.bulkKeywordChecks)
  })
});

function getPlanLimits(plan = 'free') {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

function getMonthlyAuditLimit(plan = 'free') {
  return getPlanLimits(plan).monthlyAudits;
}

function isMonthlyAuditLimitReached(plan = 'free', usageCount = 0) {
  const limit = getMonthlyAuditLimit(plan);
  if (!Number.isFinite(limit)) return false;
  return usageCount >= limit;
}

module.exports = {
  PLAN_LIMITS,
  getPlanLimits,
  getMonthlyAuditLimit,
  isMonthlyAuditLimitReached
};
