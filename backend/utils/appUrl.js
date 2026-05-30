function stripTrailingSlashes(value) {
  return String(value).replace(/\/+$/, '');
}

function getEnvAppUrl() {
  const envUrl = (process.env.APP_URL || '').trim();
  if (!envUrl) return null;
  return stripTrailingSlashes(envUrl);
}

function firstForwardedValue(value) {
  if (!value) return '';
  return String(value).split(',')[0].trim();
}

function getRequestAppUrl(req) {
  if (!req) return null;

  const forwardedProto = firstForwardedValue(req.headers['x-forwarded-proto']);
  const proto = forwardedProto || req.protocol;

  const forwardedHost = firstForwardedValue(req.headers['x-forwarded-host']);
  const host = forwardedHost || (typeof req.get === 'function' ? req.get('host') : req.headers.host);

  if (!proto || !host) return null;
  return stripTrailingSlashes(`${proto}://${host}`);
}

function getAppBaseUrl(req) {
  const envUrl = getEnvAppUrl();
  const reqUrl = getRequestAppUrl(req);
  const fallback = stripTrailingSlashes(`http://localhost:${process.env.PORT || 3000}`);

  // In production, APP_URL should be canonical because req may reflect internal hosts/protocols.
  if (process.env.NODE_ENV === 'production') {
    return envUrl || reqUrl || fallback;
  }

  // In development, honor APP_URL if set (useful for mobile testing via LAN IP / tunnels).
  return envUrl || reqUrl || fallback;
}

module.exports = { getAppBaseUrl };
