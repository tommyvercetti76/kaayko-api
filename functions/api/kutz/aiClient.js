/**
 * KaleKutz — AI Client Abstraction
 *
 * Single entry-point for all Claude / OpenAI calls in the kutz API.
 * Features:
 *  - Task → model mapping (callers never hardcode model strings)
 *  - Lazy singletons (one Anthropic + one OpenAI instance per Cloud Function instance)
 *  - Anthropic prompt caching support (pass cache_control on system blocks)
 *  - OpenAI gpt-4o-mini fallback on Anthropic auth/quota/overload errors only
 *
 * Usage:
 *   const { callAI } = require('./aiClient');
 *   const text = await callAI({ task: 'parse', system: [...], messages: [...] });
 */

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI    = require('openai');

// ─── Task → Model map ────────────────────────────────────────────────────────
// Change model here once — all endpoints update automatically.
const MODELS = {
  parse:   'claude-sonnet-4-5',          // food text parsing — accuracy critical (upgraded from Haiku for fat tracking)
  photo:   'claude-sonnet-4-5',          // vision requires Sonnet
  suggest: 'claude-haiku-4-5',           // high-frequency suggestions — lower cost, lower stakes
  report:  'claude-sonnet-4-5-20250929', // weekly report — quality output, keep dated snapshot
};

// ─── Lazy singletons ─────────────────────────────────────────────────────────
let _anthropic = null;
let _openai    = null;

function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ─── Error types that warrant an OpenAI fallback ─────────────────────────────
const FALLBACK_ERROR_TYPES = new Set([
  'authentication_error',
  'permission_error',
  'overloaded_error',
]);

/**
 * Call the AI with a given task and content.
 *
 * @param {object}  opts
 * @param {string}  opts.task          — 'parse' | 'photo' | 'suggest' | 'report'
 * @param {Array}   opts.system        — Anthropic system blocks array. Each block:
 *                                       { type: 'text', text: string, cache_control?: { type: 'ephemeral' } }
 *                                       Pass [] or omit for no system prompt.
 * @param {Array}   opts.messages      — Anthropic messages array (role + content)
 * @param {number}  [opts.maxTokens]   — Default 1200
 * @param {boolean} [opts.useOpenAIFallback] — Default true
 *
 * @returns {Promise<string>} Raw text content from the first response block
 */
async function callAI({
  task,
  system     = [],
  messages,
  maxTokens  = 1200,
  useOpenAIFallback = true,
}) {
  const model = MODELS[task] || MODELS.parse;

  // ── Try Anthropic first ────────────────────────────────────────────────────
  try {
    const client = getAnthropic();

    const createParams = {
      model,
      max_tokens: maxTokens,
      messages,
    };

    // Only include system if non-empty (avoids API error on empty array)
    if (system && system.length > 0) {
      createParams.system = system;
    }

    const resp = await client.messages.create(createParams);
    return resp.content.map(c => c.text || '').join('').trim();

  } catch (err) {
    const errType = err?.error?.type || err?.status;

    // ── Fallback to OpenAI on auth/quota/overload ─────────────────────────
    if (useOpenAIFallback && FALLBACK_ERROR_TYPES.has(errType)) {
      console.warn(`[aiClient] Anthropic ${errType} on task="${task}" — falling back to OpenAI gpt-4o-mini`);

      try {
        const oai = getOpenAI();
        const systemText = system.map(b => b.text || '').join('\n').trim();

        const oaiMessages = [
          ...(systemText ? [{ role: 'system', content: systemText }] : []),
          ...messages.map(m => ({
            role:    m.role,
            content: Array.isArray(m.content)
              ? m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
              : m.content,
          })),
        ];

        const completion = await oai.chat.completions.create({
          model:      'gpt-4o-mini',
          max_tokens: maxTokens,
          messages:   oaiMessages,
        });

        return completion.choices[0].message.content.trim();

      } catch (oaiErr) {
        console.error('[aiClient] OpenAI fallback also failed:', oaiErr.message);
        throw err; // re-throw original Anthropic error
      }
    }

    // Not a fallback-worthy error — re-throw immediately
    throw err;
  }
}

module.exports = { callAI, MODELS };
