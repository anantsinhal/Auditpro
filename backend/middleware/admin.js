const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Access Denied',
      message: 'You do not have permission to access this page.',
      statusCode: 403,
      user: req.user || null
    });
  }
  next();
};

module.exports = { requireAdmin };
