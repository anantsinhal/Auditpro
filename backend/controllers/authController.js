const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { getEmailTransporter, getEmailFrom } = require('../utils/emailConfig');
const { getAppBaseUrl } = require('../utils/appUrl');

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

exports.register = async (req, res, next) => {
  try {
    const existing = await User.findOne({ email: req.body.email });
    if (existing) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ success: false, message: 'Email already registered.' });
      }
      return res.status(400).render('register', {
        title: 'Register - AuditPro',
        user: null,
        error: 'Email already registered. Try logging in instead.'
      });
    }

    // Generate email verification token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = await User.create({
      ...req.body,
      email_verified: false,
      email_verify_token: verifyToken,
      email_verify_expires: verifyExpires.toISOString()
    });

    // Send verification email
    try {
      const transporter = await getEmailTransporter();
      const appUrl = getAppBaseUrl(req);
      const verifyUrl = `${appUrl}/verify-email?token=${verifyToken}`;
      const info = await transporter.sendMail({
        from: getEmailFrom(),
        to: user.email,
        subject: 'Verify your AuditPro email',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#1e293b">Welcome to AuditPro!</h2>
          <p style="color:#475569">Hi ${user.name},</p>
          <p style="color:#475569">Please verify your email address by clicking the button below:</p>
          <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(to right,#4f46e5,#7c3aed);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Verify Email</a>
          <p style="color:#94a3b8;font-size:13px">This link expires in 24 hours. If you didn't create an account, ignore this email.</p>
        </div>`
      });

      const accepted = Array.isArray(info?.accepted) ? info.accepted : [];
      const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
      console.log('Verification email send result:', {
        to: user.email,
        messageId: info?.messageId,
        accepted,
        rejected
      });

      // Log preview URL for Ethereal in dev
      if (info && info.messageId) {
        const preview = require('nodemailer').getTestMessageUrl(info);
        if (preview) console.log('Verification email preview URL:', preview);
      }

      if (accepted.length === 0 || rejected.length > 0) {
        console.warn('Verification email may not have been delivered. Check SMTP settings, spam folder, and Gmail account restrictions.');
      }
    } catch (emailErr) {
      console.error('Verification email failed:', emailErr.message);
    }

    const token = jwt.sign(
      {
        id: user.id,
        sub: user.id,
        role: 'authenticated',
        aud: 'authenticated',
        email: user.email
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.cookie('token', token, cookieOptions);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(201).json({ success: true, user: { id: user.id, name: user.name, email: user.email, plan: user.plan } });
    }
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user || !(await User.comparePassword(req.body.password, user.password))) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }
      return res.status(401).render('login', {
        title: 'Login - AuditPro',
        user: null,
        error: 'Invalid email or password.'
      });
    }
    const token = jwt.sign(
      {
        id: user.id,
        sub: user.id,
        role: 'authenticated',
        aud: 'authenticated',
        email: user.email
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.cookie('token', token, cookieOptions);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, plan: user.plan } });
    }
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res) => {
  res.clearCookie('token', cookieOptions);
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true });
  }
  res.redirect('/');
};

// ── Forgot Password ──────────────────────────────────────────

exports.forgotPassword = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    // Always show success to prevent email enumeration
    if (!user) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Auth] Forgot password requested for non-existent email', { requestId: req.id, email: req.body.email });
      }
      return res.render('forgot-password', { title: 'Forgot Password - AuditPro', user: null, success: true });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await User.updateOne({ id: user.id }, { $set: { password_reset_token: resetToken, password_reset_expires: resetExpires.toISOString() } });

    try {
      const transporter = await getEmailTransporter();
      const appUrl = getAppBaseUrl(req);
      const resetUrl = `${appUrl}/reset-password/${resetToken}`;
      const info = await transporter.sendMail({
        from: getEmailFrom(),
        to: user.email,
        subject: 'Reset your AuditPro password',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#1e293b">Password Reset</h2>
          <p style="color:#475569">Hi ${user.name},</p>
          <p style="color:#475569">Click the button below to reset your password:</p>
          <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(to right,#4f46e5,#7c3aed);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Reset Password</a>
          <p style="color:#94a3b8;font-size:13px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        </div>`
      });
      // Log preview URL for Ethereal in dev
      if (info && info.messageId) {
        const preview = require('nodemailer').getTestMessageUrl(info);
        if (preview) console.log('Preview URL:', preview);
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[Auth] Password reset email sent', { requestId: req.id, userId: user.id, to: user.email });
      }
    } catch (emailErr) {
      console.error('Reset email failed:', emailErr.message);
    }

    res.render('forgot-password', { title: 'Forgot Password - AuditPro', user: null, success: true });
  } catch (err) {
    next(err);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 6) {
      return res.render('reset-password', { title: 'Reset Password - AuditPro', user: null, token, error: 'Password must be at least 6 characters.' });
    }

    const user = await User.findByResetToken(token);
    if (!user) {
      return res.render('reset-password', { title: 'Reset Password - AuditPro', user: null, token: '', error: 'Invalid or expired reset link. Please request a new one.' });
    }

    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash(password, 12);
    await User.updateOne({ id: user.id }, { $set: { password: hashed, password_reset_token: null, password_reset_expires: null } });

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Auth] Password reset successful', { requestId: req.id, userId: user.id, email: user.email });
    }

    res.render('reset-password', { title: 'Reset Password - AuditPro', user: null, token: '', error: null, success: true });
  } catch (err) {
    next(err);
  }
};

// ── Email Verification ───────────────────────────────────────

exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.render('verify-email', { title: 'Verify Email - AuditPro', user: req.user || null, success: false, error: 'Missing verification token.' });
    }

    const user = await User.findByVerifyToken(token);
    if (!user) {
      return res.render('verify-email', { title: 'Verify Email - AuditPro', user: req.user || null, success: false, error: 'Invalid or expired verification link.' });
    }

    await User.updateOne({ id: user.id }, { $set: { email_verified: true, email_verify_token: null, email_verify_expires: null } });

    res.render('verify-email', { title: 'Verify Email - AuditPro', user: req.user || null, success: true, error: null });
  } catch (err) {
    next(err);
  }
};

exports.resendVerification = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId, { accessToken: req.accessToken });
    if (!user) return res.redirect('/login');
    if (user.email_verified) return res.redirect('/settings?info=already_verified');

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await User.updateOne(
      { id: user.id },
      { $set: { email_verify_token: verifyToken, email_verify_expires: verifyExpires.toISOString() } },
      { accessToken: req.accessToken }
    );

    let emailSent = false;

    try {
      const transporter = await getEmailTransporter();
      const appUrl = getAppBaseUrl(req);
      const verifyUrl = `${appUrl}/verify-email?token=${verifyToken}`;
      const info = await transporter.sendMail({
        from: getEmailFrom(),
        to: user.email,
        subject: 'Verify your AuditPro email',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#1e293b">Email Verification</h2>
          <p style="color:#475569">Hi ${user.name},</p>
          <p style="color:#475569">Click below to verify your email:</p>
          <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(to right,#4f46e5,#7c3aed);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Verify Email</a>
          <p style="color:#94a3b8;font-size:13px">This link expires in 24 hours.</p>
        </div>`
      });

      const accepted = Array.isArray(info?.accepted) ? info.accepted : [];
      const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
      console.log('Resend verification email send result:', {
        to: user.email,
        messageId: info?.messageId,
        accepted,
        rejected
      });

      // Log preview URL for Ethereal in dev
      if (info && info.messageId) {
        const preview = require('nodemailer').getTestMessageUrl(info);
        if (preview) console.log('Verification email preview URL:', preview);
      }

      emailSent = accepted.length > 0 && rejected.length === 0;
    } catch (emailErr) {
      console.error('Resend verification failed:', emailErr.message);
    }

    if (emailSent) return res.redirect('/settings?info=verification_sent');
    return res.redirect('/settings?error=verification_send_failed');
  } catch (err) {
    next(err);
  }
};

// ── Profile / Settings ───────────────────────────────────────

exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const { name, email } = req.body;
    const updates = {};
    let shouldSendVerification = false;
    let newVerifyToken = null;
    if (name && name.trim().length >= 2) updates.name = name.trim();
    if (email && email !== req.user.email) {
      const existing = await User.findOne({ email });
      if (existing) return res.redirect('/settings?error=email_taken');
      updates.email = email.toLowerCase().trim();
      updates.email_verified = false;

      // Generate a fresh verification token for the new email.
      newVerifyToken = crypto.randomBytes(32).toString('hex');
      const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      updates.email_verify_token = newVerifyToken;
      updates.email_verify_expires = verifyExpires.toISOString();
      shouldSendVerification = true;
    }
    if (Object.keys(updates).length > 0) {
      await User.updateOne({ id: userId }, { $set: updates }, { accessToken: req.accessToken });
    }

    // If email changed, attempt to send verification email to the new address.
    let verificationEmailSent = false;
    if (shouldSendVerification && updates.email && newVerifyToken) {
      try {
        const transporter = await getEmailTransporter();
        const appUrl = getAppBaseUrl(req);
        const verifyUrl = `${appUrl}/verify-email?token=${newVerifyToken}`;
        const info = await transporter.sendMail({
          from: getEmailFrom(),
          to: updates.email,
          subject: 'Verify your AuditPro email',
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#1e293b">Verify your new email</h2>
            <p style="color:#475569">Hi ${req.user.name},</p>
            <p style="color:#475569">Click below to verify your email change:</p>
            <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(to right,#4f46e5,#7c3aed);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Verify Email</a>
            <p style="color:#94a3b8;font-size:13px">This link expires in 24 hours.</p>
          </div>`
        });

        const accepted = Array.isArray(info?.accepted) ? info.accepted : [];
        const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
        console.log('Verification email (profile update) send result:', {
          to: updates.email,
          messageId: info?.messageId,
          accepted,
          rejected
        });

        if (info && info.messageId) {
          const preview = require('nodemailer').getTestMessageUrl(info);
          if (preview) console.log('Verification email preview URL:', preview);
        }

        verificationEmailSent = accepted.length > 0 && rejected.length === 0;
      } catch (emailErr) {
        console.error('Verification email after profile update failed:', emailErr.message);
      }
    }

    if (shouldSendVerification) {
      if (verificationEmailSent) return res.redirect('/settings?success=profile_updated&info=verification_sent');
      return res.redirect('/settings?success=profile_updated&error=verification_send_failed');
    }
    res.redirect('/settings?success=profile_updated');
  } catch (err) {
    next(err);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.redirect('/settings?error=password_short');

    const user = await User.findById(userId, { accessToken: req.accessToken });
    if (!user || !(await User.comparePassword(currentPassword, user.password))) {
      return res.redirect('/settings?error=wrong_password');
    }

    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash(newPassword, 12);
    await User.updateOne({ id: userId }, { $set: { password: hashed } }, { accessToken: req.accessToken });
    res.redirect('/settings?success=password_changed');
  } catch (err) {
    next(err);
  }
};

exports.deleteAccount = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const { confirmPassword } = req.body;
    const user = await User.findById(userId, { accessToken: req.accessToken });
    if (!user || !(await User.comparePassword(confirmPassword, user.password))) {
      return res.redirect('/settings?error=wrong_password');
    }
    await User.deleteById(userId, { accessToken: req.accessToken });
    res.clearCookie('token', cookieOptions);
    res.redirect('/?deleted=1');
  } catch (err) {
    next(err);
  }
};
