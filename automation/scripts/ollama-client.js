"use strict";

/**
 * ollama-client.js — Native async Ollama client for kaayko-api.
 *
 * Replaces spawnSync(curl) with Node.js http.request():
 * - No child processes, no temp files
 * - Retry with exponential backoff (3 attempts)
 * - Streaming support for progress feedback
 * - Connection pooling via http.Agent keepAlive
 * - Abort controller for clean cancellation
 *
 * Designed for M1 Pro Max: GPU is the bottleneck, so this client
 * frees the CPU/event loop while waiting for inference.
 */

const http = require("http");
const https = require("https");

// Keep-alive agent: reuse TCP connections to Ollama
const keepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 2, // Ollama only processes 1 inference, but allow health checks
  keepAliveMsecs: 30000,
  timeout: 360000
});

// ── Configuration ───────────────────────────────────────────────

const DEFAULTS = {
  baseUrl: "http://127.0.0.1:11434",
  timeoutMs: 300000,       // 5 min per inference
  maxRetries: 3,           // 3 attempts total
  retryBaseMs: 1000,       // 1s → 4s → 16s (exponential)
  retryMaxMs: 30000,       // cap at 30s
  temperature: 0.1,
  maxTokens: 4096,
  streamProgress: false     // if true, emit progress events
};

// ── Core HTTP Helper ────────────────────────────────────────────

/**
 * Make an HTTP request to Ollama. Returns parsed JSON body.
 * Supports abort via AbortController signal.
 */
function ollamaRequest(method, path, body, options = {}) {
  return new Promise((resolve, reject) => {
    const baseUrl = options.baseUrl || DEFAULTS.baseUrl;
    const url = new URL(path, baseUrl);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;
    const timeoutMs = options.timeoutMs || DEFAULTS.timeoutMs;

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 11434),
      path: url.pathname,
      method,
      headers: { "Content-Type": "application/json" },
      agent: isHttps ? undefined : keepAliveAgent,
      timeout: timeoutMs
    };

    const req = transport.request(reqOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw), raw });
        } catch {
          resolve({ status: res.statusCode, body: null, raw });
        }
      });
      res.on("error", reject);
    });

    req.on("timeout", () => {
      req.destroy(new Error(`Ollama request timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);

    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        req.destroy(new Error("Request aborted"));
      }, { once: true });
    }

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ── Retry Logic ─────────────────────────────────────────────────

/**
 * Retry an async function with exponential backoff.
 * Retries on: network errors, timeouts, 5xx. Does NOT retry on 4xx.
 */
async function withRetry(fn, options = {}) {
  const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
  const baseMs = options.retryBaseMs ?? DEFAULTS.retryBaseMs;
  const maxMs = options.retryMaxMs ?? DEFAULTS.retryMaxMs;
  const label = options.label || "request";
  const onRetry = options.onRetry || (() => {});

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn(attempt);
      return result;
    } catch (error) {
      lastError = error;

      // Don't retry client errors (4xx)
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(baseMs * Math.pow(4, attempt - 1), maxMs);
        const jitter = Math.random() * delay * 0.1; // 10% jitter
        onRetry(attempt, delay + jitter, error);
        await sleep(delay + jitter);
      }
    }
  }

  throw new Error(`${label} failed after ${maxRetries} attempts: ${lastError?.message || "unknown"}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Generate a completion from Ollama (non-streaming).
 * Replaces invokeOllamaHttpPrompt() with retry + native HTTP.
 *
 * @param {object} runtime - runtime config with model, base_url, etc.
 * @param {string} prompt - the full prompt text
 * @param {string} label - human-readable label for logging
 * @param {object} [overrides] - optional overrides (temperature, maxTokens, etc.)
 * @returns {Promise<string>} the model's response text
 */
async function generate(runtime, prompt, label, overrides = {}) {
  const baseUrl = String(runtime.base_url || DEFAULTS.baseUrl).replace(/\/$/, "");
  const model = runtime.model;
  if (!model) throw new Error(`No model configured for ${label}`);

  const payload = {
    model,
    prompt,
    stream: false,
    options: {
      temperature: overrides.temperature ?? runtime.temperature ?? DEFAULTS.temperature,
      num_predict: overrides.maxTokens ?? runtime.max_tokens ?? DEFAULTS.maxTokens
    }
  };

  const result = await withRetry(
    async (attempt) => {
      const res = await ollamaRequest("POST", "/api/generate", payload, {
        baseUrl,
        timeoutMs: overrides.timeoutMs || runtime.timeout_ms || DEFAULTS.timeoutMs,
        signal: overrides.signal
      });

      if (res.status >= 500) {
        const err = new Error(`Ollama ${label}: server error ${res.status}`);
        err.statusCode = res.status;
        throw err;
      }
      if (res.status >= 400) {
        const err = new Error(`Ollama ${label}: client error ${res.status} — ${res.raw?.slice(0, 200)}`);
        err.statusCode = res.status;
        throw err;
      }

      const responseText = res.body?.response?.trim();
      if (!responseText) {
        throw new Error(`Ollama ${label}: empty response`);
      }

      return {
        text: responseText,
        model: res.body.model,
        totalDuration: res.body.total_duration,
        evalCount: res.body.eval_count,
        evalDuration: res.body.eval_duration,
        promptEvalCount: res.body.prompt_eval_count,
        promptEvalDuration: res.body.prompt_eval_duration
      };
    },
    {
      label: `Ollama ${label}`,
      maxRetries: overrides.maxRetries ?? 3,
      onRetry: (attempt, delayMs, error) => {
        const delaySec = (delayMs / 1000).toFixed(1);
        process.stdout.write(`\n    ⟳ retry ${attempt} in ${delaySec}s (${error.message.slice(0, 80)})`);
      }
    }
  );

  return result;
}

/**
 * Generate with streaming — yields chunks as they arrive.
 * Useful for long inference: shows progress in dashboard/CLI.
 *
 * @param {object} runtime
 * @param {string} prompt
 * @param {string} label
 * @param {function} onChunk - called with (chunkText, accumulated) on each token
 * @param {object} [overrides]
 * @returns {Promise<object>} final result with full text + metrics
 */
async function generateStream(runtime, prompt, label, onChunk, overrides = {}) {
  const baseUrl = String(runtime.base_url || DEFAULTS.baseUrl).replace(/\/$/, "");
  const model = runtime.model;
  if (!model) throw new Error(`No model configured for ${label}`);

  const payload = {
    model,
    prompt,
    stream: true,
    options: {
      temperature: overrides.temperature ?? runtime.temperature ?? DEFAULTS.temperature,
      num_predict: overrides.maxTokens ?? runtime.max_tokens ?? DEFAULTS.maxTokens
    }
  };

  return new Promise((resolve, reject) => {
    const url = new URL("/api/generate", baseUrl);
    const timeoutMs = overrides.timeoutMs || runtime.timeout_ms || DEFAULTS.timeoutMs;

    const req = http.request({
      hostname: url.hostname,
      port: url.port || 11434,
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      agent: keepAliveAgent,
      timeout: timeoutMs
    }, (res) => {
      let accumulated = "";
      let lastMetrics = {};
      let buffer = "";

      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              accumulated += parsed.response;
              if (onChunk) onChunk(parsed.response, accumulated);
            }
            if (parsed.done) {
              lastMetrics = {
                model: parsed.model,
                totalDuration: parsed.total_duration,
                evalCount: parsed.eval_count,
                evalDuration: parsed.eval_duration,
                promptEvalCount: parsed.prompt_eval_count,
                promptEvalDuration: parsed.prompt_eval_duration
              };
            }
          } catch { /* skip malformed lines */ }
        }
      });

      res.on("end", () => {
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.response) accumulated += parsed.response;
          } catch { /* ignore */ }
        }

        if (!accumulated.trim()) {
          reject(new Error(`Ollama ${label}: empty streaming response`));
          return;
        }

        resolve({ text: accumulated.trim(), ...lastMetrics });
      });

      res.on("error", reject);
    });

    req.on("timeout", () => req.destroy(new Error(`Stream timeout after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

/**
 * Fetch installed model tags from Ollama.
 * Replaces fetchOllamaTags() — native HTTP, no curl.
 *
 * @param {object} runtime
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<Array>} array of model objects
 */
async function fetchTags(runtime, timeoutMs = 5000) {
  const baseUrl = String(runtime.base_url || DEFAULTS.baseUrl).replace(/\/$/, "");
  const res = await ollamaRequest("GET", "/api/tags", null, { baseUrl, timeoutMs });
  if (!res.body || !Array.isArray(res.body.models)) {
    throw new Error("Ollama tags: unexpected response shape");
  }
  return res.body.models;
}

/**
 * Check if Ollama is reachable and responsive.
 *
 * @param {object} runtime
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{ok: boolean, latencyMs: number, error?: string}>}
 */
async function healthCheck(runtime, timeoutMs = 3000) {
  const t0 = Date.now();
  try {
    await fetchTags(runtime, timeoutMs);
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - t0, error: error.message };
  }
}

/**
 * Get performance metrics from a generate result.
 * Useful for benchmarking and model comparison.
 */
function extractMetrics(result) {
  if (!result) return null;
  const tokensPerSec = result.evalCount && result.evalDuration
    ? (result.evalCount / (result.evalDuration / 1e9)).toFixed(1)
    : null;
  const promptTokPerSec = result.promptEvalCount && result.promptEvalDuration
    ? (result.promptEvalCount / (result.promptEvalDuration / 1e9)).toFixed(1)
    : null;
  return {
    model: result.model,
    tokensGenerated: result.evalCount || null,
    tokensPerSecond: tokensPerSec ? parseFloat(tokensPerSec) : null,
    promptTokens: result.promptEvalCount || null,
    promptTokPerSecond: promptTokPerSec ? parseFloat(promptTokPerSec) : null,
    totalDurationSec: result.totalDuration ? (result.totalDuration / 1e9).toFixed(2) : null,
    evalDurationSec: result.evalDuration ? (result.evalDuration / 1e9).toFixed(2) : null
  };
}

/**
 * Synchronous wrapper for generate() — drop-in replacement for invokeOllamaPrompt.
 * Used during migration: existing code calls this synchronously, it blocks until done.
 * Will be removed once pipeline is fully async.
 */
function generateSync(runtime, prompt, label, overrides = {}) {
  // Use Node's ability to run async code in a blocking way via spawnSync self-call
  const { spawnSync } = require("child_process");
  const scriptPath = __filename;

  const input = JSON.stringify({
    runtime: {
      model: runtime.model,
      base_url: runtime.base_url,
      temperature: runtime.temperature,
      max_tokens: runtime.max_tokens,
      timeout_ms: runtime.timeout_ms
    },
    prompt,
    label,
    overrides
  });

  const result = spawnSync(process.execPath, [scriptPath, "--sync-bridge"], {
    input,
    encoding: "utf8",
    timeout: (runtime.timeout_ms || DEFAULTS.timeoutMs) + 30000, // extra buffer
    maxBuffer: 24 * 1024 * 1024,
    env: process.env
  });

  if (result.error) throw new Error(`Ollama sync bridge ${label} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Ollama sync bridge ${label} exit ${result.status}: ${(result.stderr || "").slice(0, 200)}`);

  try {
    const output = JSON.parse(result.stdout);
    if (output.error) throw new Error(output.error);
    return output.text;
  } catch (e) {
    if (e.message.startsWith("Ollama")) throw e;
    throw new Error(`Ollama sync bridge ${label}: failed to parse output — ${result.stdout?.slice(0, 100)}`);
  }
}

// ── Sync Bridge (when invoked as a child process) ───────────────

if (require.main === module && process.argv.includes("--sync-bridge")) {
  (async () => {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;

    try {
      const { runtime, prompt, label, overrides } = JSON.parse(input);
      const result = await generate(runtime, prompt, label, overrides);
      process.stdout.write(JSON.stringify({ text: result.text, model: result.model }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ error: error.message }));
    }
  })();
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = {
  generate,
  generateSync,
  generateStream,
  fetchTags,
  healthCheck,
  extractMetrics,
  withRetry,
  DEFAULTS
};
