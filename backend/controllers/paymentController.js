const crypto = require('crypto');
const Razorpay = require('razorpay');
const User = require('../models/User');

const razorpayKeyId = (process.env.RAZORPAY_KEY_ID || '').trim();
const razorpayKeySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

const razorpay = razorpayKeyId && razorpayKeySecret
  ? new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret })
  : null;

const PRO_AMOUNT_PAISE = 99900; // ₹999
const CURRENCY = 'INR';

exports.createOrder = async (req, res, next) => {
  try {
    if (!razorpay) {
      return res.status(503).json({ success: false, message: 'Payments not configured.' });
    }

    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (req.user?.plan === 'pro') {
      return res.json({ success: true, alreadyPro: true, message: 'Already on Pro.' });
    }

    const userId = req.user.id || req.user._id;
    const options = {
      amount: PRO_AMOUNT_PAISE,
      currency: CURRENCY,
      receipt: `auditpro_pro_${userId}_${Date.now()}`,
      notes: { userId: String(userId), plan: 'pro' },
    };
    const order = await razorpay.orders.create(options);
    res.json({ success: true, orderId: order.id, amount: order.amount, currency: order.currency, keyId: razorpayKeyId });
  } catch (err) {
    // Razorpay returns 401 for invalid credentials / wrong mode.
    const status = err?.statusCode || err?.status;
    if (status === 401) {
      return res.status(503).json({
        success: false,
        message: 'Payment gateway configuration error. Please contact support.'
      });
    }
    next(err);
  }
};

function timingSafeEqualHex(a, b) {
  try {
    const aBuf = Buffer.from(String(a || ''), 'utf8');
    const bBuf = Buffer.from(String(b || ''), 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function verifyWebhookSignature(body, signature, secret) {
  try {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return timingSafeEqualHex(signature, expected);
  } catch {
    return false;
  }
}

exports.webhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signature) {
      return res.status(400).send('Bad request');
    }

    const body = req.rawBodyString || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    if (!verifyWebhookSignature(body, signature, secret)) {
      return res.status(400).send('Invalid signature');
    }

    const payload = req.body;
    const event = payload && payload.event;

    if (event === 'payment.captured') {
      const payment = payload.payload?.payment?.entity;
      const order = payload.payload?.order?.entity;
      const notes = payment?.notes || order?.notes || {};
      const userId = notes.userId;
      const plan = notes.plan;

      const amount = payment?.amount ?? order?.amount;
      const currency = String(payment?.currency || order?.currency || '').toUpperCase();

      // Only upgrade when the captured payment matches the Pro plan order we create.
      if (userId && plan === 'pro' && amount === PRO_AMOUNT_PAISE && currency === CURRENCY) {
        await User.updateOne({ id: userId }, { $set: { plan: 'pro' } });
      }
    }

    return res.status(200).send('OK');
  } catch (err) {
    return next(err);
  }
};

exports.verifyPayment = async (req, res, next) => {
  try {
    if (!razorpay) {
      return res.redirect('/pricing?error=payments_not_configured');
    }
    if (!req.user) {
      return res.redirect('/login');
    }
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.redirect('/pricing?error=missing_params');
    }
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto.createHmac('sha256', razorpayKeySecret).update(body).digest('hex');
    if (!timingSafeEqualHex(razorpay_signature, expected)) {
      return res.redirect('/pricing?error=verification_failed');
    }

    // Best-effort server-side verification to reduce edge cases:
    // confirm the order exists + amount/currency match, and payment is linked to the order.
    try {
      const [order, payment] = await Promise.all([
        razorpay.orders.fetch(razorpay_order_id),
        razorpay.payments.fetch(razorpay_payment_id)
      ]);

      if (order?.amount !== PRO_AMOUNT_PAISE || order?.currency !== CURRENCY) {
        return res.redirect('/pricing?error=amount_mismatch');
      }
      if (payment?.order_id && payment.order_id !== razorpay_order_id) {
        return res.redirect('/pricing?error=order_mismatch');
      }
      // If capture is delayed, webhook will still upgrade; allow verify to upgrade anyway.
    } catch (verifyErr) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Payments] Razorpay fetch verification failed:', verifyErr?.message || verifyErr);
      }
      // Continue: signature already verified; treat Razorpay fetch failure as non-fatal.
    }

    const userId = req.user.id || req.user._id;
    await User.updateOne({ id: userId }, { $set: { plan: 'pro' } }, { accessToken: req.accessToken });
    res.redirect('/dashboard?upgraded=1');
  } catch (err) {
    next(err);
  }
};
