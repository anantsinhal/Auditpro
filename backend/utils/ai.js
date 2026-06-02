const { GoogleGenerativeAI } = require('@google/generative-ai');

// Retry configuration
const RETRY_CONFIG = {
  maxAttempts: parseInt(process.env.AI_RETRY_ATTEMPTS || '3', 10),
  initialDelayMs: parseInt(process.env.AI_RETRY_DELAY_MS || '1000', 10),
  maxDelayMs: parseInt(process.env.AI_RETRY_MAX_DELAY_MS || '10000', 10),
  backoffMultiplier: 2
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  // Retryable: 503 (Service Unavailable), 429 (Rate Limited), 502 (Bad Gateway), 504 (Gateway Timeout)
  if (error.status && [429, 502, 503, 504].includes(error.status)) {
    return true;
  }
  // Check error message for service unavailability indicators
  const message = (error.message || '').toLowerCase();
  return message.includes('service unavailable') || 
         message.includes('temporarily') || 
         message.includes('too many requests') ||
         message.includes('timeout');
}

async function retryWithBackoff(fn, context = 'API call') {
  let lastError;
  let delay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry if it's not a retryable error
      if (!isRetryableError(error)) {
        throw error;
      }

      // Don't sleep on last attempt
      if (attempt < RETRY_CONFIG.maxAttempts) {
        console.warn(
          `[AI] ${context} attempt ${attempt}/${RETRY_CONFIG.maxAttempts} failed: ${error.message}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
        delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
      }
    }
  }

  // All retries exhausted
  console.error(`[AI] ${context} failed after ${RETRY_CONFIG.maxAttempts} attempts`);
  throw lastError;
}

function normalizeModelName(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
}

function getModelName() {
  return normalizeModelName(process.env.GEMINI_MODEL) || 'gemini-2.5-flash';
}

function clampArray(value, max) {
  if (!Array.isArray(value)) return [];
  if (value.length <= max) return value;
  return value.slice(value.length - max);
}

function safeText(value, maxLen) {
  const text = typeof value === 'string' ? value : '';
  const trimmed = text.trim();
  if (!maxLen || trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen);
}

function getClient() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

function createEmptyInsights() {
  return {
    executiveSummary: '',
    recommendedTitle: '',
    recommendedMetaDescription: '',
    recommendedH1: '',
    priorityFixes: [],
    keywordOpportunities: [],
    actionPlan: {}
  };
}

function extractJsonObject(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return null;

  // Remove fenced code blocks if present.
  const noFences = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Prefer first JSON object found.
  const firstBrace = noFences.indexOf('{');
  const lastBrace = noFences.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return noFences.slice(firstBrace, lastBrace + 1);
}

function coerceInsightsShape(value) {
  const empty = createEmptyInsights();
  if (!value || typeof value !== 'object') return empty;

  const priorityFixes = Array.isArray(value.priorityFixes)
    ? value.priorityFixes
        .map((x) => {
          if (!x || typeof x !== 'object') return null;
          const title = safeText(x.title, 140);
          const severity = safeText(x.severity, 20);
          const whyItMatters = safeText(x.whyItMatters, 500);
          const howToFix = safeText(x.howToFix, 800);
          return (title || howToFix || whyItMatters)
            ? { title, severity, whyItMatters, howToFix }
            : null;
        })
        .filter(Boolean)
    : [];

  const keywordOpportunities = Array.isArray(value.keywordOpportunities)
    ? value.keywordOpportunities
        .map((x) => {
          if (typeof x === 'string') return safeText(x, 80);
          if (!x || typeof x !== 'object') return '';
          return safeText(x.keyword || x.term, 80);
        })
        .filter(Boolean)
    : [];

  const actionPlan = (value.actionPlan && typeof value.actionPlan === 'object') ? value.actionPlan : {};

  return {
    executiveSummary: safeText(value.executiveSummary, 2000),
    recommendedTitle: safeText(value.recommendedTitle, 120),
    recommendedMetaDescription: safeText(value.recommendedMetaDescription, 240),
    recommendedH1: safeText(value.recommendedH1, 140),
    priorityFixes,
    keywordOpportunities,
    actionPlan
  };
}

async function generateInsights(auditData) {
  const client = getClient();
  if (!client) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = client.getGenerativeModel({ model: getModelName() });

  const prompt = `You are an expert SEO consultant.

Convert the provided structured SEO audit data into an actionable report.

Return ONLY valid JSON matching EXACTLY this shape:
{
  "executiveSummary": "",
  "recommendedTitle": "",
  "recommendedMetaDescription": "",
  "recommendedH1": "",
  "priorityFixes": [
    { "severity": "High|Medium|Low", "title": "", "whyItMatters": "", "howToFix": "" }
  ],
  "keywordOpportunities": [""],
  "actionPlan": {
    "week1": [],
    "week2": [],
    "week3": [],
    "week4": []
  }
}

Rules:
- Use ONLY the provided data
- No markdown, no code fences, no commentary
- Keep strings concise and practical
- Provide up to 5 priorityFixes and up to 12 keywordOpportunities

DATA:
${JSON.stringify(auditData)}`;

  const response = await retryWithBackoff(
    () => model.generateContent(prompt),
    'generateInsights'
  );
  const result = await response.response;

  const rawText = (result.text() || '').trim();
  const jsonText = extractJsonObject(rawText);
  if (!jsonText) {
    const fallback = createEmptyInsights();
    fallback.executiveSummary = safeText(rawText, 2000);
    return fallback;
  }

  try {
    const parsed = JSON.parse(jsonText);
    return coerceInsightsShape(parsed);
  } catch (e) {
    const fallback = createEmptyInsights();
    fallback.executiveSummary = safeText(rawText, 2000);
    return fallback;
  }
}

async function generateAssistantReply({ message, history, page, image, context }) {
  const client = getClient();
  if (!client) {
    const err = new Error('GEMINI_API_KEY is not configured');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  const model = client.getGenerativeModel({ model: getModelName() });

  const normalizedMessageRaw = safeText(message, 2000);
  const normalizedPage = safeText(page, 200);
  const normalizedContext = safeText(context, 4000);
  const normalizedHistory = clampArray(history, 20)
    .map((m) => ({
      role: m && (m.role === 'assistant' ? 'assistant' : 'user'),
      content: safeText(m && m.content, 2000)
    }))
    .filter((m) => m.content);

  const wantsAppPageInfo = (() => {
    const text = String(normalizedMessageRaw || '').toLowerCase();
    return /\b(current page|which page|what page|where am i|url|path|route)\b/.test(text);
  })();

  const cleanedContext = (() => {
    if (!normalizedContext) return '';
    const lines = String(normalizedContext)
      .split('\n')
      .map((l) => String(l || '').trim())
      .filter(Boolean)
      .filter((l) => !/^(app page:|current app page\/path:)/i.test(l));
    return safeText(lines.join('\n'), 4000);
  })();

  const systemInstruction = `You are AuditPro AI Assistant.

Your main purpose is to help users:
- Use AuditPro
- Understand SEO audits
- Learn SEO concepts
- Troubleshoot issues

You may answer general questions briefly.

If users ask about AuditPro features, explain them clearly.

If users ask how AuditPro differs from competitors, explain the platform's strengths.

Be conversational and friendly.

Rules:
- Plain text only (no HTML).
- Be specific to the provided Website Info when available.
- If the Website Info is missing or unclear, ask 1–2 short questions to get the URL or the key page.
- Do not claim you visited the site or accessed private data unless it is explicitly included in the Website Info.
- Do not mention the app page/path unless the user explicitly asks for it.
`;

  const websiteInfoBlockParts = [];
  if (cleanedContext) websiteInfoBlockParts.push(cleanedContext);
  if (wantsAppPageInfo && normalizedPage) {
    websiteInfoBlockParts.push(`Current app page/path: ${normalizedPage}`);
  }
  const websiteInfoBlock = websiteInfoBlockParts.length ? websiteInfoBlockParts.join('\n') : '(none provided)';

  const historyBlock = normalizedHistory.length
    ? normalizedHistory.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')
    : '(no prior messages)';

  const hasImage = !!(image && typeof image === 'object' && image.data && image.mimeType);
  const normalizedMessage = normalizedMessageRaw || (hasImage ? 'Please analyze the attached image.' : '');
  const imageNote = hasImage ? '\nThe user attached an image. Use it to answer their question.' : '';

  const prompt = `${systemInstruction}

Website Info:
${websiteInfoBlock}

User Question:
${normalizedMessage}

Conversation so far (may be empty):
${historyBlock}
${imageNote}

Answer like you're explaining to a beginner.`;

  let result;
  if (hasImage) {
    const mimeType = safeText(image.mimeType, 50);
    const data = typeof image.data === 'string' ? image.data.trim() : '';
    // Keep a hard cap to avoid huge payloads.
    if (data.length > 6000000) {
      const err = new Error('Image too large');
      err.code = 'IMAGE_TOO_LARGE';
      throw err;
    }

    result = await retryWithBackoff(
      () => model.generateContent([
        { text: prompt },
        { inlineData: { mimeType, data } }
      ]),
      'generateAssistantReply (with image)'
    );
  } else {
    result = await retryWithBackoff(
      () => model.generateContent(prompt),
      'generateAssistantReply'
    );
  }
  const response = await result.response;
  const text = (response.text() || '').trim();
  return text || "Sorry — I couldn't generate a response. Please try again.";
}

module.exports = { generateInsights, generateAssistantReply };
