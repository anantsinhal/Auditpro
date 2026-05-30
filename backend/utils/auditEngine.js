'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const dns = require('dns').promises;
const net = require('net');

const MAX_BODY_LENGTH = 10 * 1024 * 1024; // 10 MB
const REQUEST_TIMEOUT = (() => {
  const raw = process.env.AUDIT_REQUEST_TIMEOUT_MS || process.env.HTTP_TIMEOUT_MS || '25000';
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 25000;
  // Avoid unbounded hangs.
  return Math.min(Math.max(n, 5000), 120000);
})();

// ─── URL Safety (SSRF protection) ───────────────────────────────────────────

function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (!family) return false;

  // IPv4
  if (family === 4) {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }

  // IPv6
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local (fc00::/7)
  if (normalized.startsWith('fe80')) return true; // link-local (fe80::/10)
  return false;
}

async function assertPublicUrl(inputUrl) {
  const allowPrivate = ['1', 'true', 'yes', 'on'].includes(String(process.env.ALLOW_PRIVATE_URLS || '').toLowerCase());
  if (allowPrivate) return;

  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    const err = new Error('Invalid URL');
    err.statusCode = 400;
    err.publicMessage = 'Invalid URL format. Please enter a full URL starting with http:// or https://';
    throw err;
  }

  const hostname = (parsed.hostname || '').toLowerCase();
  if (!hostname) {
    const err = new Error('Invalid URL host');
    err.statusCode = 400;
    err.publicMessage = 'Invalid URL host.';
    throw err;
  }

  // Block localhost-ish names immediately.
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === '0.0.0.0') {
    const err = new Error('Localhost/private host blocked');
    err.statusCode = 400;
    err.publicMessage = 'That URL is not allowed.';
    throw err;
  }

  // If hostname is an IP, validate directly.
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    const err = new Error('Private IP blocked');
    err.statusCode = 400;
    err.publicMessage = 'That URL is not allowed.';
    throw err;
  }

  // Resolve DNS and ensure it doesn't point to private IPs.
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    for (const addr of addrs) {
      if (addr && addr.address && isPrivateIp(addr.address)) {
        const err = new Error('Private IP resolution blocked');
        err.statusCode = 400;
        err.publicMessage = 'That URL is not allowed.';
        throw err;
      }
    }
  } catch (e) {
    // If DNS lookup fails, the fetch will likely fail with ENOTFOUND anyway.
  }
}

// ─── HTTP Fetch ───────────────────────────────────────────────────────────────

async function fetchHtml(url) {
  const normalized = url.startsWith('http') ? url : `https://${url}`;

  // Basic SSRF protection (blocks localhost/private IPs by default).
  await assertPublicUrl(normalized);

  // Only allow http(s)
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      const err = new Error('Unsupported URL protocol');
      err.statusCode = 400;
      err.publicMessage = 'Only http:// and https:// URLs are supported.';
      throw err;
    }
  } catch (e) {
    if (e && e.publicMessage) throw e;
    const err = new Error('Invalid URL');
    err.statusCode = 400;
    err.publicMessage = 'Invalid URL format. Please enter a full URL starting with http:// or https://';
    throw err;
  }

  const requestConfig = {
    timeout: REQUEST_TIMEOUT,
    maxContentLength: MAX_BODY_LENGTH,
    maxBodyLength: MAX_BODY_LENGTH,
    responseType: 'text',
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AuditPro-Bot/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    // Bypass SSL certificate errors so sites with expired/self-signed certs
    // can still be audited — we flag the SSL issue in the report instead
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
  };

  try {
    const response = await axios.get(normalized, requestConfig);
    return {
      html: response.data,
      finalUrl: response.request?.res?.responseUrl || normalized,
      statusCode: response.status,
      headers: response.headers || {},
      sslError: false
    };
  } catch (err) {
    // If HTTPS fails entirely (e.g. no HTTPS at all), retry over HTTP
    const isSslErr = err.code && (
      err.code.includes('CERT') ||
      err.code.includes('SSL') ||
      err.code === 'ERR_TLS_CERT_ALTNAME_INVALID'
    );
    if (isSslErr && normalized.startsWith('https://')) {
      const httpUrl = normalized.replace('https://', 'http://');
      const response = await axios.get(httpUrl, { ...requestConfig, httpsAgent: undefined });
      return {
        html: response.data,
        finalUrl: response.request?.res?.responseUrl || httpUrl,
        statusCode: response.status,
        headers: response.headers || {},
        sslError: true
      };
    }
    throw err;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function extractTopKeywords(text, topN = 10) {
  const STOPWORDS = new Set([
    'the','and','for','are','was','with','this','that','from','have','has',
    'its','not','but','more','been','than','into','also','can','they','will',
    'your','our','their','all','one','two','get','set','use','used','you','we',
    'is','in','a','an','to','of','on','it','at','be','as','or','if','do','by',
    'how','why','when','what','which','who','so','up','out','no','just','about'
  ]);
  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const freq = {};
  for (const w of words) {
    if (!STOPWORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

function generateMetaDescription(bodyText, title, maxLen = 155) {
  const sentences = bodyText.replace(/\s+/g, ' ').trim().split(/[.!?]+/).filter(s => s.trim().length > 40);
  const candidate = sentences[0] ? sentences[0].trim() : bodyText.trim().substring(0, 150);
  if (candidate.length <= maxLen) return candidate + (candidate.endsWith('.') ? '' : '.');
  return candidate.substring(0, maxLen - 1).replace(/\s+\S*$/, '') + '…';
}

function improveH1(current, keywords) {
  if (!current || current === '(none)') {
    return keywords.length > 0
      ? `Ultimate Guide to ${keywords.slice(0, 2).map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(' & ')}`
      : 'Add a Clear, Keyword-Rich H1 Heading';
  }
  if (current.length < 20 || current.split(' ').length < 4) {
    const kw = keywords.find(k => !current.toLowerCase().includes(k));
    return kw ? `${current} – Complete ${kw.charAt(0).toUpperCase() + kw.slice(1)} Guide` : current;
  }
  return current;
}

function buildIssue(id, title, category, impact, whyHarmful, steps, htmlCode = null) {
  const issue = { id, title, category, impact, whyHarmful, fix: { steps } };
  if (htmlCode) issue.fix.htmlCode = htmlCode;
  return issue;
}

// ─── PageSpeed Insights API ──────────────────────────────────────────────────

async function fetchPageSpeedInsights(url) {
  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=seo&category=accessibility`;
    const response = await axios.get(apiUrl, { timeout: 60000 });
    const data = response.data;
    const lh = data.lighthouseResult || {};
    const audits = lh.audits || {};
    const metricsItems = audits.metrics?.details?.items?.[0] || {};
    return {
      performance: Math.round((lh.categories?.performance?.score || 0) * 100),
      seo: Math.round((lh.categories?.seo?.score || 0) * 100),
      accessibility: Math.round((lh.categories?.accessibility?.score || 0) * 100),
      coreWebVitals: {
        lcp: metricsItems.largestContentfulPaint || null,
        fid: metricsItems.maxPotentialFID || null,
        cls: audits['cumulative-layout-shift']?.numericValue ?? null,
        ttfb: metricsItems.timeToFirstByte || null,
        fcp: metricsItems.firstContentfulPaint || null,
        si: metricsItems.speedIndex || null,
        tbt: metricsItems.totalBlockingTime || null,
        tti: metricsItems.interactive || null
      },
      opportunities: Object.values(audits)
        .filter(a => a.details?.type === 'opportunity' && a.score !== null && a.score < 0.9)
        .map(a => ({ title: a.title, description: a.description, savings: a.details?.overallSavingsMs }))
        .slice(0, 8)
    };
  } catch (err) {
    console.error('PageSpeed Insights API error:', err.message);
    return null;
  }
}

// ─── Sitemap & Robots.txt Validator ──────────────────────────────────────────

async function fetchSitemapAndRobots(url) {
  const results = {
    sitemap: { found: false, valid: false, urlCount: 0, isIndex: false, issues: [] },
    robots:  { found: false, valid: false, rules: [], issues: [] }
  };

  let origin;
  try { origin = new URL(url).origin; } catch { return results; }

  // Check robots.txt
  try {
    const res = await axios.get(`${origin}/robots.txt`, {
      timeout: 8000, validateStatus: () => true, responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuditPro-Bot/1.0)' }
    });
    if (res.status === 200 && typeof res.data === 'string' && res.data.length > 0) {
      results.robots.found = true;
      const lines = res.data.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      results.robots.rules = lines.slice(0, 30);
      results.robots.valid = lines.some(l => /^(user-agent|allow|disallow|sitemap)/i.test(l));
      if (!results.robots.valid) results.robots.issues.push('robots.txt exists but contains no valid directives.');
      if (/^disallow:\s*\/\s*$/mi.test(res.data)) results.robots.issues.push('WARNING: robots.txt blocks ALL crawlers with "Disallow: /".');
      if (!/^sitemap:/mi.test(res.data)) results.robots.issues.push('No Sitemap directive found in robots.txt — add one for faster discovery.');
    } else {
      results.robots.issues.push(`robots.txt not found (HTTP ${res.status}). Create one to control crawler access.`);
    }
  } catch (e) {
    results.robots.issues.push('Could not fetch robots.txt: ' + (e.code || e.message));
  }

  // Check sitemap.xml
  try {
    const res = await axios.get(`${origin}/sitemap.xml`, {
      timeout: 8000, validateStatus: () => true, responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuditPro-Bot/1.0)' }
    });
    if (res.status === 200 && typeof res.data === 'string') {
      if (res.data.includes('<sitemapindex')) {
        results.sitemap.found = true;
        results.sitemap.valid = true;
        results.sitemap.isIndex = true;
        results.sitemap.urlCount = (res.data.match(/<sitemap>/g) || []).length;
      } else if (res.data.includes('<url')) {
        results.sitemap.found = true;
        results.sitemap.urlCount = (res.data.match(/<loc>/g) || []).length;
        results.sitemap.valid = results.sitemap.urlCount > 0;
        if (!results.sitemap.valid) results.sitemap.issues.push('Sitemap XML found but contains no <url> entries.');
      } else {
        results.sitemap.issues.push('sitemap.xml returned 200 but is not valid XML sitemap format.');
      }
    } else {
      results.sitemap.issues.push(`sitemap.xml not found (HTTP ${res.status}). Create one for better indexation.`);
    }
  } catch (e) {
    results.sitemap.issues.push('Could not fetch sitemap.xml: ' + (e.code || e.message));
  }

  return results;
}

// ─── Broken Link Checker ─────────────────────────────────────────────────────

async function checkBrokenLinks(urls, maxLinks = 25) {
  const result = { totalOnPage: urls.length, checked: 0, broken: [], redirects: [], healthy: 0 };
  const unique = [...new Set(urls)].slice(0, maxLinks);
  result.checked = unique.length;

  const check = async (url) => {
    try {
      const res = await axios.head(url, {
        timeout: 8000, maxRedirects: 0, validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuditPro-Bot/1.0)' },
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
      });
      if (res.status >= 400) {
        result.broken.push({ url, status: res.status });
      } else if (res.status >= 300 && res.status < 400) {
        result.redirects.push({ url, status: res.status, location: res.headers.location || '(unknown)' });
        result.healthy++;
      } else {
        result.healthy++;
      }
    } catch (err) {
      result.broken.push({ url, status: 0, error: err.code || err.message });
    }
  };

  for (let i = 0; i < unique.length; i += 5) {
    await Promise.all(unique.slice(i, i + 5).map(check));
  }

  return result;
}

// ─── Core Analysis ────────────────────────────────────────────────────────────

function detectCrawlBlock({ statusCode, html, title, h1 }) {
  const signals = [];

  if (typeof statusCode === 'number') {
    if ([401, 403, 406, 409, 423, 429, 451, 503].includes(statusCode)) {
      signals.push(`HTTP ${statusCode}`);
    }
  }

  const sample = String(html || '').slice(0, 200_000);
  const haystack = `${title || ''}\n${h1 || ''}\n${sample}`.toLowerCase();

  const keywordSignals = [
    { key: 'captcha', re: /\b(captcha|recaptcha|g-recaptcha|hcaptcha)\b/i },
    { key: 'verify-human', re: /(verify\s+you\s+are\s+(a\s+)?human|are\s+you\s+a\s+human)/i },
    { key: 'access-denied', re: /(access\s+denied|forbidden|request\s+blocked|temporarily\s+blocked|unusual\s+traffic)/i },
    { key: 'cloudflare', re: /(cf-?chl|cloudflare|checking\s+your\s+browser)/i },
    { key: 'akamai', re: /(akamai|bot\s+manager)/i },
    { key: 'perimeterx', re: /(perimeterx|px-captcha)/i },
    { key: 'incapsula', re: /(incapsula|imperva)/i }
  ];

  for (const s of keywordSignals) {
    if (s.re.test(haystack)) signals.push(s.key);
  }

  const blocked = signals.length > 0;
  if (!blocked) return { blocked: false, reason: '', signals: [], httpStatusCode: typeof statusCode === 'number' ? statusCode : null };

  const reason = signals.includes('captcha') || signals.includes('verify-human')
    ? 'CAPTCHA / human verification'
    : signals.includes('access-denied') || signals.some(x => x.startsWith('HTTP 4'))
      ? 'Access denied / blocked'
      : signals.some(x => x.startsWith('HTTP 5'))
        ? 'Upstream/server protection'
        : 'Bot protection detected';

  return {
    blocked: true,
    reason,
    signals: [...new Set(signals)],
    httpStatusCode: typeof statusCode === 'number' ? statusCode : null
  };
}

function parseAndAnalyze(html, finalUrl, options = {}) {
  const $ = cheerio.load(html);
  const allIssues = { technicalSEO: [], onPageSEO: [], contentSEO: [], performance: [], accessibility: [] };
  let score = 100;

  // ── Raw data extraction ──────────────────────────────────
  const title          = $('title').first().text().trim();
  const metaDesc       = $('meta[name="description"]').attr('content') || '';
  const canonical      = $('link[rel="canonical"]').attr('href') || '';
  const robotsMeta     = $('meta[name="robots"]').attr('content') || '';
  const viewportMeta   = $('meta[name="viewport"]').attr('content') || '';
  const charsetMeta    = $('meta[charset]').attr('charset') || $('meta[http-equiv="Content-Type"]').attr('content') || '';
  const langAttr       = $('html').attr('lang') || '';
  const ogTitle        = $('meta[property="og:title"]').attr('content') || '';
  const ogDescription  = $('meta[property="og:description"]').attr('content') || '';
  const ogImage        = $('meta[property="og:image"]').attr('content') || '';
  const twitterCard    = $('meta[name="twitter:card"]').attr('content') || '';
  const schemaScripts  = $('script[type="application/ld+json"]').length;
  const h1s            = $('h1').map((_, el) => $(el).text().trim()).get();
  const h2s            = $('h2').map((_, el) => $(el).text().trim()).get();
  const h3s            = $('h3').map((_, el) => $(el).text().trim()).get();
  const hasHttps       = finalUrl.startsWith('https://');
  const htmlSize       = Buffer.byteLength(html, 'utf8');

  const crawlBlock = detectCrawlBlock({
    statusCode: options.statusCode,
    html,
    title,
    h1: h1s[0] || ''
  });

  // If the page is blocked by bot protection/CAPTCHA, return a minimal, non-misleading report.
  if (crawlBlock.blocked) {
    const blockedIssue = buildIssue(
      'crawl-blocked',
      'Crawl blocked by bot protection (audit incomplete)',
      'Technical SEO',
      'High',
      `We could not fetch the real page content for this URL. The server appears to be serving a CAPTCHA/security/blocked page to automated requests, so SEO signals and AI suggestions would be misleading.`,
      [
        'Try auditing a URL that is publicly accessible (no login, no geo restriction, no bot-check).',
        'Temporarily relax/disable bot protection for this page, or allowlist the audit user-agent.',
        'If using a CDN/WAF (Cloudflare/Akamai/etc.), ensure it allows crawler-like traffic for audits.'
      ]
    );

    const issues = { technicalSEO: [blockedIssue], onPageSEO: [], contentSEO: [], performance: [], accessibility: [] };

    return {
      url: finalUrl,
      auditDate: new Date().toISOString().split('T')[0],
      seoScore: 0,
      lighthouseSEOScore: 0,
      crawlBlock,

      pageMetadata: {
        title: title || '(none)',
        titleLength: title.length,
        metaDescription: metaDesc || '(none)',
        metaDescriptionLength: metaDesc.length,
        canonical: canonical || '(none)',
        robotsMeta: robotsMeta || 'index, follow (default)',
        viewportMeta: viewportMeta || '(none)',
        langAttribute: langAttr || '(none)',
        charsetDeclared: !!charsetMeta,
        openGraph: { title: ogTitle || '(none)', description: ogDescription || '(none)', image: ogImage || '(none)' },
        twitterCard: twitterCard || '(none)',
        schemaMarkupCount: schemaScripts,
        h1s,
        h2s: h2s.slice(0, 10),
        h3s: h3s.slice(0, 10),
        wordCount: 0,
        totalImages: 0,
        imagesWithAlt: 0,
        imagesWithoutAlt: 0,
        hasHttps,
        isNoIndex: /noindex/i.test(robotsMeta),
        isNoFollow: /nofollow/i.test(robotsMeta),
        internalLinks: 0,
        externalLinks: 0,
        blockingScripts: 0,
        blockingStylesheets: 0,
        htmlSizeKB: Math.round(htmlSize / 1024),
        accessibility: {
          hasSkipNav: false,
          hasMainLandmark: false,
          hasNavLandmark: false,
          hasHeaderLandmark: false,
          hasFooterLandmark: false,
          formInputsTotal: 0,
          formInputsWithoutLabel: 0,
          linksWithoutText: 0,
          buttonsWithoutText: 0,
          iframesWithoutTitle: 0,
          tablesWithoutHeaders: 0,
          autoplayMedia: 0
        }
      },

      issues,

      issuesSummary: {
        total: 1,
        high: 1,
        medium: 0,
        low: 0
      },

      optimizedMeta: null,
      actionPlan: {},

      // Legacy flat fields for backwards compatibility
      title: title || '(none)',
      metaDescription: metaDesc || '(none)',
      h1Count: h1s.length,
      imagesWithAlt: 0,
      imagesWithoutAlt: 0,
      hasHttps,
      securityHeaders: {},
      wordCount: 0,
      recommendations: [blockedIssue.title],
      collectedUrls: []
    };
  }

  // Images
  const images = $('img');
  let imagesWithAlt = 0, imagesWithoutAlt = 0, imagesWithoutDimensions = 0, imagesWithoutLazy = 0;
  images.each(function () {
    const alt = $(this).attr('alt');
    if (alt !== undefined && String(alt).trim() !== '') imagesWithAlt++;
    else imagesWithoutAlt++;
    if (!$(this).attr('width') || !$(this).attr('height')) imagesWithoutDimensions++;
    if ($(this).attr('loading') !== 'lazy') imagesWithoutLazy++;
  });
  const totalImages = images.length;

  // Links
  const allLinks = $('a[href]');
  let internalLinks = 0, externalLinks = 0;
  const collectedUrls = [];
  const urlOrigin = (() => { try { return new URL(finalUrl).origin; } catch { return ''; } })();
  allLinks.each(function () {
    const href = $(this).attr('href') || '';
    if (href.startsWith('/') || (urlOrigin && href.startsWith(urlOrigin))) {
      internalLinks++;
      collectedUrls.push(href.startsWith('/') ? urlOrigin + href : href);
    } else if (href.startsWith('http')) {
      externalLinks++;
      collectedUrls.push(href);
    }
  });

  // Render-blocking resources
  const blockingScripts = $('script:not([async]):not([defer]):not([type="application/ld+json"])').length;
  const blockingStyles  = $('link[rel="stylesheet"]').length;

  // Body text
  $('script, style, noscript').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  const topKeywords = extractTopKeywords(bodyText, 15);

  // Heading hierarchy check (H2 before H1, H3 without H2, etc.)
  let headingHierarchyOk = true;
  if (h2s.length > 0 && h1s.length === 0) headingHierarchyOk = false;
  if (h3s.length > 0 && h2s.length === 0) headingHierarchyOk = false;

  // noindex / nofollow detection
  const isNoIndex = /noindex/i.test(robotsMeta);
  const isNoFollow = /nofollow/i.test(robotsMeta);

  // ── Accessibility data extraction (WCAG 2.1) ────────────
  const skipNavLink = $('a[href="#main"], a[href="#content"], a[href="#maincontent"], .skip-nav, .skip-link, [class*="skip-to"], [class*="skip-nav"]').length > 0;
  const formInputs = $('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select');
  let inputsWithoutLabel = 0;
  formInputs.each(function () {
    const id = $(this).attr('id');
    const ariaLabel = $(this).attr('aria-label');
    const ariaLabelledBy = $(this).attr('aria-labelledby');
    const titleAttr = $(this).attr('title');
    const hasExplicitLabel = id ? $(`label[for="${id}"]`).length > 0 : false;
    const hasImplicitLabel = $(this).closest('label').length > 0;
    if (!hasExplicitLabel && !hasImplicitLabel && !ariaLabel && !ariaLabelledBy && !titleAttr) inputsWithoutLabel++;
  });
  const totalFormInputs = formInputs.length;
  const hasMainLandmark = $('main, [role="main"]').length > 0;
  const hasNavLandmark = $('nav, [role="navigation"]').length > 0;
  const hasHeaderLandmark = $('header, [role="banner"]').length > 0;
  const hasFooterLandmark = $('footer, [role="contentinfo"]').length > 0;
  const linksWithoutText = $('a[href]').filter(function () {
    return !$(this).text().trim() && !$(this).attr('aria-label') && !$(this).find('img[alt]').length;
  }).length;
  const buttonsWithoutText = $('button').filter(function () {
    return !$(this).text().trim() && !$(this).attr('aria-label') && !$(this).attr('aria-labelledby');
  }).length;
  const iframesWithoutTitle = $('iframe:not([title]), iframe[title=""]').length;
  const tablesWithoutHeaders = $('table').filter(function () {
    return $(this).find('th').length === 0 && !$(this).attr('role');
  }).length;
  const autoplayMedia = $('video[autoplay], audio[autoplay]').length;

  // ── TECHNICAL SEO ────────────────────────────────────────

  if (!hasHttps) {
    score -= 15;
    allIssues.technicalSEO.push(buildIssue(
      'no-https', 'Site Not Served Over HTTPS', 'Technical SEO', 'High',
      'HTTP sites are flagged as "Not Secure" by browsers, destroying user trust and damaging rankings. Google confirmed HTTPS as a direct ranking signal since 2014.',
      [
        'Purchase an SSL/TLS certificate from your hosting provider or use Let\'s Encrypt (free).',
        'Install and activate the certificate on your web server.',
        'Set up 301 redirects from all HTTP URLs to their HTTPS equivalents.',
        'Update all internal links, canonical tags, and sitemaps to use https://.',
        'Submit the HTTPS version to Google Search Console.'
      ]
    ));
  }

  if (!canonical) {
    score -= 8;
    allIssues.technicalSEO.push(buildIssue(
      'missing-canonical', 'Missing Canonical Tag', 'Technical SEO', 'High',
      'Without a canonical tag, search engines may index duplicate or near-duplicate pages, splitting link equity and causing ranking dilution.',
      [
        'Identify the preferred (canonical) URL for the page.',
        'Add a <link rel="canonical"> tag inside the <head> section.',
        'Ensure it uses the absolute, HTTPS URL including trailing slash consistency.',
        'Verify it matches the URL submitted in your sitemap.'
      ],
      `<link rel="canonical" href="${finalUrl}" />`
    ));
  }

  if (isNoIndex) {
    score -= 20;
    allIssues.technicalSEO.push(buildIssue(
      'noindex-detected', 'Page Is Blocked from Indexing (noindex)', 'Technical SEO', 'High',
      'A noindex directive tells search engines to exclude this page entirely from search results. If unintentional, this is catastrophic for organic visibility.',
      [
        'Open the <head> section and find: <meta name="robots" content="noindex">.',
        'Remove the noindex directive, or change it to <meta name="robots" content="index, follow">.',
        'Check your robots.txt to ensure the page is not disallowed.',
        'Fetch and render in Google Search Console to confirm indexability.'
      ],
      `<meta name="robots" content="index, follow" />`
    ));
  }

  if (!viewportMeta) {
    score -= 8;
    allIssues.technicalSEO.push(buildIssue(
      'missing-viewport', 'Missing Viewport Meta Tag', 'Technical SEO', 'High',
      'Without a viewport meta tag, mobile browsers render the page at desktop width and scale it down, making it unreadable and failing Google\'s mobile-first indexing requirements.',
      [
        'Add the viewport meta tag inside the <head> section.',
        'Use the standard value shown below.',
        'Test mobile rendering in Chrome DevTools (Ctrl+Shift+M).',
        'Run Google\'s Mobile-Friendly Test to confirm.'
      ],
      `<meta name="viewport" content="width=device-width, initial-scale=1.0" />`
    ));
  }

  if (!langAttr) {
    score -= 5;
    allIssues.technicalSEO.push(buildIssue(
      'missing-lang', 'Missing HTML lang Attribute', 'Technical SEO', 'Medium',
      'The lang attribute helps search engines understand the page language for correct localisation and aids screen readers for accessibility compliance (WCAG 2.1).',
      [
        'Identify the primary language of the page content.',
        'Add the lang attribute to the <html> tag.',
        'Use a valid BCP 47 language tag (e.g., "en", "en-US", "fr", "de").'
      ],
      `<html lang="en">`
    ));
  }

  if (!schemaScripts) {
    score -= 5;
    allIssues.technicalSEO.push(buildIssue(
      'missing-schema', 'No Structured Data (Schema Markup)', 'Technical SEO', 'Medium',
      'Structured data enables rich results (star ratings, FAQs, breadcrumbs) in SERPs, significantly increasing click-through rates by up to 30%.',
      [
        'Identify the most appropriate schema type: Article, Product, FAQ, LocalBusiness, etc.',
        'Generate JSON-LD markup using Google\'s Structured Data Markup Helper.',
        'Add the <script type="application/ld+json"> block inside the <head> tag.',
        'Test with Google\'s Rich Results Test tool.',
        'Monitor rich result eligibility in Google Search Console > Enhancements.'
      ],
      `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "${title || 'Page Title'}",
  "description": "${metaDesc || 'Page description'}",
  "url": "${finalUrl}"
}
</script>`
    ));
  }

  if (!ogTitle || !ogImage) {
    score -= 5;
    allIssues.technicalSEO.push(buildIssue(
      'missing-og-tags', 'Incomplete Open Graph (OG) Tags', 'Technical SEO', 'Medium',
      'When pages are shared on Facebook, LinkedIn, Slack, and iMessage, Open Graph tags control the preview title, description, and image shown. Missing OG tags result in ugly, poor-performing social shares that reduce traffic.',
      [
        'Add og:title, og:description, og:image, og:url, and og:type to the <head>.',
        'Ensure og:image is at least 1200×630px for best results.',
        'Validate using the Facebook Sharing Debugger tool.',
        'Add Twitter Card tags alongside for full social coverage.'
      ],
      `<meta property="og:title" content="${title || 'Your Page Title'}" />
<meta property="og:description" content="${metaDesc || 'Your page description.'}" />
<meta property="og:image" content="https://yourdomain.com/og-image.jpg" />
<meta property="og:url" content="${finalUrl}" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title || 'Your Page Title'}" />
<meta name="twitter:description" content="${metaDesc || 'Your page description.'}" />`
    ));
  }

  if (!charsetMeta) {
    score -= 3;
    allIssues.technicalSEO.push(buildIssue(
      'missing-charset', 'Missing Character Encoding Declaration', 'Technical SEO', 'Low',
      'Without charset declaration, browsers may misinterpret special characters, causing garbled text. It must appear within the first 1024 bytes of the HTML.',
      [
        'Add <meta charset="UTF-8"> as the very first tag inside <head>.'
      ],
      `<meta charset="UTF-8" />`
    ));
  }

  // ── ON-PAGE SEO ──────────────────────────────────────────

  if (!title) {
    score -= 15;
    allIssues.onPageSEO.push(buildIssue(
      'missing-title', 'Missing Title Tag', 'On-page SEO', 'High',
      'The title tag is the most important on-page SEO element. It appears as the blue clickable link in SERPs. Missing it means Google writes its own title, usually poorly.',
      [
        'Add a <title> tag inside the <head> section.',
        'Keep it between 50-60 characters (600px display width).',
        'Place your primary keyword near the beginning.',
        'Each page must have a unique title tag.',
        'Format: Primary Keyword – Secondary Keyword | Brand Name'
      ],
      `<title>Primary Keyword – Secondary Keyword | Brand Name</title>`
    ));
  } else if (title.length < 30) {
    score -= 7;
    allIssues.onPageSEO.push(buildIssue(
      'title-too-short', `Title Tag Too Short (${title.length} chars)`, 'On-page SEO', 'Medium',
      `Your title is only ${title.length} characters. Titles under 30 characters waste valuable space for keywords and context that influence both rankings and click-through rates.`,
      [
        'Expand the title to 50-60 characters.',
        'Include your primary keyword and a value proposition.',
        'Add your brand name at the end separated by | or –.',
        'Avoid keyword stuffing — write for human readability first.'
      ],
      `<title>${title} – A More Descriptive Title | Brand</title>`
    ));
  } else if (title.length > 60) {
    score -= 5;
    allIssues.onPageSEO.push(buildIssue(
      'title-too-long', `Title Tag Too Long (${title.length} chars)`, 'On-page SEO', 'Medium',
      `Titles longer than 60 characters get truncated in SERPs with "…", hiding important keywords and reducing the click-through rate. Google re-writes ~60% of titles that exceed this limit.`,
      [
        'Trim the title to under 60 characters (ideally 50-55).',
        'Keep the primary keyword in the first 50 characters.',
        'Remove filler words like "Welcome to" or "Official Site of".',
        'Test with Moz Title Tag Preview Tool.'
      ]
    ));
  }

  if (!metaDesc) {
    score -= 12;
    allIssues.onPageSEO.push(buildIssue(
      'missing-meta-description', 'Missing Meta Description', 'On-page SEO', 'High',
      'The meta description is the snippet shown below your title in SERPs. While not a direct ranking factor, it is the primary driver of click-through rate. Missing it means Google auto-generates one, often poorly.',
      [
        'Write a unique, compelling meta description for every important page.',
        'Target 120-155 characters.',
        'Include your primary keyword naturally.',
        'Include a call-to-action (e.g., "Learn more", "Get started free", "Shop now").',
        'Avoid duplicate meta descriptions across pages.'
      ],
      `<meta name="description" content="Your compelling 120-155 character description with primary keyword and a clear CTA." />`
    ));
  } else if (metaDesc.length < 120) {
    score -= 5;
    allIssues.onPageSEO.push(buildIssue(
      'meta-desc-too-short', `Meta Description Too Short (${metaDesc.length} chars)`, 'On-page SEO', 'Medium',
      `A ${metaDesc.length}-character meta description leaves unused SERP space. Longer, richer descriptions give users more reason to click and signal relevance to search engines.`,
      [
        'Expand the meta description to 120-155 characters.',
        'Add supporting keywords, benefits, or a call-to-action.',
        'Ensure it accurately summarises page content.'
      ]
    ));
  } else if (metaDesc.length > 160) {
    score -= 3;
    allIssues.onPageSEO.push(buildIssue(
      'meta-desc-too-long', `Meta Description Too Long (${metaDesc.length} chars)`, 'On-page SEO', 'Low',
      `Meta descriptions over 160 characters are truncated with "…" in Google SERPs, cutting off your message and CTA.`,
      [
        'Shorten the meta description to 120-155 characters.',
        'Ensure the CTA appears in the first 150 characters.',
        'Preview with a SERP snippet simulator.'
      ]
    ));
  }

  if (h1s.length === 0) {
    score -= 10;
    allIssues.onPageSEO.push(buildIssue(
      'missing-h1', 'No H1 Heading Found', 'On-page SEO', 'High',
      'The H1 is the primary on-page SEO signal after the title tag. It tells both users and search engines the main topic of the page. Every page must have exactly one H1.',
      [
        'Add a single <h1> tag at the top of the main content area.',
        'Include your primary target keyword in the H1.',
        'Keep it concise (20-70 characters) and descriptive.',
        'The H1 can differ from the title tag — use the space to be more descriptive.'
      ],
      `<h1>Your Primary Keyword – Compelling Page Heading</h1>`
    ));
  } else if (h1s.length > 1) {
    score -= 5;
    allIssues.onPageSEO.push(buildIssue(
      'multiple-h1', `Multiple H1 Tags Found (${h1s.length})`, 'On-page SEO', 'Medium',
      `Having ${h1s.length} H1 tags dilutes your keyword relevance signal. Search engines use the H1 to understand the primary page topic; multiple H1s create ambiguity.`,
      [
        'Audit all H1 elements in the page source.',
        'Keep only one H1 as the primary page heading.',
        'Demote secondary H1s to H2 or H3 depending on hierarchy.',
        'Ensure the remaining H1 contains your primary keyword.'
      ]
    ));
  }

  if (imagesWithoutAlt > 0) {
    score -= Math.min(10, imagesWithoutAlt * 2);
    allIssues.onPageSEO.push(buildIssue(
      'missing-alt-text', `${imagesWithoutAlt} Image(s) Missing Alt Text`, 'On-page SEO', imagesWithoutAlt > 3 ? 'High' : 'Medium',
      'Alt text is the primary way search engines understand image content. Missing alt text means missed keyword opportunities, failed image search rankings, and WCAG accessibility violations.',
      [
        'Identify all <img> tags with missing or empty alt attributes.',
        'Write descriptive alt text for each image (3-8 words describing the image content).',
        'Include target keywords naturally where relevant — avoid keyword stuffing.',
        'Use empty alt="" only for purely decorative images.',
        'Run an axe or WAVE accessibility scan to find all instances.'
      ],
      `<img src="/images/image.jpg" alt="Descriptive keyword-rich alt text" width="800" height="600" />`
    ));
  }

  if (!headingHierarchyOk) {
    score -= 5;
    allIssues.onPageSEO.push(buildIssue(
      'heading-hierarchy', 'Improper Heading Hierarchy', 'On-page SEO', 'Medium',
      'Skipping heading levels (e.g., H3 without H2, or H2 without H1) breaks the semantic document outline. Search engines use heading hierarchy to understand content structure and topic relationships.',
      [
        'Ensure every page starts with a single H1.',
        'Use H2 for major sections, H3 for sub-sections beneath an H2.',
        'Never skip a level (e.g., H1 → H3 is wrong; H1 → H2 → H3 is correct).',
        'Validate with a browser heading outline tool or HeadingsMap extension.'
      ]
    ));
  }

  if (internalLinks < 3) {
    score -= 5;
    allIssues.onPageSEO.push(buildIssue(
      'low-internal-links', `Low Internal Link Count (${internalLinks})`, 'On-page SEO', 'Medium',
      'Internal links distribute PageRank across your site, help search engines discover and index deeper pages, and keep users engaged. Fewer than 3 internal links is a missed SEO opportunity.',
      [
        'Identify 3-5 relevant pages on your site that relate to this page\'s topic.',
        'Add contextual anchor links within the body copy using descriptive keyword-rich anchor text.',
        'Avoid generic anchor text like "click here" or "read more".',
        'Add a "Related Articles" or "You May Also Like" section at the bottom.',
        'Ensure the homepage links to this page (if it is important).'
      ]
    ));
  }

  // ── CONTENT SEO ──────────────────────────────────────────

  if (wordCount < 300) {
    score -= 10;
    allIssues.contentSEO.push(buildIssue(
      'thin-content', `Thin Content (${wordCount} words)`, 'Content SEO', 'High',
      `Google\'s Panda algorithm specifically targets thin content. Pages with fewer than 300 words are often seen as low-quality and are less likely to rank for competitive queries. The average first-page Google result has 1,447 words.`,
      [
        'Research the top 10 ranking pages for your target keyword — note average word counts.',
        'Expand the page by covering sub-topics, FAQs, examples, and use cases.',
        'Add an FAQ section targeting long-tail questions (People Also Ask).',
        'Include statistics, data, or original research to increase E-E-A-T signals.',
        'Target 1,000–1,500+ words for informational pages, 500+ for product/service pages.'
      ]
    ));
  } else if (wordCount < 600) {
    score -= 5;
    allIssues.contentSEO.push(buildIssue(
      'short-content', `Content Could Be Expanded (${wordCount} words)`, 'Content SEO', 'Medium',
      `${wordCount} words is below average for most ranking pages. Longer, comprehensive content tends to rank higher, earn more backlinks, and cover a wider range of related search queries.`,
      [
        'Analyse SERP competitors to determine optimal content depth.',
        'Add relevant sub-sections addressing related user questions.',
        'Include a structured FAQ section for long-tail query coverage.',
        'Target at least 1,000 words for blog posts and guides.'
      ]
    ));
  }

  if (h2s.length < 2) {
    score -= 4;
    allIssues.contentSEO.push(buildIssue(
      'insufficient-h2s', `Too Few H2 Headings (${h2s.length})`, 'Content SEO', 'Medium',
      'H2 headings create a scannable content hierarchy, improving user experience and dwell time. They also provide additional keyword signal opportunities and help Google understand content sections.',
      [
        'Divide the page content into logical sections, each introduced by an H2.',
        'Use target and related keywords as anchor text in H2s.',
        'Aim for one H2 per major topic (typically every 300-400 words).',
        'Use H3s for sub-points within each H2 section.'
      ]
    ));
  }

  if (totalImages === 0) {
    score -= 3;
    allIssues.contentSEO.push(buildIssue(
      'no-images', 'No Images on Page', 'Content SEO', 'Low',
      'Pages with no images provide a poor user experience and miss image search traffic. Visuals reduce bounce rate, increase time-on-page, and support content comprehension.',
      [
        'Add at least one relevant, high-quality image.',
        'Use original images where possible for uniqueness.',
        'Compress images with tools like TinyPNG or Squoosh.',
        'Add descriptive alt text and filename with keywords.',
        'Consider adding an infographic, chart, or screenshot.'
      ]
    ));
  }

  // ── PERFORMANCE ──────────────────────────────────────────

  if (htmlSize > 100000) {
    score -= 5;
    allIssues.performance.push(buildIssue(
      'large-html-size', `Large HTML Page Size (${Math.round(htmlSize / 1024)}KB)`, 'Performance', 'Medium',
      'HTML documents over 100KB take longer to download, parse, and render. Large HTML sizes increase Time to First Byte (TTFB), delay First Contentful Paint (FCP), and hurt Core Web Vitals scores.',
      [
        'Remove comments, whitespace, and inline styles by enabling HTML minification.',
        'Move large inline JavaScript/CSS to external files that can be cached.',
        'Enable GZIP or Brotli compression on your web server.',
        'Check for and remove any large inline SVGs or Base64-encoded images.',
        'For Node.js: use the `compression` middleware package.'
      ],
      `// Express.js — add Brotli/GZIP compression
const compression = require('compression');
app.use(compression());`
    ));
  }

  if (blockingScripts > 3) {
    score -= 6;
    allIssues.performance.push(buildIssue(
      'render-blocking-scripts', `${blockingScripts} Render-Blocking Scripts`, 'Performance', 'High',
      `${blockingScripts} synchronous <script> tags block HTML parsing, delaying First Contentful Paint (FCP) and Largest Contentful Paint (LCP) — both critical Core Web Vitals. Google uses Core Web Vitals as a ranking factor.`,
      [
        'Add the async attribute to scripts that don\'t depend on DOM ready.',
        'Add the defer attribute to scripts that need the DOM but don\'t need to run immediately.',
        'Move non-critical scripts to just before the closing </body> tag.',
        'Use a script loading strategy (e.g., loadScript() only when needed).',
        'Audit with Chrome DevTools > Performance > Coverage tab.'
      ],
      `<!-- Use async for independent scripts (e.g., analytics) -->
<script src="/js/analytics.js" async></script>

<!-- Use defer for DOM-dependent scripts -->
<script src="/js/main.js" defer></script>`
    ));
  }

  if (blockingStyles > 3) {
    score -= 4;
    allIssues.performance.push(buildIssue(
      'render-blocking-styles', `${blockingStyles} Render-Blocking Stylesheets`, 'Performance', 'Medium',
      `${blockingStyles} stylesheet <link> tags in the <head> block rendering until all CSS is downloaded and parsed, even if most of the CSS is not needed for the initial view.`,
      [
        'Inline critical CSS (above-the-fold styles) directly in the <head>.',
        'Load non-critical CSS asynchronously using rel="preload".',
        'Remove unused CSS with tools like PurgeCSS or UnCSS.',
        'Combine multiple stylesheets into a single minified file.',
        'Use a CDN to serve CSS with optimal caching headers.'
      ],
      `<!-- Preload non-critical CSS asynchronously -->
<link rel="preload" href="styles.css" as="style" onload="this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="styles.css"></noscript>`
    ));
  }

  if (imagesWithoutDimensions > 0 && totalImages > 0) {
    score -= 4;
    allIssues.performance.push(buildIssue(
      'missing-image-dimensions', `${imagesWithoutDimensions} Image(s) Missing Width/Height`, 'Performance', 'Medium',
      'Images without explicit width and height attributes cause Cumulative Layout Shift (CLS) — a Core Web Vitals metric. The browser cannot reserve space for the image before it loads, causing content to jump.',
      [
        'Add explicit width and height attributes to all <img> tags.',
        'Use the actual image dimensions or set aspect ratios via CSS.',
        'For responsive images, use width/height attrs alongside CSS `max-width: 100%`.',
        'Target CLS score below 0.1 in Google PageSpeed Insights.'
      ],
      `<img src="/images/image.jpg" alt="Description" width="800" height="450" style="max-width:100%; height:auto;" />`
    ));
  }

  if (imagesWithoutLazy > 2 && totalImages > 0) {
    score -= 3;
    allIssues.performance.push(buildIssue(
      'missing-lazy-loading', `${imagesWithoutLazy} Image(s) Not Lazy-Loaded`, 'Performance', 'Low',
      'Loading all images on page load — especially below-the-fold images — wastes bandwidth, increases page weight, and slows Time to Interactive (TTI). Native lazy loading defers off-screen images until they are needed.',
      [
        'Add loading="lazy" to all below-the-fold images.',
        'Do NOT add loading="lazy" to hero/above-the-fold images (it hurts LCP).',
        'Combine with proper width and height to prevent CLS.',
        'Test with Chrome DevTools > Network tab (throttle to 3G to see the effect).'
      ],
      `<img src="below-fold.jpg" alt="Description" width="800" height="600" loading="lazy" />`
    ));
  }

  // ── ACCESSIBILITY (WCAG 2.1) ─────────────────────────────

  if (!langAttr) {
    allIssues.accessibility.push(buildIssue(
      'a11y-missing-lang', 'Missing HTML lang Attribute (WCAG 3.1.1)', 'Accessibility', 'High',
      'Screen readers rely on the lang attribute to set the correct pronunciation, voice, and dialect. Without it, assistive technology may mispronounce all content on the page.',
      ['Add lang="en" (or appropriate language code) to the opening <html> tag.', 'Use valid BCP 47 language tags.', 'For multi-language pages, use lang attributes on specific sections.'],
      '<html lang="en">'
    ));
    score -= 3;
  }

  if (!hasMainLandmark) {
    allIssues.accessibility.push(buildIssue(
      'a11y-no-main-landmark', 'No Main Landmark Found (WCAG 1.3.1)', 'Accessibility', 'High',
      'The <main> landmark allows screen reader users to skip directly to the primary content. Without it, users must tab through every navigation item on every page load.',
      ['Wrap the primary page content in a <main> element.', 'Ensure only one <main> landmark exists per page.', 'Alternatively, use role="main" on the wrapper div.'],
      '<main>\n  <!-- primary page content -->\n</main>'
    ));
    score -= 3;
  }

  if (!hasNavLandmark) {
    allIssues.accessibility.push(buildIssue(
      'a11y-no-nav-landmark', 'No Navigation Landmark Found (WCAG 1.3.1)', 'Accessibility', 'Medium',
      'Screen readers list all landmarks for quick navigation. A missing <nav> landmark forces users to guess where navigation links begin and end.',
      ['Wrap the site navigation in a <nav> element.', 'Use aria-label if there are multiple <nav> regions (e.g., "Main navigation", "Footer navigation").']
    ));
    score -= 2;
  }

  if (!skipNavLink) {
    allIssues.accessibility.push(buildIssue(
      'a11y-no-skip-nav', 'No Skip Navigation Link (WCAG 2.4.1)', 'Accessibility', 'Medium',
      'Keyboard-only users and screen reader users must tab through every navigation link before reaching content. A skip link lets them bypass repetitive blocks.',
      ['Add a visually hidden "Skip to main content" link as the first focusable element.', 'Link it to the <main> element using href="#main" and id="main".', 'Make it visible on focus for keyboard users.'],
      '<a href="#main" class="skip-link">Skip to main content</a>'
    ));
    score -= 2;
  }

  if (inputsWithoutLabel > 0) {
    allIssues.accessibility.push(buildIssue(
      'a11y-inputs-without-labels', `${inputsWithoutLabel} Form Input(s) Without Accessible Labels (WCAG 1.3.1)`, 'Accessibility', 'High',
      'Form inputs without associated labels are invisible to screen readers. Users cannot determine what data to enter, making forms unusable for visually impaired visitors.',
      ['Add a <label for="input-id"> element for each input.', 'Alternatively, use aria-label or aria-labelledby attributes.', 'Placeholder text alone is NOT a valid label.'],
      '<label for="email">Email address</label>\n<input type="email" id="email" name="email" />'
    ));
    score -= Math.min(5, inputsWithoutLabel * 2);
  }

  if (linksWithoutText > 0) {
    allIssues.accessibility.push(buildIssue(
      'a11y-links-without-text', `${linksWithoutText} Link(s) Without Accessible Text (WCAG 2.4.4)`, 'Accessibility', linksWithoutText > 3 ? 'High' : 'Medium',
      'Links without visible text or aria-label are announced by screen readers as just "link" — users have no idea where the link goes.',
      ['Add descriptive text inside each <a> tag.', 'For icon-only links, add aria-label describing the destination.', 'If the link wraps an image, ensure the image has descriptive alt text.'],
      '<a href="/about" aria-label="Learn more about us"><svg>...</svg></a>'
    ));
    score -= Math.min(5, linksWithoutText);
  }

  if (buttonsWithoutText > 0) {
    allIssues.accessibility.push(buildIssue(
      'a11y-buttons-without-text', `${buttonsWithoutText} Button(s) Without Accessible Text (WCAG 4.1.2)`, 'Accessibility', 'High',
      'Buttons without text or aria-label are announced as just "button" by screen readers, providing no information about the action.',
      ['Add visible text to buttons.', 'For icon buttons, add aria-label describing the action.', 'Test with a screen reader to verify announcements.'],
      '<button aria-label="Close dialog"><svg>...</svg></button>'
    ));
    score -= Math.min(4, buttonsWithoutText * 2);
  }

  if (iframesWithoutTitle > 0) {
    allIssues.accessibility.push(buildIssue(
      'a11y-iframes-without-title', `${iframesWithoutTitle} Iframe(s) Without Title (WCAG 2.4.1)`, 'Accessibility', 'Medium',
      'Screen readers announce iframes but cannot describe their content without a title attribute.',
      ['Add a descriptive title attribute to every <iframe>.', 'Hide decorative iframes with aria-hidden="true".'],
      '<iframe src="map.html" title="Store location map"></iframe>'
    ));
    score -= 2;
  }

  if (tablesWithoutHeaders > 0) {
    allIssues.accessibility.push(buildIssue(
      'a11y-tables-without-headers', `${tablesWithoutHeaders} Data Table(s) Without Headers (WCAG 1.3.1)`, 'Accessibility', 'Medium',
      'Data tables without <th> elements force screen reader users to guess what each cell represents.',
      ['Add <th> elements for column and/or row headers.', 'Use scope="col" or scope="row" on <th> elements.', 'For layout tables, add role="presentation".'],
      '<table>\n  <thead><tr><th scope="col">Name</th><th scope="col">Price</th></tr></thead>\n</table>'
    ));
    score -= 2;
  }

  if (autoplayMedia > 0) {
    allIssues.accessibility.push(buildIssue(
      'a11y-autoplay-media', `${autoplayMedia} Autoplaying Media Element(s) (WCAG 1.4.2)`, 'Accessibility', 'Medium',
      'Autoplaying audio/video can disorient users, interfere with screen readers, and violate WCAG 1.4.2.',
      ['Remove the autoplay attribute.', 'If autoplay is essential, ensure media is muted by default with visible pause/stop controls.']
    ));
    score -= 2;
  }

  if (imagesWithoutAlt > 0) {
    allIssues.accessibility.push(buildIssue(
      'a11y-images-without-alt', `${imagesWithoutAlt} Image(s) Without Alt Text (WCAG 1.1.1)`, 'Accessibility', imagesWithoutAlt > 3 ? 'High' : 'Medium',
      'Images without alt text are invisible to screen readers. WCAG 1.1.1 requires all non-decorative images to have text alternatives.',
      ['Add descriptive alt text to all meaningful images.', 'Use alt="" (empty) only for purely decorative images.', 'Avoid alt text like "image" or "photo" — describe the content.']
    ));
  }

  // ── Final score ──────────────────────────────────────────
  score = Math.max(0, Math.min(100, score));

  // ── Optimized Meta Generation ────────────────────────────
  const optimizedMetaDescription = (metaDesc.length >= 120 && metaDesc.length <= 160)
    ? metaDesc
    : generateMetaDescription(bodyText, title);

  const semanticKeywords = topKeywords.slice(0, 3).length > 0
    ? topKeywords.slice(0, 3)
    : ['digital marketing', 'online strategy', 'website optimization'];

  const improvedH1Text = improveH1(h1s[0] || '', topKeywords);

  // ── Internal Linking Suggestions ────────────────────────
  const internalLinkSuggestions = [
    {
      anchorText: topKeywords[0] ? `${topKeywords[0].charAt(0).toUpperCase() + topKeywords[0].slice(1)} Guide` : 'Related Guide',
      suggestedTarget: '/blog/guide',
      rationale: `Link to a supporting article about "${topKeywords[0] || 'your primary topic'}" to strengthen topical authority and pass internal PageRank.`
    },
    {
      anchorText: topKeywords[1] ? `${topKeywords[1].charAt(0).toUpperCase() + topKeywords[1].slice(1)} Resources` : 'Resources Page',
      suggestedTarget: '/resources',
      rationale: `A contextual link to your resources or category page helps crawlers discover related content and increases dwell time.`
    }
  ];

  // ── 30-Day Action Plan ────────────────────────────────────
  const allIssuesList = [
    ...allIssues.technicalSEO,
    ...allIssues.onPageSEO,
    ...allIssues.contentSEO,
    ...allIssues.performance,
    ...allIssues.accessibility
  ];

  const highImpact   = allIssuesList.filter(i => i.impact === 'High');
  const mediumImpact = allIssuesList.filter(i => i.impact === 'Medium');
  const lowImpact    = allIssuesList.filter(i => i.impact === 'Low');

  const planTask = (issue) => ({
    task: issue.title,
    category: issue.category,
    impact: issue.impact,
    issueId: issue.id
  });

  const actionPlan = {
    week1_days1to7: {
      focus: 'Critical Fixes — High-Impact Technical & On-Page Issues',
      tasks: highImpact.slice(0, 4).map(planTask).concat(
        highImpact.length === 0
          ? [{ task: 'Perform full site crawl with Screaming Frog to find indexability issues', category: 'Technical SEO', impact: 'High', issueId: 'crawl-audit' }]
          : []
      )
    },
    week2_days8to14: {
      focus: 'On-Page Optimisation — Titles, Meta, H1s, Alt Text',
      tasks: mediumImpact.slice(0, 4).map(planTask).concat([
        { task: 'Set up Google Search Console and submit XML sitemap', category: 'Technical SEO', impact: 'Medium', issueId: 'gsc-setup' },
        { task: 'Identify 10 target keywords using Google Keyword Planner or Ahrefs', category: 'Content SEO', impact: 'Medium', issueId: 'keyword-research' }
      ]).slice(0, 5)
    },
    week3_days15to21: {
      focus: 'Content Depth & Structured Data',
      tasks: [
        { task: 'Expand thin pages to 1,000+ words with FAQ sections', category: 'Content SEO', impact: 'High', issueId: 'content-expansion' },
        { task: 'Implement JSON-LD schema markup for primary page type', category: 'Technical SEO', impact: 'Medium', issueId: 'schema-implementation' },
        { task: 'Add Open Graph and Twitter Card tags to all key pages', category: 'Technical SEO', impact: 'Medium', issueId: 'social-meta-tags' },
        ...lowImpact.slice(0, 2).map(planTask)
      ]
    },
    week4_days22to30: {
      focus: 'Performance, Monitoring & Link Building Foundation',
      tasks: [
        { task: 'Run PageSpeed Insights and fix Core Web Vitals issues (CLS, LCP, FID)', category: 'Performance', impact: 'High', issueId: 'core-web-vitals' },
        { task: 'Enable compression (gzip/brotli) and browser caching on server', category: 'Performance', impact: 'Medium', issueId: 'compression-caching' },
        { task: 'Build 3 internal links from high-authority pages to this page', category: 'On-page SEO', impact: 'Medium', issueId: 'internal-linking' },
        { task: 'Set up Google Analytics 4 and define conversion goals', category: 'Technical SEO', impact: 'Medium', issueId: 'ga4-setup' },
        { task: 'Launch outreach campaign for 5 quality backlinks', category: 'Content SEO', impact: 'Medium', issueId: 'link-building' }
      ]
    }
  };

  // ── Final Result Object ─────────────────────────────────
  return {
    url: finalUrl,
    auditDate: new Date().toISOString().split('T')[0],
    seoScore: score,
    lighthouseSEOScore: score,
    crawlBlock,

    pageMetadata: {
      title: title || '(none)',
      titleLength: title.length,
      metaDescription: metaDesc || '(none)',
      metaDescriptionLength: metaDesc.length,
      canonical: canonical || '(none)',
      robotsMeta: robotsMeta || 'index, follow (default)',
      viewportMeta: viewportMeta || '(none)',
      langAttribute: langAttr || '(none)',
      charsetDeclared: !!charsetMeta,
      openGraph: { title: ogTitle || '(none)', description: ogDescription || '(none)', image: ogImage || '(none)' },
      twitterCard: twitterCard || '(none)',
      schemaMarkupCount: schemaScripts,
      h1s,
      h2s: h2s.slice(0, 10),
      h3s: h3s.slice(0, 10),
      wordCount,
      totalImages,
      imagesWithAlt,
      imagesWithoutAlt,
      hasHttps,
      isNoIndex,
      isNoFollow,
      internalLinks,
      externalLinks,
      blockingScripts,
      blockingStylesheets: blockingStyles,
      htmlSizeKB: Math.round(htmlSize / 1024),
      accessibility: {
        hasSkipNav: skipNavLink,
        hasMainLandmark,
        hasNavLandmark,
        hasHeaderLandmark,
        hasFooterLandmark,
        formInputsTotal: totalFormInputs,
        formInputsWithoutLabel: inputsWithoutLabel,
        linksWithoutText,
        buttonsWithoutText,
        iframesWithoutTitle,
        tablesWithoutHeaders,
        autoplayMedia
      }
    },

    issues: allIssues,

    issuesSummary: {
      total: allIssuesList.length,
      high: highImpact.length,
      medium: mediumImpact.length,
      low: lowImpact.length
    },

    optimizedMeta: {
      metaDescription: optimizedMetaDescription,
      improvedH1: improvedH1Text,
      semanticKeywords,
      internalLinkingSuggestions: internalLinkSuggestions
    },

    actionPlan,

    // Legacy flat fields for backwards compatibility
    title: title || '(none)',
    metaDescription: metaDesc || '(none)',
    h1Count: h1s.length,
    imagesWithAlt,
    imagesWithoutAlt,
    hasHttps,
    securityHeaders: {},
    wordCount,
    recommendations: allIssuesList.map(i => i.title),
    collectedUrls: collectedUrls.slice(0, 50)
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function runAudit(url) {
  const { html, finalUrl, statusCode } = await fetchHtml(url);
  const analysis = parseAndAnalyze(html, finalUrl, { statusCode });

  // Run additional async checks in parallel (failures return null/empty)
  const [pageSpeedInsights, sitemapRobots, brokenLinks] = await Promise.all([
    fetchPageSpeedInsights(finalUrl).catch(() => null),
    fetchSitemapAndRobots(finalUrl).catch(() => ({ sitemap: { found: false, issues: ['Check failed'] }, robots: { found: false, issues: ['Check failed'] } })),
    checkBrokenLinks(analysis.collectedUrls || [], 25).catch(() => ({ totalOnPage: 0, checked: 0, broken: [], redirects: [], healthy: 0 }))
  ]);

  return {
    ...analysis,
    url: finalUrl,
    httpStatusCode: statusCode,
    pageSpeedInsights,
    sitemapRobots,
    brokenLinks
  };
}

module.exports = { runAudit, fetchHtml, parseAndAnalyze, fetchPageSpeedInsights, fetchSitemapAndRobots, checkBrokenLinks };
