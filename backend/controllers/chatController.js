const { generateAssistantReply } = require('../utils/ai');

const FREE_ASSISTANT_MESSAGES_PER_MONTH = (() => {
  const raw = String(process.env.FREE_ASSISTANT_MESSAGES_PER_MONTH || '20').trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 20;
})();

// In-memory usage tracker (best-effort). For strict persistence, store counts in DB.
const usageByUserMonth = new Map();

function currentMonthKey() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${m}`;
}

function bumpUsage(userId) {
  const key = `${userId}:${currentMonthKey()}`;
  const next = (usageByUserMonth.get(key) || 0) + 1;
  usageByUserMonth.set(key, next);
  return next;
}

exports.chat = async (req, res, next) => {
  try {
    const { message, history, page, image, context } = req.body || {};

    const plan = String(req.user?.plan || 'free').toLowerCase();

    // Pro-only: image uploads
    if (image && plan !== 'pro') {
      return res.status(403).json({
        success: false,
        message: 'Image upload is available on Pro. Upgrade to Pro to use this feature.'
      });
    }

    // Free plan monthly assistant message limit
    if (plan !== 'pro') {
      const userId = req.user?.id || req.user?._id;
      const count = bumpUsage(userId || 'unknown');
      if (count > FREE_ASSISTANT_MESSAGES_PER_MONTH) {
        return res.status(403).json({
          success: false,
          message: 'Free plan assistant limit reached. Upgrade to Pro to continue.'
        });
      }
    }

    const reply = await generateAssistantReply({
      message,
      history,
      page,
      image,
      context
    });

    return res.json({ success: true, reply });
  } catch (err) {
    const msg = err && err.message ? err.message : 'Assistant failed. Please try again.';

    if (err && err.code === 'AI_NOT_CONFIGURED') {
      return res.status(503).json({ success: false, message: msg });
    }

    // Let the global error handler log unexpected failures.
    err.message = msg;
    return next(err);
  }
};
