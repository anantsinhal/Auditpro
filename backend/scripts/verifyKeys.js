/*
  Safe config/key verification helper.
  - Does NOT print secret values.
  - Can optionally test live connectivity to Supabase and Razorpay.

  Usage:
    node backend/scripts/verifyKeys.js
    node backend/scripts/verifyKeys.js --skip-db
    node backend/scripts/verifyKeys.js --payments
*/

const path = require('path');

// Load .env from repo root (works regardless of current working directory)
try {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch {
  // Ignore: dotenv is already a dependency in this repo.
}

function isSet(name) {
  const val = process.env[name];
  return typeof val === 'string' ? val.trim().length > 0 : Boolean(val);
}

function looksLikeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function looksLikeJwt(value) {
  const v = String(value || '').trim();
  return v.split('.').length === 3 && v.startsWith('eyJ');
}

function razorpayKeyMode(keyId) {
  const v = String(keyId || '').trim();
  if (!v) return null;
  if (v.startsWith('rzp_test_')) return 'test';
  if (v.startsWith('rzp_live_')) return 'live';
  return 'unusual';
}

function printCheck(label, ok, note) {
  const status = ok ? 'OK' : 'MISSING';
  const suffix = note ? ` (${note})` : '';
  // Intentionally plain output; safe for logs.
  console.log(`${status.padEnd(7)} ${label}${suffix}`);
}

function formatErr(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || String(err);

  const statusCode = err.statusCode || err.status || err.httpStatusCode;
  const razorpayError = err.error && typeof err.error === 'object' ? err.error : null;

  const parts = [];
  if (statusCode) parts.push(`status=${statusCode}`);
  if (razorpayError?.code) parts.push(`code=${razorpayError.code}`);
  if (razorpayError?.description) parts.push(razorpayError.description);
  if (parts.length) return parts.join(' ');

  try {
    // As a last resort, stringify a shallow subset.
    const safe = {
      statusCode,
      message: err.message,
      name: err.name,
    };
    return JSON.stringify(safe);
  } catch {
    return String(err);
  }
}

async function maybeVerifySupabase() {
  const { connectDB } = require('../config/db');
  await connectDB();
}

async function maybeVerifyRazorpay() {
  const Razorpay = require('razorpay');

  const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();

  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not set');
  }

  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

  // Low-impact API call: list up to 1 order.
  // This validates credentials without creating a charge/order.
  await razorpay.orders.all({ count: 1 });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const skipDb = args.has('--skip-db');
  const verifyPayments = args.has('--payments');

  console.log('Config verification (secrets are not printed)');
  console.log(`NODE_ENV: ${process.env.NODE_ENV || '(not set)'}`);
  console.log('');

  // Supabase
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseAnon = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const supabaseService = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  printCheck('SUPABASE_URL', Boolean(supabaseUrl), supabaseUrl ? (looksLikeUrl(supabaseUrl) ? 'url looks valid' : 'url looks unusual') : undefined);
  printCheck('SUPABASE_ANON_KEY', Boolean(supabaseAnon), supabaseAnon ? (looksLikeJwt(supabaseAnon) ? 'jwt-like' : 'format unusual') : undefined);
  printCheck('SUPABASE_SERVICE_ROLE_KEY', Boolean(supabaseService), supabaseService ? (looksLikeJwt(supabaseService) ? 'jwt-like' : 'format unusual') : undefined);

  // Auth
  const jwtSecret = String(process.env.JWT_SECRET || '').trim();
  printCheck('JWT_SECRET', Boolean(jwtSecret), jwtSecret ? (jwtSecret.length >= 24 ? 'length ok' : 'too short?') : undefined);

  // Razorpay (presence only by default)
  const razorpayKeyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
  const razorpayKeySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();

  const mode = razorpayKeyMode(razorpayKeyId);
  printCheck('RAZORPAY_KEY_ID', Boolean(razorpayKeyId), mode ? `mode=${mode}` : undefined);
  printCheck('RAZORPAY_KEY_SECRET', Boolean(razorpayKeySecret));
  printCheck('RAZORPAY_WEBHOOK_SECRET', Boolean(webhookSecret));

  // Email (optional)
  printCheck('SMTP_HOST', isSet('SMTP_HOST'));
  printCheck('SMTP_PORT', isSet('SMTP_PORT'));
  printCheck('SMTP_USER', isSet('SMTP_USER'));
  printCheck('SMTP_PASS', isSet('SMTP_PASS'));
  printCheck('SMTP_FROM', isSet('SMTP_FROM'));

  // Optional external APIs
  printCheck('GOOGLE_API_KEY', isSet('GOOGLE_API_KEY'));
  printCheck('GOOGLE_CSE_ID', isSet('GOOGLE_CSE_ID'));
  printCheck('PAGESPEED_API_KEY', isSet('PAGESPEED_API_KEY'));
  printCheck('GEMINI_API_KEY', isSet('GEMINI_API_KEY'));

  // App URL (recommended)
  printCheck('APP_URL', isSet('APP_URL'), isSet('APP_URL') ? (looksLikeUrl(String(process.env.APP_URL).trim()) ? 'url looks valid' : 'url looks unusual') : undefined);

  const missingRequired =
    !supabaseUrl ||
    !supabaseAnon ||
    !supabaseService ||
    !jwtSecret;

  console.log('');

  if (missingRequired) {
    console.log('One or more required env vars are missing. Fix those first.');
  } else {
    console.log('Required env vars are present.');
  }

  if (!skipDb) {
    console.log('');
    console.log('Supabase connectivity check:');
    try {
      await maybeVerifySupabase();
      console.log('OK      Supabase connection test passed');
    } catch (e) {
      console.log(`FAILED  Supabase connection test failed: ${e?.message || e}`);
    }
  }

  if (verifyPayments) {
    console.log('');
    console.log('Razorpay connectivity check:');
    try {
      await maybeVerifyRazorpay();
      console.log('OK      Razorpay credentials validated (orders.list)');
    } catch (e) {
      console.log(`FAILED  Razorpay check failed: ${formatErr(e)}`);
    }
  }

  if (missingRequired) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
