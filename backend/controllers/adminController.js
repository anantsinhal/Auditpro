const User = require('../models/User');
const Audit = require('../models/Audit');

exports.dashboard = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 25;

    const { users, total } = await User.findAll({ page, limit });
    const totalAudits = await Audit.count();

    const proUsers = users.filter(u => u.plan === 'pro').length;
    const verifiedUsers = users.filter(u => u.email_verified).length;

    // For full stats, count all pro/verified users (not just current page)
    let allProCount = proUsers;
    let allVerifiedCount = verifiedUsers;
    if (total > limit) {
      // Rough approximation from current page ratio projected to total
      allProCount = Math.round((proUsers / users.length) * total) || proUsers;
      allVerifiedCount = Math.round((verifiedUsers / users.length) * total) || verifiedUsers;
    }

    res.render('admin', {
      title: 'Admin Dashboard - AuditPro',
      user: req.user,
      users,
      page,
      totalPages: Math.ceil(total / limit),
      stats: {
        totalUsers: total,
        proUsers: allProCount,
        totalAudits,
        verifiedUsers: allVerifiedCount
      }
    });
  } catch (err) {
    next(err);
  }
};
