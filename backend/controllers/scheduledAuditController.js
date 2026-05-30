const ScheduledAudit = require('../models/ScheduledAudit');
const { getPlanLimits } = require('../config/planLimits');

exports.list = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const schedules = await ScheduledAudit.findByUser(userId, { accessToken: req.accessToken });
    res.render('scheduled-audits', {
      title: 'Scheduled Audits - AuditPro',
      user: req.user,
      schedules,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    // Avoid a hard 500 for common misconfigurations (missing table / RLS / missing service role key).
    const isProd = process.env.NODE_ENV === 'production';
    const rawMessage = err?.message || 'Failed to load scheduled audits.';
    const hint = 'Scheduled audits are not available right now. If you just set up Supabase, make sure you ran supabase-schema.sql and configured SUPABASE_SERVICE_ROLE_KEY.';
    const message = isProd ? 'Scheduled audits are temporarily unavailable.' : `${rawMessage} — ${hint}`;
    res.status(200).render('scheduled-audits', {
      title: 'Scheduled Audits - AuditPro',
      user: req.user,
      schedules: [],
      error: message,
      success: null
    });
  }
};

exports.create = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const { url, frequency } = req.body;

    // Check limits
    const count = await ScheduledAudit.countByUser(userId, { accessToken: req.accessToken });
    const max = getPlanLimits(req.user.plan).scheduledAudits;
    if (count >= max) {
      return res.redirect(`/scheduled-audits?error=${encodeURIComponent(`You can have up to ${max} scheduled audit${max > 1 ? 's' : ''} on the ${req.user.plan} plan.`)}`);
    }

    await ScheduledAudit.create({ user: userId, url, frequency: frequency || 'weekly' }, { accessToken: req.accessToken });
    res.redirect('/scheduled-audits?success=created');
  } catch (err) {
    const msg = err?.message || 'Failed to create schedule.';
    res.redirect(`/scheduled-audits?error=${encodeURIComponent(msg)}`);
  }
};

exports.toggle = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const schedule = await ScheduledAudit.findOne({ id: req.params.id, user: userId }, { accessToken: req.accessToken });
    if (!schedule) return res.redirect('/scheduled-audits?error=Not+found');
    await ScheduledAudit.update(req.params.id, { is_active: !schedule.is_active }, { accessToken: req.accessToken });
    res.redirect('/scheduled-audits?success=updated');
  } catch (err) {
    const msg = err?.message || 'Failed to update schedule.';
    res.redirect(`/scheduled-audits?error=${encodeURIComponent(msg)}`);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    await ScheduledAudit.delete(req.params.id, userId, { accessToken: req.accessToken });
    res.redirect('/scheduled-audits?success=deleted');
  } catch (err) {
    const msg = err?.message || 'Failed to delete schedule.';
    res.redirect(`/scheduled-audits?error=${encodeURIComponent(msg)}`);
  }
};

// Called by cron job - runs all due scheduled audits
exports.runDueAudits = async () => {
  try {
    const { runAudit } = require('../utils/auditEngine');
    const Audit = require('../models/Audit');
    const User = require('../models/User');
    const due = await ScheduledAudit.findDue();

    console.log(`[Cron] Found ${due.length} scheduled audit(s) due`);

    for (const schedule of due) {
      try {
        const user = await User.findById(schedule.user_id);
        if (!user) continue;

        // Pro users only for scheduled audits (free users have 1 schedule max)
        const analysis = await runAudit(schedule.url);
        await Audit.create({
          user: schedule.user_id,
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
            issues: analysis.recommendations,
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

        // Compute next run and update
        const nextMap = { daily: 24*60*60*1000, weekly: 7*24*60*60*1000, monthly: 30*24*60*60*1000 };
        const nextRun = new Date(Date.now() + (nextMap[schedule.frequency] || nextMap.weekly)).toISOString();
        await ScheduledAudit.update(schedule.id, { last_run: new Date().toISOString(), next_run: nextRun });

        // Send email notification if configured
        try {
          const { getEmailTransporter, getEmailFrom } = require('../utils/emailConfig');
          const { getAppBaseUrl } = require('../utils/appUrl');
          const transporter = await getEmailTransporter();
          const appUrl = getAppBaseUrl(null);
          await transporter.sendMail({
            from: getEmailFrom(),
            to: user.email,
            subject: `Scheduled Audit Complete: ${schedule.url}`,
            html: `<h2>Scheduled Audit Report</h2>
              <p>Your scheduled ${schedule.frequency} audit for <strong>${schedule.url}</strong> has completed.</p>
              <p><strong>SEO Score: ${analysis.seoScore}/100</strong></p>
              <p>Score rating: ${analysis.seoScore >= 70 ? '✅ Good' : analysis.seoScore >= 40 ? '⚠️ Needs Work' : '❌ Poor'}</p>
              <p><a href="${appUrl}/dashboard">View full report in your dashboard →</a></p>
              <hr><p style="color:#999;font-size:12px">You're receiving this because you have a scheduled audit set up. <a href="${appUrl}/scheduled-audits">Manage schedules →</a></p>`
          });
        } catch (emailErr) {
          console.error('[Cron] Email notification failed:', emailErr.message);
        }

        console.log(`[Cron] Completed audit for ${schedule.url} (score: ${analysis.seoScore})`);
      } catch (auditErr) {
        console.error(`[Cron] Failed audit for ${schedule.url}:`, auditErr.message);
        // Still update next_run so we don't keep hammering a broken URL
        const nextMap = { daily: 24*60*60*1000, weekly: 7*24*60*60*1000, monthly: 30*24*60*60*1000 };
        const nextRun = new Date(Date.now() + (nextMap[schedule.frequency] || nextMap.weekly)).toISOString();
        await ScheduledAudit.update(schedule.id, { next_run: nextRun });
      }
    }
  } catch (err) {
    console.error('[Cron] runDueAudits error:', err.message);
  }
};
