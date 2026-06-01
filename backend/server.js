const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
  override: true
});

const app = require('./app');
const { connectDB } = require('./config/db');

const BASE_PORT = Number(process.env.PORT || 3000);
const strictPort = ['1', 'true', 'yes', 'on'].includes(String(process.env.STRICT_PORT || '').toLowerCase())
  || process.env.NODE_ENV === 'production';
const maxPortAttempts = Number(process.env.PORT_RETRY_ATTEMPTS || 10);

function listenOnce(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.on('error', reject);
  });
}

async function startServer() {
  const startPort = Number.isFinite(BASE_PORT) && BASE_PORT > 0 ? BASE_PORT : 3000;
  let lastErr = null;

  for (let i = 0; i <= maxPortAttempts; i += 1) {
    const port = startPort + i;
    try {
      if (i > 0) {
        console.warn(`[Startup] Port ${port - 1} in use. Trying ${port}...`);
      }
      const server = await listenOnce(port);
      console.log(`AuditPro server running on port ${port}`);

      // Start cron job for scheduled audits (runs every hour)
      try {
        const { runDueAudits } = require('./controllers/scheduledAuditController');
        const defaultCronIntervalMs = 60 * 60 * 1000; // 1 hour
        const configuredCronIntervalMs = Number(process.env.SCHEDULED_AUDIT_CRON_INTERVAL_MS || defaultCronIntervalMs);
        const CRON_INTERVAL = (Number.isFinite(configuredCronIntervalMs) && configuredCronIntervalMs >= 1000)
          ? configuredCronIntervalMs
          : defaultCronIntervalMs;

        setInterval(() => {
          console.log('[Cron] Checking for due scheduled audits...');
          runDueAudits().catch(err => {
            console.error('[Cron] Unhandled cron error:', err.message || err);
          });
        }, CRON_INTERVAL);
        console.log(`✓ Scheduled audit cron started (every ${Math.round(CRON_INTERVAL / 1000)}s)`);
      } catch (cronErr) {
        console.error('Cron setup failed:', cronErr.message);
      }

      // Timeouts (useful behind load balancers / reverse proxies)
      // - requestTimeout: how long the server will wait for the entire request to finish
      // - headersTimeout: how long to wait for request headers
      const requestTimeoutMs = Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 120000);
      const headersTimeoutMs = Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 65000);
      if (Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0) server.requestTimeout = requestTimeoutMs;
      if (Number.isFinite(headersTimeoutMs) && headersTimeoutMs > 0) server.headersTimeout = headersTimeoutMs;

      return;
    } catch (err) {
      lastErr = err;
      if (err && err.code === 'EADDRINUSE') {
        if (strictPort) break;
        continue;
      }
      throw err;
    }
  }

  if (lastErr && lastErr.code === 'EADDRINUSE') {
    console.error(`[Startup] Port ${BASE_PORT} is already in use.`);
    console.error('Set a different PORT, or stop the process using that port.');
    process.exit(1);
  }
  throw lastErr || new Error('Server failed to start.');
}

// Prevent server crashes from unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error(' Unhandled Promise Rejection:', reason instanceof Error ? reason.stack : JSON.stringify(reason, null, 2));
});

process.on('uncaughtException', (err) => {
  console.error(' Uncaught Exception:', err.stack || err);
  // Give time to log, then exit gracefully
  setTimeout(() => process.exit(1), 1000);
});

connectDB()
  .then(() => {
    return startServer();
  })
  .catch((err) => {
    console.error('Failed to connect to Supabase:', err.message);
    process.exit(1);
  });
