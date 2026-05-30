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

async function generateInsights(auditData) {
  const client = getClient();
  if (!client) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = client.getGenerativeModel({ model: getModelName() });

  const prompt = `
You are an expert SEO consultant.

Your task is to convert the given structured SEO audit data into a clean, professional, and actionable report.

IMPORTANT RULES:
- Only use the provided data
- Do NOT include navigation text, HTML junk, or unrelated content
- Keep everything clean, readable, and well-formatted
- Be concise and practical
- Do NOT explain anything
- Do NOT add extra commentary

OUTPUT FORMAT (STRICT):

TITLE:
<Write an improved SEO title under 60 characters>

META DESCRIPTION:
<Write a clear meta description under 155 characters>

H1:
<Write an improved H1 heading>

TOP FIXES:
- <Fix 1 (clear and actionable)>
- <Fix 2>
- <Fix 3>
- <Fix 4>
- <Fix 5>

KEYWORDS:
- <keyword 1>
- <keyword 2>
- <keyword 3>
- <keyword 4>
- <keyword 5>

DATA:
${JSON.stringify(auditData)}
`;

  const response = await retryWithBackoff(
    () => model.generateContent(prompt),
    'generateInsights'
  );
  const result = await response.response;
  return result.text();
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

  const systemInstruction = `You are an SEO assistant helping a website owner.

Your job:
- Explain things in VERY simple language.
- Be specific to the given website info.
- Keep answers short: 3–5 lines.
- Give practical suggestions only.

Rules:
- Plain text only (no HTML).
- If the website info is missing or unclear, ask 1 short question to get the URL or the key page.
- Do not claim you visited the site or accessed private data unless it is explicitly included in the Website Info below.
`;

  const websiteInfoBlockParts = [];
  if (normalizedContext) websiteInfoBlockParts.push(normalizedContext);
  if (normalizedPage) websiteInfoBlockParts.push(`Current app page/path: ${normalizedPage}`);
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
