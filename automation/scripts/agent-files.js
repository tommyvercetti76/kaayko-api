/**
 * agent-files.js — File collection, scoring, selection, and loading for API agent runs.
 *
 * Adapted from the Kaayko frontend suite for the kaayko-api repo:
 * - Scores Express routes, middleware, services, scheduled functions, and config
 * - Ignores node_modules, __tests__, __mocks__, data/, cache/, coverage/
 * - Goal-aware boosts: middleware/auth audits, route audits, test coverage
 * - Dynamic file limits: 18 for audit, 8 for edit
 * - Dynamic char limits: 25k audit, 15k edit, full for small files
 */

const fs = require("fs");
const path = require("path");

/**
 * Detect whether a goal is an audit, scout, or edit mission.
 */
function detectGoalMode(goal) {
  const lower = String(goal || "").toLowerCase();
  const scoutPatterns = [
    /\bscout\b/, /\bideat/i, /\bopportunit/i, /\bfeature\b.*\bidea/i,
    /\bdeveloper experience\b/, /\breliability\b.*\bimprov/i, /\bmoderniz/i
  ];
  const auditPatterns = [
    /\baudit\b/, /\breview\b/, /\banalyze\b/, /\banalysis\b/, /\binventory\b/,
    /\blist\b.*\b(endpoint|route|middleware)/, /\bfind\b.*\b(duplica|dead|unused)/,
    /\bidentify\b/, /\bmap\b.*\b(route|module|endpoint)/, /\bwhat\b.*\b(endpoint|route)/,
    /\bscope\b/, /\bassess\b/, /\binspect\b/, /\bsecurity\b.*\b(review|audit|check)/,
    /\btenant\b.*\bisolation/, /\bauth\b.*\b(gap|check|audit)/
  ];
  if (scoutPatterns.some((pattern) => pattern.test(lower))) return "scout";
  return auditPatterns.some((p) => p.test(lower)) ? "audit" : "edit";
}

/**
 * Detect goal-relevant file type boosts for API context.
 */
function detectGoalFileHints(goal) {
  const lower = String(goal || "").toLowerCase();
  return {
    wantsMiddleware: /\bmiddleware\b|\bauth\b|\bsecurity\b|\brate.?limit\b|\bcors\b|\bguard\b/.test(lower),
    wantsRoutes: /\broute\b|\bendpoint\b|\bapi\b|\bhandler\b|\brouter\b/.test(lower),
    wantsServices: /\bservice\b|\bhelper\b|\butility\b|\bshared\b|\bcommon\b/.test(lower),
    wantsScheduled: /\bscheduled?\b|\bcron\b|\bjob\b|\bforecast\b|\bwarmer\b/.test(lower),
    wantsTests: /\btest\b|\bspec\b|\bjest\b|\bcoverage\b/.test(lower),
    wantsConfig: /\bconfig\b|\bsetup\b|\binit\b|\bfirebase\b/.test(lower),
    wantsAll: /\ball\b/.test(lower)
  };
}

/**
 * Compute max files to select based on goal mode.
 */
function computeMaxFiles(goalMode) {
  if (goalMode === "audit") return 18;
  if (goalMode === "scout") return 12;
  return 4;
}

/**
 * Compute max chars per file based on goal mode and file type.
 */
function computeMaxCharsForFile(candidate, goalMode, runtimeOverride) {
  if (runtimeOverride) return Number(runtimeOverride);
  const base = goalMode === "audit" ? 25000 : goalMode === "scout" ? 16000 : 8000;
  // Config/JSON files are usually compact — send full
  if (candidate.path.endsWith(".json")) return Math.max(base, 8000);
  // Small files: send full
  if (candidate.size_bytes < base) return candidate.size_bytes + 500;
  return base;
}

/**
 * Walk a directory tree, calling visit(absolutePath) for each file.
 * Skips node_modules, .git, dist, build, coverage, __mocks__, cache, data.
 */
function walkDirectory(rootPath, visit) {
  if (!fs.existsSync(rootPath)) return;
  fs.readdirSync(rootPath, { withFileTypes: true }).forEach((entry) => {
    const absolutePath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist", "build", "coverage", "__mocks__", "lib"].includes(entry.name)) {
        return;
      }
      walkDirectory(absolutePath, visit);
      return;
    }

    visit(absolutePath);
  });
}

/**
 * Check if a file is a valid agent source candidate for the API.
 */
function isAgentSourceCandidate(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const allowedExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".json"]);

  if (!allowedExtensions.has(extension)) {
    return false;
  }

  const basename = path.basename(filePath);
  // Skip lock files, large data files, generated artifacts
  if (["package-lock.json", "firebase-debug.log", "firestore-debug.log"].includes(basename)) {
    return false;
  }

  // Skip large static data files
  if (basename === "hydrolakes.json") return false;

  const stat = fs.statSync(filePath);
  return stat.size <= 80000;
}

/**
 * Tokenize a goal string into searchable tokens.
 */
function tokenizeGoal(goal) {
  const seen = new Set();
  return String(goal || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3 && !seen.has(token) && seen.add(token));
}

/**
 * Score a candidate file for relevance in the API context.
 * Boosts routes, middleware, services, scheduled functions based on goal hints.
 */
function scoreAgentCandidateFile(prefixedPath, area, track, goalTokens, sizeBytes, logicalRoot, coachingBundle, goalHints) {
  const normalizedPath = prefixedPath.toLowerCase();
  let score = 0;

  // ── Repo match ──
  if (normalizedPath.startsWith("kaayko-api:functions/")) {
    score += 14;
  }
  if (normalizedPath.startsWith("kaayko-api:ml-service/")) {
    score += area === "weather" ? 12 : 6;
  }

  // ── Route files (the core of the API) ──
  if (normalizedPath.includes("/api/") && !normalizedPath.includes("__tests__")) {
    score += goalHints.wantsRoutes ? 18 : 12;
  }

  // ── Middleware (auth, security, rate limiting) ──
  if (normalizedPath.includes("/middleware/")) {
    score += goalHints.wantsMiddleware ? 20 : 10;
  }

  // ── Services (shared business logic) ──
  if (normalizedPath.includes("/services/")) {
    score += goalHints.wantsServices ? 16 : 8;
  }

  // ── Scheduled functions ──
  if (normalizedPath.includes("/scheduled/")) {
    score += goalHints.wantsScheduled ? 16 : 6;
  }

  // ── Config files ──
  if (normalizedPath.includes("/config/") && normalizedPath.endsWith(".js")) {
    score += goalHints.wantsConfig ? 14 : 6;
  }

  // ── Cache files ──
  if (normalizedPath.includes("/cache/") && normalizedPath.endsWith(".js")) {
    score += goalHints.wantsScheduled ? 10 : 4;
  }

  // ── Test files ──
  if (normalizedPath.includes("__tests__/") || normalizedPath.includes(".test.")) {
    score += goalHints.wantsTests ? 14 : 2;
  }

  // ── Entry point (index.js) — always relevant ──
  if (normalizedPath.endsWith("functions/index.js")) {
    score += 16;
  }

  // ── Utility files ──
  if (normalizedPath.includes("/utils/") || normalizedPath.includes("/shared/")) {
    score += goalHints.wantsServices ? 12 : 6;
  }

  // ── Scripts (predeploy, catalog) ──
  if (normalizedPath.includes("/scripts/")) {
    score += 4;
  }

  // ── Track name match ──
  const trackSlug = track.replace(/[^a-z0-9]+/g, "");
  if (trackSlug && normalizedPath.includes(trackSlug)) {
    score += 6;
  }

  // ── Goal token matches ──
  goalTokens.forEach((token) => {
    if (normalizedPath.includes(token)) {
      score += 5;
    }
  });

  // ── Coaching path boosts ──
  (coachingBundle?.priority_path_prefixes || []).forEach((prefix) => {
    if (normalizedPath.startsWith(String(prefix).toLowerCase())) {
      score += 16;
    }
  });

  (coachingBundle?.critical_path_prefixes || []).forEach((prefix) => {
    if (normalizedPath.startsWith(String(prefix).toLowerCase())) {
      score += 12;
    }
  });

  // ── Size preference ──
  if (sizeBytes < 12000) {
    score += 4;
  } else if (sizeBytes > 30000) {
    score -= 4;
  }

  // ── JSON files get lower priority unless config ──
  if (normalizedPath.endsWith(".json") && !normalizedPath.includes("/config/")) {
    score -= 6;
  }

  return score;
}

/**
 * Collect candidate files from the API repo for agent inspection.
 * Returns sorted by score, capped at 80 candidates for model inventory prompt.
 */
function collectAgentCandidateFiles(config, manifest, area, goal, coachingBundle, helpers) {
  const { resolveAgentRoots, REPO_ROOT } = helpers;
  const roots = resolveAgentRoots(config, manifest, area);
  const goalTokens = tokenizeGoal(goal);
  const goalHints = detectGoalFileHints(goal);
  const candidates = [];

  roots.forEach(({ repoKey, absoluteRoot, logicalRoot }) => {
    if (!fs.existsSync(absoluteRoot)) {
      return;
    }

    walkDirectory(absoluteRoot, (absolutePath) => {
      if (!isAgentSourceCandidate(absolutePath)) {
        return;
      }

      const stat = fs.statSync(absolutePath);
      const relativePath = path.relative(REPO_ROOT, absolutePath);
      const prefixedPath = `${repoKey}:${relativePath}`;
      const score = scoreAgentCandidateFile(prefixedPath, area, manifest.track, goalTokens, stat.size, logicalRoot, coachingBundle, goalHints);

      let lineCount = 0;
      try { lineCount = fs.readFileSync(absolutePath, "utf8").split("\n").length; } catch { /* unreadable file — skip line count */ }

      candidates.push({
        path: prefixedPath,
        repo: repoKey,
        relative_path: relativePath,
        logical_root: logicalRoot,
        size_bytes: stat.size,
        line_count: lineCount,
        score
      });
    });
  });

  return candidates.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path)).slice(0, 80);
}

/**
 * Choose files from inventory based on model response.
 */
function chooseAgentSelectedFiles(inventory, inventoryResponse, goalMode) {
  const maxFiles = computeMaxFiles(goalMode);
  const requested = Array.isArray(inventoryResponse.selected_files) ? inventoryResponse.selected_files : [];
  const selected = [];

  requested.forEach((requestedPath) => {
    const exactMatch =
      inventory.find((item) => item.path === requestedPath) ||
      inventory.find((item) => item.path.endsWith(String(requestedPath).replace(/^[^:]+:/, "")));

    if (exactMatch && !selected.some((item) => item.path === exactMatch.path)) {
      selected.push(exactMatch);
    }
  });

  if (!selected.length) {
    return inventory.slice(0, maxFiles);
  }

  return selected.slice(0, maxFiles);
}

/**
 * Load a candidate file's content, with smart truncation.
 */
function loadAgentFilePayload(candidate, options = {}) {
  const { resolvePrefixedPath } = options.helpers || {};
  const absolutePath = resolvePrefixedPath
    ? resolvePrefixedPath(candidate.path)
    : candidate.absolute_path;
  const rawContent = fs.readFileSync(absolutePath, "utf8");
  const goalMode = options.goalMode || "edit";
  const maxChars = computeMaxCharsForFile(candidate, goalMode, options.maxChars);
  const truncated = rawContent.length > maxChars;
  const content = truncated ? `${rawContent.slice(0, maxChars)}\n/* [truncated — ${rawContent.length} chars total, showing first ${maxChars}] */\n` : rawContent;

  return {
    ...candidate,
    absolute_path: absolutePath,
    char_count: rawContent.length,
    truncated,
    full_content: rawContent,
    content
  };
}

/**
 * Serialize a file payload for storage (strips content to save disk).
 */
function serializeAgentFilePayload(payload) {
  return {
    path: payload.path,
    repo: payload.repo,
    relative_path: payload.relative_path,
    logical_root: payload.logical_root,
    size_bytes: payload.size_bytes,
    line_count: payload.line_count,
    char_count: payload.char_count,
    truncated: payload.truncated
  };
}

module.exports = {
  detectGoalMode,
  detectGoalFileHints,
  computeMaxFiles,
  computeMaxCharsForFile,
  walkDirectory,
  isAgentSourceCandidate,
  tokenizeGoal,
  scoreAgentCandidateFile,
  collectAgentCandidateFiles,
  chooseAgentSelectedFiles,
  loadAgentFilePayload,
  serializeAgentFilePayload
};
