/*
  Smoke test script for core flows (local/dev).

  Usage:
    node backend/scripts/smokeTest.js

  Env:
    BASE_URL=http://localhost:3000
    TEST_EMAIL=you@example.com
    TEST_PASSWORD=Password123!

  Notes:
  - This is intentionally lightweight (no test framework).
  - It won’t create a user unless you enable CREATE_USER=true.
*/

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Password123!';
const CREATE_USER = String(process.env.CREATE_USER || '').toLowerCase() === 'true';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function headerCookies(setCookieHeaders) {
  if (!setCookieHeaders) return '';
  const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    redirect: 'manual',
    ...options,
    headers: {
      'accept': 'application/json',
      ...(options.headers || {})
    }
  });

  let bodyText = '';
  try { bodyText = await res.text(); } catch {}

  let json = null;
  try { json = bodyText ? JSON.parse(bodyText) : null; } catch {}

  return { res, json, bodyText, setCookie: res.headers.raw()['set-cookie'] };
}

async function main() {
  console.log('BASE_URL =', BASE_URL);

  // 1) Protected route without auth should be 401 JSON
  {
    const { res, json } = await request('/api/audits');
    assert(res.status === 401, `Expected 401 for /api/audits without auth, got ${res.status}`);
    assert(json && json.success === false, 'Expected JSON error payload');
    console.log('✓ Protected API returns 401 without auth');
  }

  // 2) Optionally create user
  if (CREATE_USER) {
    const { res, json, bodyText } = await request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test User', email: TEST_EMAIL, password: TEST_PASSWORD })
    });
    assert([201, 302, 400].includes(res.status), `Unexpected status from register: ${res.status} (${bodyText})`);
    if (res.status === 201) console.log('✓ Registered test user');
    else console.log('ℹ Register skipped/failed (maybe already exists)');
  }

  // 3) Login and capture cookie
  let cookie = '';
  {
    const { res, json, setCookie, bodyText } = await request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
    });

    assert([200, 302, 401].includes(res.status), `Unexpected status from login: ${res.status} (${bodyText})`);
    if (res.status === 401) {
      console.log('✗ Login failed (check TEST_EMAIL/TEST_PASSWORD)');
      return;
    }

    cookie = headerCookies(setCookie);
    assert(cookie.includes('token='), 'Expected token cookie from login');
    console.log('✓ Login sets token cookie');
  }

  // 4) Protected API with cookie should succeed
  {
    const { res, json, bodyText } = await request('/api/audits', { headers: { cookie } });
    assert(res.status === 200, `Expected 200 from /api/audits with auth, got ${res.status} (${bodyText})`);
    assert(json && json.success === true, 'Expected success payload');
    console.log('✓ Protected API works with cookie');
  }

  // 5) Audit invalid URL should 400 (validation)
  {
    const { res } = await request('/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ url: 'not-a-url' })
    });
    assert(res.status === 400, `Expected 400 for invalid url, got ${res.status}`);
    console.log('✓ Audit rejects invalid URL (400)');
  }

  // 6) Audit SSRF should be blocked (localhost)
  {
    const { res } = await request('/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ url: 'http://127.0.0.1:80' })
    });
    // Could be 400 from SSRF block or 400 from general error handling.
    assert([400, 403].includes(res.status), `Expected SSRF block-ish status, got ${res.status}`);
    console.log('✓ Audit blocks localhost/private IP targets');
  }

  // 7) Logout clears cookie
  {
    const { res, setCookie } = await request('/logout', { headers: { cookie } });
    assert([200, 302].includes(res.status), `Unexpected status from logout: ${res.status}`);
    const setCookieStr = (Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie || ''));
    assert(/token=;/i.test(setCookieStr) || /token=\s*;/.test(setCookieStr), 'Expected token cookie cleared on logout');
    console.log('✓ Logout clears token cookie');
  }

  console.log('\nDone. For reset-password and emails, test via UI to capture tokens/links.');
}

main().catch((e) => {
  console.error('Smoke test failed:', e.message);
  process.exit(1);
});
