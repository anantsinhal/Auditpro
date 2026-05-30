module.exports = (err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const wantsJson = !!(req.xhr || req.headers.accept?.includes('application/json'));
  const requestId = req.id || req.headers['x-request-id'] || null;

  // Avoid leaking internal errors in production.
  const rawMessage = err.publicMessage || err.message || 'Internal Server Error';
  const message = (isProd && statusCode >= 500) ? 'Internal Server Error' : rawMessage;

  // Structured logging (server-side)
  try {
    const logPayload = {
      level: statusCode >= 500 ? 'error' : 'warn',
      requestId,
      statusCode,
      method: req.method,
      path: req.originalUrl,
      message: rawMessage,
      code: err.code || undefined
    };
    if (!isProd && err.stack) logPayload.stack = err.stack;
    console.error(JSON.stringify(logPayload));
  } catch {
    console.error('Unhandled error:', err);
  }

  if (wantsJson) {
    const body = { success: false, message, requestId };
    if (!isProd && err.code) body.code = err.code;
    if (!isProd && err.stack) body.stack = err.stack;
    return res.status(statusCode).json(body);
  }

  res.status(statusCode).render('error', {
    title: 'Error',
    message,
    statusCode,
    requestId,
    user: req.user || null
  });
};
