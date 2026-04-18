"use strict";

/**
 * resource-governor.js — Hardware-aware resource management for M1 Pro Max.
 *
 * Responsibilities:
 * 1. Model selection based on task complexity (small task → small model → faster)
 * 2. Memory pressure monitoring (prevent OOM, defer runs when tight)
 * 3. Concurrent run limiter (1 GPU + 1 CPU max)
 * 4. Content fingerprinting (skip unchanged files across runs)
 * 5. Temperature scaling by mode (audit=deterministic, edit=creative, scout=exploratory)
 *
 * Resource contracts:
 * - GPU: exclusively 1 Ollama inference at a time
 * - CPU: file I/O + verification during GPU idle
 * - Memory: max 2 concurrent runs × ~200MB = 400MB working set
 * - Disk: fingerprint cache ≈ 50KB, negligible
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Path Constants ──────────────────────────────────────────────

const SCRIPT_DIR = __dirname;
const AUTOMATION_ROOT = path.resolve(SCRIPT_DIR, "..");
const CACHE_DIR = path.join(AUTOMATION_ROOT, ".cache");
const FINGERPRINT_PATH = path.join(CACHE_DIR, "file-fingerprints.json");
const GOVERNOR_STATE_PATH = path.join(CACHE_DIR, "governor-state.json");

// ── Hardware Detection ──────────────────────────────────────────

/**
 * Detect machine capabilities. Cached for process lifetime.
 */
let _hwProfile = null;
function getHardwareProfile() {
  if (_hwProfile) return _hwProfile;

  const totalMemGB = os.totalmem() / (1024 ** 3);
  const cpuCount = os.cpus().length;
  const arch = os.arch();
  const platform = os.platform();

  // Detect Apple Silicon (M1/M2/M3)
  const isAppleSilicon = platform === "darwin" && arch === "arm64";
  const cpuModel = os.cpus()[0]?.model || "";

  // Estimate GPU memory (Apple Silicon shares unified memory)
  // M1 Pro Max: 32 GPU cores, can use up to ~48GB of 64GB for GPU
  // M1 Pro: 16 GPU cores, typically 16-32GB
  const estimatedGpuMemGB = isAppleSilicon ? Math.floor(totalMemGB * 0.75) : 0;

  _hwProfile = {
    totalMemGB: Math.round(totalMemGB * 10) / 10,
    freeMemGB: Math.round(os.freemem() / (1024 ** 3) * 10) / 10,
    cpuCount,
    arch,
    platform,
    cpuModel,
    isAppleSilicon,
    estimatedGpuMemGB,
    // Thresholds
    minFreeMemGB: 4,        // don't start a run if less than 4GB free
    warnFreeMemGB: 8,       // warn and prefer smaller model
    comfortFreeMemGB: 16    // plenty of room for large models
  };

  return _hwProfile;
}

/**
 * Get current memory pressure level.
 * @returns {"low"|"medium"|"high"|"critical"}
 */
function getMemoryPressure() {
  const freeGB = os.freemem() / (1024 ** 3);
  const hw = getHardwareProfile();
  if (freeGB < hw.minFreeMemGB) return "critical";
  if (freeGB < hw.warnFreeMemGB) return "high";
  if (freeGB < hw.comfortFreeMemGB) return "medium";
  return "low";
}

// ── Model Selection ─────────────────────────────────────────────

/**
 * Model tiers by size. Maps model ID patterns to tier.
 */
const MODEL_TIERS = {
  small: { maxParams: 10, label: "Fast", idealFor: "Quick audits, simple edits", maxContextFiles: 6 },
  medium: { maxParams: 20, label: "Balanced", idealFor: "Standard audits, moderate edits", maxContextFiles: 12 },
  large: { maxParams: 40, label: "Thorough", idealFor: "Deep security analysis, complex refactors", maxContextFiles: 18 }
};

/**
 * Estimate model tier from its name/size.
 */
function getModelTier(modelId) {
  const id = modelId.toLowerCase();
  // Extract parameter count if in name (e.g., "qwen2.5-coder:7b" → 7)
  const paramMatch = id.match(/:(\d+)b/);
  if (paramMatch) {
    const params = parseInt(paramMatch[1], 10);
    if (params <= 10) return "small";
    if (params <= 20) return "medium";
    return "large";
  }
  // Heuristic fallback
  if (id.includes("7b") || id.includes("8b")) return "small";
  if (id.includes("14b") || id.includes("16b")) return "medium";
  return "large";
}

/**
 * Select the optimal model for a task based on complexity + available resources.
 *
 * @param {object} params
 * @param {string} params.goalMode - "audit" | "edit" | "scout"
 * @param {number} params.fileCount - number of candidate files
 * @param {string} params.goal - the goal text
 * @param {Array} params.availableModels - models installed in Ollama
 * @param {object} params.runtimeConfig - current runtime config (has preferred model)
 * @returns {{model: string, tier: string, reason: string}}
 */
function selectModel(params) {
  const { goalMode, fileCount, goal, availableModels, runtimeConfig } = params;
  const pressure = getMemoryPressure();
  const currentModel = runtimeConfig?.local_model_runtime?.model;

  // If memory is critical, always use smallest available
  if (pressure === "critical") {
    const smallest = pickSmallestModel(availableModels);
    return {
      model: smallest.name,
      tier: "small",
      reason: `Memory critical (${(os.freemem() / 1e9).toFixed(1)}GB free) — using smallest model`
    };
  }

  // Determine desired tier based on task complexity
  let desiredTier;
  const goalLen = (goal || "").length;
  const isSecurityGoal = /security|vuln|auth|injection|xss|csrf|owasp/i.test(goal);
  const isSimpleGoal = /lint|format|typo|rename|comment/i.test(goal);

  if (goalMode === "scout" || isSimpleGoal || (fileCount <= 5 && goalLen < 100)) {
    desiredTier = "small";
  } else if (isSecurityGoal || fileCount > 15 || goalLen > 300) {
    desiredTier = "large";
  } else {
    desiredTier = "medium";
  }

  // Downgrade if memory pressure is high
  if (pressure === "high" && desiredTier === "large") {
    desiredTier = "medium";
  }

  // Find best available model for the tier
  const candidate = pickModelForTier(availableModels, desiredTier);
  if (!candidate) {
    return { model: currentModel, tier: getModelTier(currentModel), reason: "No better model available, keeping current" };
  }

  // Don't switch if current model is already in the right tier
  if (currentModel && getModelTier(currentModel) === desiredTier) {
    return { model: currentModel, tier: desiredTier, reason: `Current model is already ${desiredTier} tier` };
  }

  return {
    model: candidate.name,
    tier: desiredTier,
    reason: `${desiredTier} tier selected for ${goalMode} with ${fileCount} files (memory: ${pressure})`
  };
}

function pickSmallestModel(models) {
  return models
    .filter((m) => m.size)
    .sort((a, b) => a.size - b.size)[0] || models[0];
}

function pickModelForTier(models, tier) {
  const tierConfig = MODEL_TIERS[tier];
  const maxParams = tierConfig.maxParams;

  // Filter to code-oriented models in the right size range
  const candidates = models.filter((m) => {
    const mTier = getModelTier(m.name);
    return mTier === tier;
  });

  // Prefer coder-specific models
  const coderModels = candidates.filter((m) =>
    /coder|code|deepseek/i.test(m.name)
  );

  return coderModels[0] || candidates[0] || null;
}

// ── Temperature Scaling ─────────────────────────────────────────

/**
 * Get optimal temperature for a given mode.
 */
function getTemperature(goalMode) {
  switch (goalMode) {
    case "audit": return 0.1;   // Deterministic — same input → same findings
    case "edit": return 0.25;   // Slightly creative — allow alternative fix approaches
    case "scout": return 0.5;   // Exploratory — discover novel improvement ideas
    default: return 0.1;
  }
}

// ── Content Fingerprinting ──────────────────────────────────────

/**
 * Fingerprint cache: SHA-256 of file contents.
 * Survives across runs. Used to skip re-reading unchanged files.
 */
let _fingerprints = null;

function loadFingerprints() {
  if (_fingerprints) return _fingerprints;
  try {
    if (fs.existsSync(FINGERPRINT_PATH)) {
      _fingerprints = JSON.parse(fs.readFileSync(FINGERPRINT_PATH, "utf8"));
    } else {
      _fingerprints = {};
    }
  } catch {
    _fingerprints = {};
  }
  return _fingerprints;
}

function saveFingerprints() {
  if (!_fingerprints) return;
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(FINGERPRINT_PATH, JSON.stringify(_fingerprints, null, 2));
}

/**
 * Compute SHA-256 fingerprint of a file's contents.
 * Returns null if file doesn't exist.
 */
function fingerprintFile(absolutePath) {
  try {
    const content = fs.readFileSync(absolutePath, "utf8");
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * Check which files have changed since last fingerprinted.
 *
 * @param {Array<string>} filePaths - absolute paths
 * @returns {{changed: string[], unchanged: string[], newFiles: string[]}}
 */
function diffFingerprints(filePaths) {
  const cache = loadFingerprints();
  const changed = [];
  const unchanged = [];
  const newFiles = [];
  const newCache = {};

  for (const fp of filePaths) {
    const current = fingerprintFile(fp);
    if (!current) continue; // file doesn't exist

    newCache[fp] = current;

    if (!cache[fp]) {
      newFiles.push(fp);
    } else if (cache[fp] !== current) {
      changed.push(fp);
    } else {
      unchanged.push(fp);
    }
  }

  // Merge into cache
  Object.assign(cache, newCache);
  _fingerprints = cache;

  return { changed, unchanged, newFiles };
}

/**
 * Update fingerprints for a set of files (call after successful run).
 */
function updateFingerprints(filePaths) {
  const cache = loadFingerprints();
  for (const fp of filePaths) {
    const hash = fingerprintFile(fp);
    if (hash) cache[fp] = hash;
  }
  _fingerprints = cache;
  saveFingerprints();
}

// ── Concurrent Run Limiter ──────────────────────────────────────

/**
 * Governor state tracks active runs to prevent resource contention.
 */
function loadGovernorState() {
  try {
    if (fs.existsSync(GOVERNOR_STATE_PATH)) {
      const state = JSON.parse(fs.readFileSync(GOVERNOR_STATE_PATH, "utf8"));
      // Clean up stale entries (>30 min old)
      const now = Date.now();
      state.activeRuns = (state.activeRuns || []).filter(
        (r) => now - r.startedAt < 30 * 60 * 1000
      );
      return state;
    }
  } catch { /* ignore */ }
  return { activeRuns: [], lastUpdated: Date.now() };
}

function saveGovernorState(state) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  state.lastUpdated = Date.now();
  fs.writeFileSync(GOVERNOR_STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Request permission to start a new run.
 * @param {string} runId
 * @param {string} phase - "gpu" or "cpu"
 * @returns {{allowed: boolean, reason?: string, queuePosition?: number}}
 */
function requestRunSlot(runId, phase) {
  const state = loadGovernorState();
  const maxConcurrent = phase === "gpu" ? 1 : 2; // 1 GPU, 2 CPU
  const activeInPhase = state.activeRuns.filter((r) => r.phase === phase);

  if (activeInPhase.length >= maxConcurrent) {
    return {
      allowed: false,
      reason: `${phase.toUpperCase()} slot full (${activeInPhase.length}/${maxConcurrent})`,
      queuePosition: activeInPhase.length - maxConcurrent + 1
    };
  }

  state.activeRuns.push({ runId, phase, startedAt: Date.now() });
  saveGovernorState(state);
  return { allowed: true };
}

/**
 * Release a run slot when done.
 */
function releaseRunSlot(runId) {
  const state = loadGovernorState();
  state.activeRuns = state.activeRuns.filter((r) => r.runId !== runId);
  saveGovernorState(state);
}

// ── Diagnostics ─────────────────────────────────────────────────

/**
 * Full system diagnostic for the dashboard.
 */
function getDiagnostics() {
  const hw = getHardwareProfile();
  const pressure = getMemoryPressure();
  const state = loadGovernorState();
  const cacheSize = Object.keys(loadFingerprints()).length;

  return {
    hardware: hw,
    memoryPressure: pressure,
    freeMemGB: Math.round(os.freemem() / (1024 ** 3) * 10) / 10,
    activeRuns: state.activeRuns,
    cachedFingerprints: cacheSize,
    recommendations: buildRecommendations(hw, pressure, state)
  };
}

function buildRecommendations(hw, pressure, state) {
  const recs = [];
  if (pressure === "critical") {
    recs.push("Memory critical — close other apps or use a smaller model");
  } else if (pressure === "high") {
    recs.push("Memory pressure high — prefer 7-8B models for faster runs");
  }
  if (hw.isAppleSilicon && hw.totalMemGB >= 64) {
    recs.push("64GB unified memory — can run 32B models efficiently");
  }
  if (state.activeRuns.length === 0) {
    recs.push("No active runs — GPU is idle, queue work for maximum throughput");
  }
  return recs;
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = {
  getHardwareProfile,
  getMemoryPressure,
  selectModel,
  getModelTier,
  getTemperature,
  MODEL_TIERS,
  diffFingerprints,
  updateFingerprints,
  fingerprintFile,
  requestRunSlot,
  releaseRunSlot,
  getDiagnostics,
  CACHE_DIR,
  FINGERPRINT_PATH
};
