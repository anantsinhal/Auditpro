const jwt = require('jsonwebtoken');
const User = require('../models/User');

function wantsJson(req) {
  return !!(req.xhr || req.headers.accept?.includes('application/json'));
}

const clearCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
};

const protect = async (req, res, next) => {
  let token = req.cookies?.token || (req.headers.authorization && req.headers.authorization.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null);
  if (!token) {
    if (wantsJson(req)) return res.status(401).json({ success: false, message: 'Authentication required.' });
    return res.redirect('/login');
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.sub || decoded.id;
    const user = await User.findById(userId, { accessToken: token });
    if (!user) {
      res.clearCookie('token', clearCookieOptions);
      if (wantsJson(req)) return res.status(401).json({ success: false, message: 'Invalid session. Please log in again.' });
      return res.redirect('/login');
    }
    // Remove password before attaching to req
    const { password, ...userWithoutPassword } = user;
    req.user = userWithoutPassword;
    req.accessToken = token;
    next();
  } catch (err) {
    res.clearCookie('token', clearCookieOptions);
    if (wantsJson(req)) return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    return res.redirect('/login');
  }
};

const optionalAuth = async (req, res, next) => {
  let token = req.cookies?.token || (req.headers.authorization && req.headers.authorization.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null);
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.sub || decoded.id;
    const user = await User.findById(userId, { accessToken: token });
    if (user) {
      const { password, ...userWithoutPassword } = user;
      req.user = userWithoutPassword;
      req.accessToken = token;
    }
  } catch (err) {
    // ignore
  }
  next();
};

module.exports = { protect, optionalAuth };
