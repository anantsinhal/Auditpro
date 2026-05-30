const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

 // To handle async errors without try-catch in every route

const rateLimiter = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');
const { getPlanLimits } = require('./config/planLimits');

const app = express();

app.set('trust proxy', 1);


app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend/views'));


const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://checkout.razorpay.com"],
  scriptSrcAttr: ["'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
  fontSrc: ["'self'", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:", "https:"],
  connectSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com", "https://lux.razorpay.com"],
  frameSrc: ["https://api.razorpay.com", "https://checkout.razorpay.com"],
  objectSrc: ["'none'"]
};
if (process.env.NODE_ENV === 'production') {
  cspDirectives.upgradeInsecureRequests = [];
}
app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  crossOriginEmbedderPolicy: false
}));

// Restrict CORS to known origins while still allowing same-origin requests with no Origin header.
// Configure via:
//   - APP_URL=https://yourdomain.com
//   - CORS_ORIGINS=https://app.yourdomain.com,https://admin.yourdomain.com,http://localhost:5173
const normalizeOrigin = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  try {
    // Convert full URLs (possibly with paths) to their origin.
    return new URL(trimmed).origin;
  } catch {
    // If it's already an origin-like string, keep as-is.
    return trimmed.replace(/\/+$/, '');
  }
};

const configuredOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const appUrlOrigin = normalizeOrigin(process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`);

// In development, allow localhost/127.0.0.1 on any port (common when using Vite/Next/etc.).
const devLocalhostPatterns = process.env.NODE_ENV !== 'production'
  ? [/^https?:\/\/localhost(?::\d+)?$/i, /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i]
  : [];

const allowedOrigins = Array.from(new Set([
  appUrlOrigin,
  ...configuredOrigins
].filter(Boolean)));

const isAllowedOrigin = (origin) => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return true; // same-origin / server-to-server
  // Some browser contexts send the literal string "null" as the Origin (e.g. file:// or sandboxed iframes).
  // Allow this in development by default, and optionally in production via env.
  if (String(normalized).toLowerCase() === 'null') {
    return process.env.NODE_ENV !== 'production' || String(process.env.CORS_ALLOW_NULL_ORIGIN).toLowerCase() === 'true';
  }
  if (allowedOrigins.includes(normalized)) return true;
  if (devLocalhostPatterns.some((re) => re.test(normalized))) return true;
  return false;
};

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    const err = new Error(`CORS origin not allowed: ${origin}`);
    err.statusCode = 403;
    return callback(err);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  optionsSuccessStatus: 204
  // Intentionally omit allowedHeaders so the middleware reflects the request's preflight headers.
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Logging: file-based in production, stdout in dev
if (process.env.NODE_ENV === 'production') {
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const accessLogStream = fs.createWriteStream(path.join(logDir, 'access.log'), { flags: 'a' });
  app.use(morgan('combined', { stream: accessLogStream }));
} else {
  app.use(morgan('dev'));
}

// Razorpay webhook needs raw body for signature verification (must be before express.json())
const paymentController = require('./controllers/paymentController');
app.post('/payment/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  req.rawBodyString = req.body && Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  try { req.body = JSON.parse(req.rawBodyString); } catch (e) { req.body = {}; }
  paymentController.webhook(req, res, next);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const publicDir = path.join(__dirname, '../frontend/public');
app.use(express.static(publicDir));

// Make plan limits available to all views.
app.use((req, res, next) => {
  res.locals.freePlan = getPlanLimits('free');
  res.locals.proPlan = getPlanLimits('pro');
  next();
});

// Backward-compatible aliases for legacy root asset paths that caused 404s.
app.get('/analytics.js', (req, res) => res.sendFile(path.join(publicDir, 'js', 'analytics.js')));
app.get('/main.js', (req, res) => res.sendFile(path.join(publicDir, 'js', 'main.js')));
app.get('/image.jpg', (req, res) => res.sendFile(path.join(publicDir, 'images', 'image.jpg')));

app.use(rateLimiter.general);
app.use('/', routes);

// 404 - must be after routes
app.use((req, res, next) => {
  res.status(404).render('error', {
    title: 'Not Found',
    message: 'The page you are looking for does not exist.',
    statusCode: 404,
    user: null
  });
});

app.use(errorHandler);

module.exports = app;
