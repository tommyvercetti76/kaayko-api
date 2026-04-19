"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ollamaClient = require("./ollama-client");
const agentFilesModule = require("./agent-files");
const agentVerifyModule = require("./agent-verify");

// ── Path Constants ──────────────────────────────────────────────

const SCRIPT_DIR = __dirname;
const AUTOMATION_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(AUTOMATION_ROOT, "..");
const CONFIG_PATH = path.join(AUTOMATION_ROOT, "config", "api-loop.json");
const RUNTIME_CONFIG_PATH = path.join(AUTOMATION_ROOT, "config", "runtime.json");
const AGENT_COACHING_PATH = path.join(AUTOMATION_ROOT, "config", "api-coaching.json");
const RUNS_ROOT = path.join(AUTOMATION_ROOT, "runs");
const DATASETS_ROOT = path.join(AUTOMATION_ROOT, "datasets");
const QUEUE_ROOT = path.join(AUTOMATION_ROOT, "queue");
const DASHBOARD_ROOT = path.join(AUTOMATION_ROOT, "dashboard");
const KNOWLEDGE_ROOT = path.join(AUTOMATION_ROOT, "knowledge");
const QUEUE_DIRS = {
  pending: path.join(QUEUE_ROOT, "pending"),
  processing: path.join(QUEUE_ROOT, "processing"),
  done: path.join(QUEUE_ROOT, "done"),
  failed: path.join(QUEUE_ROOT, "failed")
};

// ── Surface Rules ───────────────────────────────────────────────
// Changed files are prefixed with "api:" (the single-repo key).

const API_SURFACE_RULES = [
  { prefix: "api:functions/api/weather/", label: "/paddlingOut + /forecast + /paddleScore" },
  { prefix: "api:functions/api/products/", label: "/products + /images" },
  { prefix: "api:functions/api/checkout/", label: "/createPaymentIntent" },
  { prefix: "api:functions/api/smartLinks/", label: "/smartlinks + /l/:id + /resolve" },
  { prefix: "api:functions/api/billing/", label: "/billing" },
  { prefix: "api:functions/api/auth/", label: "/auth" },
  { prefix: "api:functions/api/kreators/", label: "/kreators" },
  { prefix: "api:functions/api/cameras/", label: "/cameras + /lenses + /presets" },
  { prefix: "api:functions/api/kutz/", label: "/kutz + /nutrition + /meals" },
  { prefix: "api:functions/api/deepLinks/", label: "/deeplinks" },
  { prefix: "api:functions/api/ai/", label: "/ai" },
  { prefix: "api:functions/api/admin/", label: "/admin" },
  { prefix: "api:functions/middleware/", label: "auth/security middleware" },
  { prefix: "api:functions/services/", label: "shared services" },
  { prefix: "api:functions/index.js", label: "functions/index.js mounts" },
  { prefix: "api:functions/scheduled/", label: "scheduled functions" },
  { prefix: "api:ml-service/", label: "ML service" }
];

const BACKEND_ROUTE_RULES = [
  { prefix: "api:functions/api/smartLinks/", label: "/smartlinks + /l/:id + /resolve" },
  { prefix: "api:functions/api/billing/", label: "/billing" },
  { prefix: "api:functions/api/auth/", label: "/auth" },
  { prefix: "api:functions/api/kreators/", label: "/kreators" },
  { prefix: "api:functions/api/products/", label: "/products + /images" },
  { prefix: "api:functions/api/checkout/", label: "/createPaymentIntent" },
  { prefix: "api:functions/api/weather/", label: "/paddlingOut + /nearbyWater + /paddleScore + /forecast" },
  { prefix: "api:functions/api/cameras/", label: "/cameras + /lenses + /presets" },
  { prefix: "api:functions/api/kutz/", label: "/kutz + /nutrition + /meals" },
  { prefix: "api:functions/index.js", label: "functions/index.js mounts" },
  { prefix: "api:functions/middleware/", label: "auth/security middleware" }
];

// ── File I/O ────────────────────────────────────────────────────

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function ensureAutomationDirs() {
  [RUNS_ROOT, DATASETS_ROOT, QUEUE_ROOT, DASHBOARD_ROOT, KNOWLEDGE_ROOT, ...Object.values(QUEUE_DIRS)].forEach(ensureDir);
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to load ${filePath}: ${error.message}`);
  }
}

function loadOptionalJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return loadJson(filePath); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value.endsWith("\n") ? value : `${value}\n`);
}

function safeRead(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8").trim();
}

function listJsonFiles(directoryPath) {
  ensureDir(directoryPath);
  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort();
}

// ── String Utilities ────────────────────────────────────────────

function slugify(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatRunTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").replace("T", "-");
}

function relativeToRepo(targetPath) {
  return path.relative(REPO_ROOT, targetPath) || ".";
}

function resolveBooleanArg(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function joinJsonl(lines) {
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundNumber(value) {
  return Math.round(value * 10) / 10;
}

function extractFilesFromStatus(statusText) {
  return String(statusText || "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^[ MARCUD\?!]{1,2}\s+(.*)$/);
      return match ? match[1].trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractFirstNumber(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? Number(match[1]) : 0;
}

// ── Repo Resolution (single-repo) ──────────────────────────────

function resolveRepo() {
  return {
    path: ".",
    absolute_path: REPO_ROOT,
    role: "api"
  };
}

function resolvePrefixedPath(prefixedPath) {
  const colonIndex = String(prefixedPath || "").indexOf(":");
  if (colonIndex === -1) return path.resolve(REPO_ROOT, prefixedPath);
  const repoKey = prefixedPath.slice(0, colonIndex);
  const relativePath = prefixedPath.slice(colonIndex + 1);
  if (repoKey === "api") return path.join(REPO_ROOT, relativePath);
  throw new Error(`Unknown repo prefix in path: ${prefixedPath}`);
}

function resolveAbsolutePathFromPrefixed(prefixedPath) {
  const colonIndex = String(prefixedPath || "").indexOf(":");
  if (colonIndex === -1) return path.resolve(REPO_ROOT, prefixedPath);
  return resolvePrefixedPath(prefixedPath);
}

function resolveAgentRoots(config, manifest, area) {
  const normalizedArea = String(area || "shared").toLowerCase();
  const roots = [];
  const addRoot = (subpath, logicalRoot) => {
    const absoluteRoot = path.join(REPO_ROOT, subpath);
    if (fs.existsSync(absoluteRoot)) {
      roots.push({ repoKey: "api", absoluteRoot, logicalRoot });
    }
  };

  if (normalizedArea === "weather") {
    addRoot("functions/api/weather", "functions/api/weather");
    addRoot("functions/scheduled", "functions/scheduled");
    addRoot("functions/middleware", "functions/middleware");
    return roots;
  }

  if (normalizedArea === "commerce") {
    addRoot("functions/api/products", "functions/api/products");
    addRoot("functions/api/checkout", "functions/api/checkout");
    addRoot("functions/middleware", "functions/middleware");
    return roots;
  }

  if (normalizedArea === "kortex") {
    addRoot("functions/api/smartLinks", "functions/api/smartLinks");
    addRoot("functions/api/billing", "functions/api/billing");
    addRoot("functions/api/auth", "functions/api/auth");
    addRoot("functions/middleware", "functions/middleware");
    return roots;
  }

  if (normalizedArea === "kreator") {
    addRoot("functions/api/kreators", "functions/api/kreators");
    addRoot("functions/middleware", "functions/middleware");
    return roots;
  }

  if (normalizedArea === "kamera") {
    addRoot("functions/api/cameras", "functions/api/cameras");
    addRoot("functions/middleware", "functions/middleware");
    return roots;
  }

  if (normalizedArea === "kutz") {
    addRoot("functions/api/kutz", "functions/api/kutz");
    addRoot("functions/middleware", "functions/middleware");
    return roots;
  }

  // shared / backend / default — scan everything
  addRoot("functions", "functions");
  addRoot("ml-service", "ml-service");
  return roots;
}

function resolveMissionTrack(area) {
  const normalized = String(area || "shared").toLowerCase();
  const map = {
    weather: "weather",
    forecast: "weather",
    paddle: "weather",
    commerce: "commerce",
    store: "commerce",
    checkout: "commerce",
    products: "commerce",
    kortex: "kortex",
    smartlinks: "kortex",
    billing: "kortex",
    kreator: "kreator",
    kamera: "kamera",
    cameras: "kamera",
    kutz: "kutz",
    nutrition: "kutz",
    shared: "shared",
    middleware: "shared",
    auth: "shared",
    backend: "shared"
  };
  return map[normalized] || "shared";
}

// ── Run Management ──────────────────────────────────────────────

function loadRun(runRef) {
  const manifests = listRunManifests();
  if (!manifests.length) throw new Error("No runs exist yet. Start with `init` or `pipeline`.");
  if (!runRef || runRef === "latest") return manifests[manifests.length - 1];
  const match = manifests.find(({ manifest }) => manifest.run_id === runRef);
  if (!match) throw new Error(`Run ${runRef} was not found.`);
  return match;
}

function listRunManifests() {
  ensureDir(RUNS_ROOT);
  return fs
    .readdirSync(RUNS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runDir = path.join(RUNS_ROOT, entry.name);
      const manifestPath = path.join(runDir, "manifest.json");
      if (!fs.existsSync(manifestPath)) return null;
      return { runDir, manifest: loadJson(manifestPath) };
    })
    .filter(Boolean)
    .sort((left, right) => left.manifest.run_id.localeCompare(right.manifest.run_id));
}

function loadReview(runDir) {
  return loadJson(path.join(runDir, "review", "review.json"));
}

function loadAgentAnalysisFromManifest(manifest) {
  const relativePath = manifest?.artifacts?.agent_response_path;
  if (!relativePath) return null;
  const absolutePath = path.resolve(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  const parsed = loadJson(absolutePath);
  return {
    summary: String(parsed.summary || "").trim(),
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    followups: Array.isArray(parsed.followups) ? parsed.followups : [],
    safe_edits: Array.isArray(parsed.safe_edits) ? parsed.safe_edits : [],
    selected_files: normalizeAgentPathList(manifest?.agent?.selected_files),
    applied_edits: normalizeAgentPathList(manifest?.agent?.applied_files),
    rejected_edits: manifest?.agent?.rejected_edits || []
  };
}

function normalizeAgentPathList(values) {
  if (!Array.isArray(values)) return [];
  return uniqueStrings(
    values
      .map((value) => {
        if (typeof value === "string") return value;
        if (value && typeof value.path === "string") return value.path;
        return "";
      })
      .filter(Boolean)
  );
}

function summarizeAgentVerification(verification) {
  const syntaxCheck = verification?.syntax_check || {};
  const lintCheck = verification?.lint_check || {};
  const smokeTest = verification?.smoke_test || {};
  const hasSmokeTest = Boolean(verification && Object.prototype.hasOwnProperty.call(verification, "smoke_test"));

  return {
    summary: verification?.summary || "unknown",
    syntax_passed: Boolean(syntaxCheck.passed),
    lint_passed: Boolean(lintCheck.passed),
    lint_skipped: Boolean(lintCheck.skipped),
    smoke_test_passed: hasSmokeTest ? Boolean(smokeTest.passed) : false,
    smoke_test_skipped: hasSmokeTest ? Boolean(smokeTest.skipped) : true
  };
}

function sanitizeAgentState(agent) {
  if (!agent || typeof agent !== "object") return {};

  const sanitized = { ...agent };
  sanitized.selected_files = normalizeAgentPathList(agent.selected_files);
  sanitized.applied_files = normalizeAgentPathList(agent.applied_files);

  if (
    sanitized.verification &&
    (sanitized.verification.syntax_check || sanitized.verification.lint_check || sanitized.verification.smoke_test)
  ) {
    sanitized.verification = summarizeAgentVerification(sanitized.verification);
  } else if (sanitized.verification && typeof sanitized.verification === "object") {
    const summary = sanitized.verification.summary || "unknown";
    sanitized.verification = {
      summary,
      syntax_passed: Boolean(sanitized.verification.syntax_passed),
      lint_passed: Boolean(sanitized.verification.lint_passed),
      lint_skipped: Boolean(sanitized.verification.lint_skipped),
      smoke_test_passed: summary === "no_edits" ? false : Boolean(sanitized.verification.smoke_test_passed),
      smoke_test_skipped: summary === "no_edits" ? true : Boolean(sanitized.verification.smoke_test_skipped)
    };
  }

  delete sanitized.inventory;
  delete sanitized.inventory_response;
  delete sanitized.analysis;
  delete sanitized.applied_edits;

  return sanitized;
}

function resolveLearningsPublishedAt(manifest) {
  return manifest.learnings_published_at || manifest.published_at || null;
}

function statusFromReview(decision, currentStatus) {
  if (decision === "approved") return "reviewed";
  if (decision === "changes_requested") return "changes_requested";
  if (decision === "rejected") return "rejected";
  return currentStatus || "initialized";
}

function updateRunManifest(runDir, updater) {
  const manifestPath = path.join(runDir, "manifest.json");
  const manifest = loadJson(manifestPath);
  const updated = typeof updater === "function" ? updater(manifest) || manifest : { ...manifest, ...updater };
  updated.updated_at = new Date().toISOString();
  writeJson(manifestPath, updated);
  return updated;
}

function readDashboardSummary() {
  const summaryPath = path.join(DASHBOARD_ROOT, "summary.json");
  if (!fs.existsSync(summaryPath)) return null;
  return loadJson(summaryPath);
}

// ── Template Rendering ──────────────────────────────────────────

function renderTemplate(templateName, replacements) {
  const templatePath = path.join(AUTOMATION_ROOT, "templates", templateName);
  let template = fs.readFileSync(templatePath, "utf8");
  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replaceAll(`{{${key}}}`, value);
  });
  return template;
}

function queueStatusCounts() {
  return {
    pending: listJsonFiles(QUEUE_DIRS.pending).length,
    processing: listJsonFiles(QUEUE_DIRS.processing).length,
    done: listJsonFiles(QUEUE_DIRS.done).length,
    failed: listJsonFiles(QUEUE_DIRS.failed).length
  };
}

// ── Validation ──────────────────────────────────────────────────

function validateInitArgs(config, args) {
  if (!args.track || !config.tracks[args.track]) {
    throw new Error("This command requires --track with one of the configured tracks.");
  }
  if (!args.idea) {
    throw new Error("This command requires --idea.");
  }
}

function validateReview(review) {
  const decisions = new Set(["pending", "approved", "changes_requested", "rejected"]);
  if (!decisions.has(review.decision)) {
    throw new Error("review.json decision must be one of pending, approved, changes_requested, rejected.");
  }
  if (review.decision !== "pending" && !String(review.summary || "").trim()) {
    throw new Error("review.json summary is required once a review decision is recorded.");
  }
  ["accuracy_score", "maintainability_score", "confidence_score"].forEach((field) => {
    const value = Number(review[field]);
    if (Number.isNaN(value) || value < 0 || value > 100) {
      throw new Error(`review.json ${field} must be a number between 0 and 100.`);
    }
  });
  ["findings", "security_findings", "debt_findings", "ux_findings", "required_followups", "waivers"].forEach((field) => {
    if (!Array.isArray(review[field])) {
      throw new Error(`review.json ${field} must be an array.`);
    }
  });
  if (!review.context_checks || typeof review.context_checks !== "object") {
    throw new Error("review.json context_checks must be present.");
  }
  ["api_surfaces_checked", "backend_routes_checked", "tests_run"].forEach((field) => {
    if (!Array.isArray(review.context_checks[field])) {
      throw new Error(`review.json context_checks.${field} must be an array.`);
    }
  });
  if (!review.training_labels || typeof review.training_labels !== "object") {
    throw new Error("review.json training_labels must be present.");
  }
  if (typeof review.training_labels.approved_for_training !== "boolean") {
    throw new Error("review.json training_labels.approved_for_training must be true or false.");
  }
}

// ── Metrics ─────────────────────────────────────────────────────

function computeRunMetrics(manifest) {
  const diffSummary = (manifest.git_snapshots || []).reduce(
    (acc, snapshot) => {
      const parsed = snapshot && snapshot.product_diff_summary
        ? {
            files_changed: Number(snapshot.product_diff_summary.files_changed || 0),
            insertions: Number(snapshot.product_diff_summary.insertions || 0),
            deletions: Number(snapshot.product_diff_summary.deletions || 0)
          }
        : parseDiffStatSummary(snapshot.diff_stat);
      acc.files_changed += parsed.files_changed;
      acc.insertions += parsed.insertions;
      acc.deletions += parsed.deletions;
      return acc;
    },
    { files_changed: 0, insertions: 0, deletions: 0 }
  );
  const changedFiles = manifest.changed_files || [];
  const meaningfulFiles = changedFiles.filter(isMeaningfulProductFile);

  return {
    changed_files_count: changedFiles.length,
    backend_files_changed: changedFiles.filter((f) => f.startsWith("api:functions/")).length,
    ml_files_changed: changedFiles.filter((f) => f.startsWith("api:ml-service/")).length,
    meaningful_product_files_changed: meaningfulFiles.length,
    meaningful_backend_files_changed: meaningfulFiles.length,
    total_churn: diffSummary.insertions + diffSummary.deletions,
    insertions: diffSummary.insertions,
    deletions: diffSummary.deletions
  };
}

function parseDiffStatSummary(diffStat) {
  const text = String(diffStat || "");
  return {
    files_changed: extractFirstNumber(text, /(\d+)\s+files?\s+changed/),
    insertions: extractFirstNumber(text, /(\d+)\s+insertions?\(\+\)/),
    deletions: extractFirstNumber(text, /(\d+)\s+deletions?\(-\)/)
  };
}

function parseNumStatSummary(numStatText, allowedPaths) {
  const allowSet = allowedPaths ? new Set(allowedPaths) : null;
  const totals = { files_changed: 0, insertions: 0, deletions: 0 };
  const seenFiles = new Set();

  String(numStatText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split("\t");
      if (parts.length < 3) return;
      const filePath = parts.slice(2).join("\t").trim();
      if (!filePath) return;
      if (allowSet && !allowSet.has(filePath)) return;

      if (!seenFiles.has(filePath)) {
        seenFiles.add(filePath);
        totals.files_changed += 1;
      }

      const insertions = Number(parts[0]);
      const deletions = Number(parts[1]);
      totals.insertions += Number.isFinite(insertions) ? insertions : 0;
      totals.deletions += Number.isFinite(deletions) ? deletions : 0;
    });

  return totals;
}

function deriveApiSurfaces(changedFiles) {
  return uniqueStrings(
    changedFiles.flatMap((filePath) =>
      API_SURFACE_RULES.filter((rule) => filePath.startsWith(rule.prefix)).map((rule) => rule.label)
    )
  );
}

function deriveBackendRoutes(changedFiles) {
  return uniqueStrings(
    changedFiles.flatMap((filePath) =>
      BACKEND_ROUTE_RULES.filter((rule) => filePath.startsWith(rule.prefix)).map((rule) => rule.label)
    )
  );
}

function isMeaningfulProductFile(filePath) {
  return filePath.startsWith("api:functions/") || filePath.startsWith("api:ml-service/");
}

function debtLevelFromMetrics(failedGateCount, metrics) {
  if (failedGateCount > 0 || metrics.total_churn > 700) return "high";
  if (metrics.changed_files_count > 18 || metrics.total_churn > 500) return "medium";
  return "low";
}

function severityRank(severity) {
  const value = String(severity || "").toLowerCase();
  const order = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
  return order[value] !== undefined ? order[value] : order.unknown;
}

function isVulnerabilityFinding(finding) {
  const severity = String(finding?.severity || "").toLowerCase();
  const category = String(finding?.category || "").toLowerCase();
  return ["critical", "high"].includes(severity) || ["quality", "security", "auth", "billing", "tenant"].includes(category);
}

function isSuggestionFinding(finding) {
  const severity = String(finding?.severity || "").toLowerCase();
  const category = String(finding?.category || "").toLowerCase();
  if (isVulnerabilityFinding(finding)) return false;
  return ["low", "medium"].includes(severity) || ["duplication", "maintainability", "ux", "scope", "traceability"].includes(category);
}

// ── Git Operations ──────────────────────────────────────────────

function captureGitSnapshot(repoKey, repoPath) {
  const branch = runShell("git branch --show-current", repoPath);
  const head = runShell("git rev-parse HEAD", repoPath);
  const statusShort = runShell("git status --short", repoPath);
  const diffStat = runShell("git diff --stat", repoPath);
  const diffNumStat = runShell("git diff --numstat", repoPath);
  const stagedNumStat = runShell("git diff --cached --numstat", repoPath);
  const diffNameOnly = runShell("git diff --name-only", repoPath);
  const stagedNameOnly = runShell("git diff --cached --name-only", repoPath);
  const changedFiles = Array.from(
    new Set(
      [diffNameOnly.stdout, stagedNameOnly.stdout, extractFilesFromStatus(statusShort.stdout)]
        .join("\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ).sort();
  // Exclude automation infrastructure files from metrics
  const productChangedFiles = changedFiles.filter((f) => !f.startsWith("automation/"));
  const prefixedChangedFiles = productChangedFiles.map((filePath) => `${repoKey}:${filePath}`);
  const productDiffSummary = parseNumStatSummary(
    [diffNumStat.stdout, stagedNumStat.stdout].filter(Boolean).join("\n"),
    productChangedFiles
  );

  return {
    repo: repoKey,
    path: relativeToRepo(repoPath),
    branch: branch.stdout.trim(),
    head: head.stdout.trim(),
    status_short: statusShort.stdout.trim(),
    diff_stat: diffStat.stdout.trim(),
    changed_files: prefixedChangedFiles,
    repo_relative_changed_files: productChangedFiles,
    product_diff_summary: productDiffSummary,
    captured_at: new Date().toISOString()
  };
}

function runQualityGate(config, runDir, gate) {
  const workingDir = path.resolve(REPO_ROOT, gate.cwd || ".");
  const result = runShell(gate.command, workingDir);
  const logPath = path.join(runDir, "artifacts", "commands", `${gate.id}.log`);
  const assessment = assessQualityGateResult(result);

  writeText(
    logPath,
    [
      `# ${gate.label}`,
      `cwd: ${workingDir}`,
      `command: ${gate.command}`,
      `exit_code: ${result.exit_code}`,
      `duration_ms: ${result.duration_ms}`,
      "",
      "## stdout",
      result.stdout,
      "",
      "## stderr",
      result.stderr
    ].join("\n")
  );

  return {
    ...gate,
    status: assessment.status,
    blocking_reason: assessment.reason,
    last_run_at: new Date().toISOString(),
    exit_code: result.exit_code,
    duration_ms: result.duration_ms,
    log_path: relativeToRepo(logPath)
  };
}

function assessQualityGateResult(result) {
  if (result.exit_code === 0) return { status: "passed", reason: null };
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const blockedPatterns = [
    /listen EPERM/i, /operation not permitted/i, /EACCES/i, /sandbox/i, /permission denied/i
  ];
  if (blockedPatterns.some((pattern) => pattern.test(combinedOutput))) {
    return { status: "blocked", reason: "environment_restriction" };
  }
  return { status: "failed", reason: "command_failed" };
}

function reconcileQualityGatesFromLogs(gates) {
  return gates.map((gate) => {
    if (!gate.log_path || gate.exit_code === null || gate.exit_code === undefined) return gate;
    const logPath = path.resolve(REPO_ROOT, gate.log_path);
    if (!fs.existsSync(logPath)) return gate;
    const logContent = fs.readFileSync(logPath, "utf8");
    const assessment = assessQualityGateResult({ exit_code: gate.exit_code, stdout: "", stderr: logContent });
    return { ...gate, status: assessment.status, blocking_reason: assessment.reason };
  });
}

// ── Training Eligibility ────────────────────────────────────────

function computeTrainingEligibility(config, manifest, review) {
  const policy = config.training_policy;
  const gateFailed =
    policy.require_quality_gates_passed &&
    manifest.quality_gates.some((gate) => gate.status && gate.status !== "passed");
  const openBlockingFinding = review.findings.some((finding) => {
    const severity = String(finding.severity || "").toLowerCase();
    const status = String(finding.status || "open").toLowerCase();
    return policy.disqualifying_open_severities.includes(severity) && status !== "waived" && status !== "resolved";
  });

  if (review.decision !== "approved") return { eligible: false, reason: "Review decision is not approved." };
  if (!review.training_labels.approved_for_training) return { eligible: false, reason: "Reviewer has not approved this run for training use." };
  if (Number(review.accuracy_score) < policy.minimum_accuracy_score) return { eligible: false, reason: `Accuracy score is below ${policy.minimum_accuracy_score}.` };
  if (Number(review.maintainability_score) < policy.minimum_maintainability_score) return { eligible: false, reason: `Maintainability score is below ${policy.minimum_maintainability_score}.` };
  if (gateFailed) return { eligible: false, reason: "At least one quality gate failed." };
  if (openBlockingFinding) return { eligible: false, reason: "There is at least one unresolved high-severity finding." };
  return { eligible: true, reason: "Approved review with passing gates and threshold scores." };
}

function isAutoReviewRun(runDir, review) {
  const reviewNotes = safeRead(path.join(runDir, "review", "review.md"));
  const summary = String(review.summary || "");
  return (
    reviewNotes.includes("Generated By: `auto-review`") ||
    summary.startsWith("Automated review generated from configured quality gates")
  );
}

// ── Shell Execution ─────────────────────────────────────────────

function runShell(command, cwd, timeoutMs = 90000) {
  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    env: process.env,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024
  });
  return {
    exit_code: result.status === null ? 1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    duration_ms: Date.now() - startedAt
  };
}

function whichBinary(name) {
  const result = spawnSync(`which ${name}`, {
    cwd: REPO_ROOT, shell: true, encoding: "utf8", env: process.env
  });
  if (result.status !== 0) return null;
  return String(result.stdout || "").trim() || null;
}

function makeCheck(label, ok, detail) {
  return { label, ok, detail };
}

// ── Ollama Interaction ──────────────────────────────────────────

const ollamaBinaryProbeCache = new Map();

function summarizeOllamaFailure(message) {
  const normalized = String(message || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "unknown Ollama failure";
  if (/Failed to connect to .*127\.0\.0\.1.*11434|connect to server|ECONNREFUSED/i.test(normalized)) {
    return "daemon not reachable at the configured base_url";
  }
  if (/NSRangeException|SIGABRT|libmlx|metal allocator|mlx_random_key/i.test(normalized)) {
    return "binary crashed during local MLX/Metal initialization";
  }
  if (/timed out|timeout/i.test(normalized)) {
    return "request timed out";
  }
  return normalized.slice(0, 220);
}

function probeOllamaBinary(binaryPath, timeoutMs = 5000) {
  if (!binaryPath) {
    return { ok: false, detail: "binary not found" };
  }

  const cacheKey = `${binaryPath}:${timeoutMs}`;
  if (ollamaBinaryProbeCache.has(cacheKey)) {
    return ollamaBinaryProbeCache.get(cacheKey);
  }

  const result = spawnSync(binaryPath, ["--version"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024
  });

  let probe;
  if (result.error) {
    probe = { ok: false, detail: summarizeOllamaFailure(result.error.message) };
  } else if (result.status === 0) {
    probe = { ok: true, detail: String(result.stdout || result.stderr || "healthy").trim() };
  } else {
    probe = {
      ok: false,
      detail: summarizeOllamaFailure(String(result.stderr || result.stdout || `exit ${result.status}`))
    };
  }

  ollamaBinaryProbeCache.set(cacheKey, probe);
  return probe;
}

function invokeOllamaPrompt(runtime, prompt, label) {
  const binary = whichBinary("ollama");
  const httpErrors = [];
  const allowCliFallback = runtime.allow_cli_fallback === true;

  if (!runtime.model) {
    throw new Error(`No local model is configured for ${label}. Use \`./automation/kaayko-api model use <model>\`.`);
  }

  if (runtime.base_url) {
    try { return invokeOllamaHttpPrompt(runtime, prompt, label); }
    catch (error) { httpErrors.push(summarizeOllamaFailure(error.message)); }
  }

  if (runtime.base_url && !allowCliFallback) {
    throw new Error(`Ollama HTTP ${label} failed and CLI fallback is disabled: ${httpErrors.join("; ") || "unknown HTTP error"}`);
  }

  if (!binary) {
    throw new Error(
      `Ollama is required for ${label}, but the HTTP endpoint failed (${httpErrors.join("; ") || "no endpoint configured"}) and the \`ollama\` binary was not found.`
    );
  }

  const binaryProbe = probeOllamaBinary(binary, 5000);
  if (!binaryProbe.ok) {
    const httpPrefix = httpErrors.length ? `HTTP failed (${httpErrors.join("; ")}); ` : "";
    throw new Error(`Ollama ${label} unavailable: ${httpPrefix}CLI binary is unhealthy (${binaryProbe.detail}).`);
  }

  const env = { ...process.env };
  if (runtime.base_url) {
    try { env.OLLAMA_HOST = new URL(runtime.base_url).host; }
    catch { env.OLLAMA_HOST = runtime.base_url; }
  }

  const result = spawnSync(binary, ["run", runtime.model], {
    cwd: REPO_ROOT, env, encoding: "utf8",
    input: prompt,
    timeout: Number(runtime.timeout_ms || 300000),
    maxBuffer: 24 * 1024 * 1024
  });

  if (result.error) throw new Error(`Ollama ${label} failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Ollama ${label} failed with exit code ${result.status}: ${summarizeOllamaFailure(String(result.stderr || result.stdout || "").trim())}`);
  }

  const output = String(result.stdout || "").trim();
  if (!output) throw new Error(`Ollama ${label} returned no output.`);
  return output;
}

function invokeOllamaHttpPrompt(runtime, prompt, label) {
  try {
    return ollamaClient.generateSync(runtime, prompt, label);
  } catch (error) {
    throw new Error(`Ollama HTTP ${label} failed: ${summarizeOllamaFailure(error.message)}`);
  }
}

/**
 * Invoke Ollama with streaming progress display.
 * Uses spawn (async) + stream:true to show live token count and elapsed time.
 * Blocks until complete (via spawnSync wrapper that runs a streaming child).
 */
function invokeOllamaStreamingPrompt(runtime, prompt, label) {
  const curl = whichBinary("curl");
  if (!curl) throw new Error("curl is required for streaming Ollama requests.");

  const requestUrl = `${String(runtime.base_url || "http://127.0.0.1:11434").replace(/\/$/, "")}/api/generate`;
  const payload = {
    model: runtime.model,
    prompt,
    stream: true,
    options: {
      temperature: runtime.temperature ?? 0.1,
      num_predict: runtime.max_tokens ?? 4096
    }
  };

  // Write a small Node script that handles streaming + progress display
  const streamScript = `
const http = require("http");
const url = new URL(process.argv[2]);
const payload = process.argv[3];
let accumulated = "";
let tokenCount = 0;
let lastProgress = 0;
const startTime = Date.now();
const phases = ["◐","◓","◑","◒"];
let phaseIdx = 0;

const req = http.request({
  hostname: url.hostname,
  port: url.port || 11434,
  path: url.pathname,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  timeout: ${Number(runtime.timeout_ms || 300000)}
}, (res) => {
  let buffer = "";
  res.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.response) {
          accumulated += parsed.response;
          tokenCount++;
        }
        const now = Date.now();
        if (now - lastProgress > 500) {
          lastProgress = now;
          const elapsed = ((now - startTime) / 1000).toFixed(0);
          const phase = phases[phaseIdx++ % phases.length];
          const tokSec = elapsed > 0 ? (tokenCount / elapsed).toFixed(1) : "...";
          process.stderr.write("\\r\\x1b[2K    " + phase + " " + tokenCount + " tokens · " + elapsed + "s · " + tokSec + " tok/s");
        }
        if (parsed.done) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const evalTokSec = parsed.eval_count && parsed.eval_duration
            ? (parsed.eval_count / (parsed.eval_duration / 1e9)).toFixed(1)
            : null;
          const promptTok = parsed.prompt_eval_count || "?";
          process.stderr.write("\\r\\x1b[2K    ✓ " + (parsed.eval_count || tokenCount) + " tokens generated in " + elapsed + "s" + (evalTokSec ? " (" + evalTokSec + " tok/s)" : "") + " · prompt: " + promptTok + " tokens\\n");
        }
      } catch {}
    }
  });
  res.on("end", () => {
    if (buffer.trim()) {
      try { const p = JSON.parse(buffer); if (p.response) accumulated += p.response; } catch {}
    }
    process.stdout.write(JSON.stringify({ response: accumulated.trim() }));
  });
  res.on("error", (e) => {
    process.stderr.write("\\n    ✗ Stream error: " + e.message + "\\n");
    process.exit(1);
  });
});
req.on("timeout", () => { req.destroy(); process.stderr.write("\\n    ✗ Timeout\\n"); process.exit(1); });
req.on("error", (e) => { process.stderr.write("\\n    ✗ " + e.message + "\\n"); process.exit(1); });
req.write(payload);
req.end();
`;

  const scriptPath = path.join(os.tmpdir(), `kaayko-api-stream-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(scriptPath, streamScript);

  try {
    const result = spawnSync(
      process.execPath,
      [scriptPath, requestUrl, JSON.stringify(payload)],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: Number(runtime.timeout_ms || 300000) + 15000,
        maxBuffer: 24 * 1024 * 1024,
        stdio: ["pipe", "pipe", "inherit"],  // stderr goes to terminal for live progress
        env: process.env
      }
    );
    if (result.error) throw new Error(result.error.message);
    if (result.status !== 0) throw new Error(`Streaming ${label} failed with exit ${result.status}`);

    const parsed = JSON.parse(String(result.stdout || "{}"));
    const responseText = String(parsed.response || "").trim();
    if (!responseText) throw new Error(`Ollama streaming ${label} returned empty response.`);
    return responseText;
  } catch (error) {
    if (error.message.includes("Ollama") || error.message.includes("Streaming")) throw error;
    throw new Error(`Ollama streaming ${label} failed: ${error.message}`);
  } finally {
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
  }
}

function fetchOllamaTags(runtime, timeoutMs = 5000) {
  const curl = whichBinary("curl");
  if (!curl) throw new Error("curl is required to query the Ollama daemon.");

  const requestUrl = `${String(runtime.base_url || "http://127.0.0.1:11434").replace(/\/$/, "")}/api/tags`;
  const result = spawnSync(curl, ["-sS", requestUrl], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env
  });
  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "").trim() || `curl exit ${result.status}`);

  const parsed = JSON.parse(String(result.stdout || "{}"));
  return Array.isArray(parsed.models) ? parsed.models : [];
}

function parseAgentJsonResponse(rawText, label) {
  const candidates = [
    String(rawText || "").trim(),
    extractCodeFence(rawText),
    extractJsonBlock(rawText)
  ].filter(Boolean);

  for (const candidate of candidates) {
    try { return JSON.parse(candidate); }
    catch { /* continue */ }
  }
  throw new Error(`Could not parse JSON from Ollama ${label} response.`);
}

function extractCodeFence(text) {
  const match = String(text || "").match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : "";
}

function extractJsonBlock(text) {
  const source = String(text || "");
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return "";
  return source.slice(firstBrace, lastBrace + 1).trim();
}

// ── Coaching System ─────────────────────────────────────────────

function loadAgentCoachingConfig() {
  const config = loadOptionalJson(AGENT_COACHING_PATH, {
    api_overview: "",
    track_profiles: {},
    profiles: {}
  });
  // Normalize to a common key for downstream compatibility
  config.portfolio_overview = config.api_overview || config.portfolio_overview || "";
  return config;
}

function normalizeCoachingPath(value) {
  return String(value || "").trim().toLowerCase().replace(/\/+$/g, "");
}

function coachingPathMatches(prefix, candidatePath) {
  const normalizedPrefix = normalizeCoachingPath(prefix);
  const normalizedCandidate = normalizeCoachingPath(candidatePath);
  return Boolean(normalizedPrefix) && Boolean(normalizedCandidate) && normalizedCandidate.startsWith(normalizedPrefix);
}

function buildCoachingProfileKeywords(profile) {
  return uniqueStrings(
    [
      profile.id,
      ...(profile.keywords || []),
      ...String(profile.name || "").toLowerCase().split(/[^a-z0-9]+/g).filter((token) => token.length >= 4)
    ].map((item) => String(item || "").trim().toLowerCase())
  );
}

function scoreCoachingProfile(profile, context) {
  const goalLower = String(context.goal || "").toLowerCase();
  const goalTokens = Array.isArray(context.goalTokens) ? context.goalTokens : [];
  const area = String(context.area || "").toLowerCase();
  const track = String(context.track || "").toLowerCase();
  const filePaths = Array.isArray(context.filePaths) ? context.filePaths : [];
  let score = 0;

  if (profile.id === track) score += 16;
  if (profile.id === area) score += 14;
  if (track === "shared" && profile.id === "shared") score += 18;
  if (goalLower.includes(String(profile.name || "").toLowerCase())) score += 12;

  buildCoachingProfileKeywords(profile).forEach((keyword) => {
    if (!keyword) return;
    if (goalTokens.includes(keyword)) score += 8;
    else if (keyword.length >= 6 && goalLower.includes(keyword)) score += 6;
  });

  const profilePaths = uniqueStrings([...(profile.api_paths || [])]);
  if (filePaths.some((filePath) => profilePaths.some((prefix) => coachingPathMatches(prefix, filePath)))) {
    score += 20;
  }

  return score;
}

function selectFocusedProfiles(scoredProfiles) {
  if (!scoredProfiles.length) return [];
  const focused = [scoredProfiles[0]];
  scoredProfiles.slice(1).forEach((profile) => {
    if (focused.length >= 3) return;
    if (profile.focus_score >= 10) focused.push(profile);
  });
  return focused;
}

function extractDocSnapshot(content) {
  const selectedLines = [];
  let totalChars = 0;
  const maxChars = 1000;

  String(content || "").split(/\r?\n/g).map((line) => line.trim()).forEach((line) => {
    if (!line || totalChars >= maxChars || selectedLines.length >= 8) return;
    const isInteresting =
      /^#{1,3}\s/.test(line) || /^[-*]\s/.test(line) || /^\d+\.\s/.test(line) ||
      (line.length >= 40 && line.length <= 220);
    if (!isInteresting) return;
    const normalized = line.replace(/^#{1,3}\s*/, "").replace(/^[-*]\s*/, "").trim();
    if (!normalized) return;
    selectedLines.push(normalized);
    totalChars += normalized.length;
  });

  return selectedLines.join(" ");
}

function buildCoachingDocSnapshots(sourceDocs) {
  return uniqueStrings(sourceDocs).slice(0, 4).map((docPath) => {
    const absolutePath = path.resolve(REPO_ROOT, docPath);
    if (!fs.existsSync(absolutePath)) {
      return { path: docPath, status: "missing", summary: "Document not found in the current workspace." };
    }
    const summary = extractDocSnapshot(fs.readFileSync(absolutePath, "utf8"));
    return { path: docPath, status: "ok", summary: summary || "No concise snapshot was extracted." };
  });
}

function buildAgentCoachingBundle(track, area, goal, context = {}) {
  const coachingConfig = context.coachingConfig || loadAgentCoachingConfig();
  const trackProfiles = coachingConfig.track_profiles || {};
  const profilesMap = coachingConfig.profiles || {};
  const requestedTrack = String(track || resolveMissionTrack(area)).toLowerCase();
  const requestedArea = String(area || requestedTrack || "shared").toLowerCase();
  const goalValue = String(goal || "").trim();
  const goalTokens = agentFilesModule.tokenizeGoal(goalValue);
  const filePaths = uniqueStrings(context.filePaths || []);
  const candidateIds = uniqueStrings(trackProfiles[requestedTrack] || Object.keys(profilesMap));
  const scoredProfiles = candidateIds
    .map((id) => ({ id, ...(profilesMap[id] || {}) }))
    .filter((profile) => profile && profile.name)
    .map((profile) => ({
      ...profile,
      focus_score: scoreCoachingProfile(profile, {
        goal: goalValue, goalTokens, area: requestedArea, track: requestedTrack, filePaths
      })
    }))
    .sort((left, right) => right.focus_score - left.focus_score || left.name.localeCompare(right.name));
  const focusedProfiles = selectFocusedProfiles(scoredProfiles);
  const focusedProfileIds = focusedProfiles.map((profile) => profile.id);
  const focusedSourceDocs = uniqueStrings(focusedProfiles.flatMap((profile) => profile.source_docs || []));
  const supportingProfiles = scoredProfiles.filter((profile) => !focusedProfileIds.includes(profile.id));

  return {
    portfolio_overview: coachingConfig.portfolio_overview || "",
    goal: goalValue,
    area: requestedArea,
    track: requestedTrack,
    profile_ids: scoredProfiles.map((profile) => profile.id),
    guided_products: scoredProfiles.map((profile) => profile.name),
    focused_profile_ids: focusedProfileIds,
    focused_products: focusedProfiles.map((profile) => profile.name),
    source_docs: uniqueStrings(scoredProfiles.flatMap((profile) => profile.source_docs || [])),
    focused_source_docs: focusedSourceDocs,
    critical_path_prefixes: uniqueStrings(scoredProfiles.flatMap((profile) => profile.api_paths || [])),
    priority_path_prefixes: uniqueStrings(focusedProfiles.flatMap((profile) => profile.api_paths || [])),
    route_focus: uniqueStrings(scoredProfiles.flatMap((profile) => profile.backend_routes || [])),
    validation_focus: uniqueStrings(scoredProfiles.flatMap((profile) => profile.validation_focus || [])),
    risk_focus: uniqueStrings(scoredProfiles.flatMap((profile) => profile.risk_focus || [])),
    doc_snapshots: buildCoachingDocSnapshots(
      focusedSourceDocs.length ? focusedSourceDocs : uniqueStrings(scoredProfiles.flatMap((profile) => profile.source_docs || []))
    ),
    profiles: scoredProfiles,
    focused_profiles: focusedProfiles,
    supporting_profiles: supportingProfiles
  };
}

function resolveRunCoachingContext(manifest, coachingConfig) {
  if (!coachingConfig) coachingConfig = loadAgentCoachingConfig();
  const filePaths = uniqueStrings([
    ...(manifest.changed_files || []),
    ...normalizeAgentPathList(manifest.agent?.selected_files),
    ...normalizeAgentPathList(manifest.agent?.applied_files)
  ]);
  const inferred = buildAgentCoachingBundle(manifest.track, manifest.requested_area, manifest.goal, {
    coachingConfig, filePaths
  });
  const persisted = manifest.coaching || {};

  return {
    ...inferred,
    profile_ids: uniqueStrings([...(persisted.profile_ids || []), ...inferred.profile_ids]),
    guided_products: uniqueStrings([...(persisted.guided_products || []), ...inferred.guided_products]),
    focused_profile_ids: uniqueStrings([...(persisted.focused_profile_ids || []), ...inferred.focused_profile_ids]),
    focused_products: uniqueStrings([...(persisted.focused_products || []), ...inferred.focused_products]),
    source_docs: uniqueStrings([...(persisted.source_docs || []), ...inferred.source_docs]),
    focused_source_docs: uniqueStrings([...(persisted.focused_source_docs || []), ...inferred.focused_source_docs]),
    route_focus: uniqueStrings([...(persisted.route_focus || []), ...inferred.route_focus]),
    validation_focus: uniqueStrings([...(persisted.validation_focus || []), ...inferred.validation_focus]),
    risk_focus: uniqueStrings([...(persisted.risk_focus || []), ...inferred.risk_focus])
  };
}

function buildAgentCoachingMarkdown(bundle, context = {}) {
  const profiles = bundle.profiles.length
    ? bundle.profiles.map((profile) => {
        const docs = (profile.source_docs || []).map((doc) => `- ${doc}`).join("\n");
        const validation = (profile.validation_focus || []).map((item) => `- ${item}`).join("\n");
        const risks = (profile.risk_focus || []).map((item) => `- ${item}`).join("\n");
        const paths = (profile.api_paths || []).slice(0, 8).map((item) => `- ${item}`).join("\n");
        const routes = (profile.backend_routes || []).map((item) => `- ${item}`).join("\n");
        const priority = bundle.focused_profile_ids.includes(profile.id) ? "primary" : "supporting";

        return `## ${profile.name}

- Priority: ${priority}
- Purpose: ${profile.purpose || "No purpose documented."}
- Source docs:
${docs || "- None."}
- API paths:
${paths || "- None."}
- Backend routes:
${routes || "- None."}
- Validation focus:
${validation || "- None."}
- Risk focus:
${risks || "- None."}
`;
      }).join("\n")
    : "No coaching profiles were configured for this track.";

  const docSnapshots = bundle.doc_snapshots.length
    ? bundle.doc_snapshots.map((doc) => `- ${doc.path}: ${doc.summary}`).join("\n")
    : "- No focused product docs were snapshot for this run.";

  return `# Agent Briefing

- Track: \`${bundle.track}\`
- Area: \`${context.area || bundle.area}\`
- Goal: ${context.goal || bundle.goal || "No goal provided."}
- Guided products: ${bundle.guided_products.length ? bundle.guided_products.join(", ") : "None"}
- Primary focus products: ${bundle.focused_products.length ? bundle.focused_products.join(", ") : "None"}
- Source docs: ${bundle.source_docs.length ? bundle.source_docs.join(", ") : "None"}

## Portfolio Overview

${bundle.portfolio_overview || "No portfolio overview configured."}

## Focused Doc Snapshots

${docSnapshots}

${profiles}
`;
}

function buildAgentCoachingPromptSection(bundle) {
  const profileSections = bundle.profiles.length
    ? bundle.profiles.map((profile) => {
        const validations = (profile.validation_focus || []).map((item) => `  - ${item}`).join("\n");
        const risks = (profile.risk_focus || []).map((item) => `  - ${item}`).join("\n");
        const routes = (profile.backend_routes || []).map((item) => `  - ${item}`).join("\n");
        const paths = (profile.api_paths || []).slice(0, 8).map((item) => `  - ${item}`).join("\n");
        const priority = bundle.focused_profile_ids.includes(profile.id) ? "Primary focus" : "Supporting context";
        return [
          `Product: ${profile.name} (${priority})`,
          `Purpose: ${profile.purpose || "No purpose documented."}`,
          "API paths:", paths || "  - None.",
          "Backend routes:", routes || "  - None.",
          "Validation focus:", validations || "  - None.",
          "Risk focus:", risks || "  - None."
        ].join("\n");
      }).join("\n\n")
    : "No product coaching is configured for this run.";

  const docSnapshots = bundle.doc_snapshots.length
    ? bundle.doc_snapshots.map((doc) => `- ${doc.path}: ${doc.summary}`).join("\n")
    : "- No focused product docs were available.";

  return [
    "PORTFOLIO COACHING",
    `Portfolio overview: ${bundle.portfolio_overview || "No overview configured."}`,
    `Guided products: ${bundle.guided_products.length ? bundle.guided_products.join(", ") : "None"}`,
    `Primary focus products: ${bundle.focused_products.length ? bundle.focused_products.join(", ") : "None"}`,
    `Source docs: ${bundle.source_docs.length ? bundle.source_docs.join(", ") : "None"}`,
    "",
    "Focused doc snapshots:",
    docSnapshots,
    "",
    profileSections
  ].join("\n");
}

// ── Log Rotation ────────────────────────────────────────────────

function pruneOldLogs(maxAgeDays = 7, maxSizeMB = 50) {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  const now = Date.now();
  let pruned = 0;

  // Prune dashboard live-*.log files
  try {
    const dashFiles = fs.readdirSync(DASHBOARD_ROOT).filter((f) => f.startsWith("live-") && f.endsWith(".log"));
    for (const f of dashFiles) {
      const fp = path.join(DASHBOARD_ROOT, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > maxAgeMs || stat.size > maxSizeBytes) {
        fs.unlinkSync(fp);
        pruned++;
      }
    }
  } catch {}

  // Prune automation/logs/ directory
  const logsDir = path.join(AUTOMATION_ROOT, "logs");
  try {
    if (fs.existsSync(logsDir)) {
      const logFiles = fs.readdirSync(logsDir).filter((f) => f.endsWith(".log") || f.endsWith(".txt"));
      for (const f of logFiles) {
        const fp = path.join(logsDir, f);
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > maxAgeMs || stat.size > maxSizeBytes) {
          fs.unlinkSync(fp);
          pruned++;
        }
      }
    }
  } catch {}

  return pruned;
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = {
  // Constants
  SCRIPT_DIR, AUTOMATION_ROOT, REPO_ROOT,
  CONFIG_PATH, RUNTIME_CONFIG_PATH, AGENT_COACHING_PATH,
  RUNS_ROOT, DATASETS_ROOT, QUEUE_ROOT, DASHBOARD_ROOT, KNOWLEDGE_ROOT,
  QUEUE_DIRS, API_SURFACE_RULES, BACKEND_ROUTE_RULES,
  // File I/O
  ensureDir, ensureAutomationDirs, loadJson, loadOptionalJson,
  writeJson, writeText, safeRead, listJsonFiles,
  // String utils
  slugify, escapeHtml, formatRunTimestamp, relativeToRepo,
  resolveBooleanArg, uniqueStrings, joinJsonl, clampScore, roundNumber,
  extractFilesFromStatus, extractFirstNumber,
  // Repo resolution
  resolveRepo, resolvePrefixedPath, resolveAbsolutePathFromPrefixed,
  resolveAgentRoots, resolveMissionTrack,
  // Run management
  loadRun, listRunManifests, loadReview, loadAgentAnalysisFromManifest,
  normalizeAgentPathList, summarizeAgentVerification, sanitizeAgentState,
  resolveLearningsPublishedAt, statusFromReview, updateRunManifest, readDashboardSummary,
  // Template / queue
  renderTemplate, queueStatusCounts,
  // Validation
  validateInitArgs, validateReview,
  // Metrics
  computeRunMetrics, parseDiffStatSummary, parseNumStatSummary, deriveApiSurfaces, deriveBackendRoutes,
  isMeaningfulProductFile, debtLevelFromMetrics,
  severityRank, isVulnerabilityFinding, isSuggestionFinding,
  // Git
  captureGitSnapshot, runQualityGate, assessQualityGateResult, reconcileQualityGatesFromLogs,
  // Training
  computeTrainingEligibility, isAutoReviewRun,
  // Shell
  runShell, whichBinary, makeCheck,
  // Ollama
  invokeOllamaPrompt, invokeOllamaHttpPrompt, invokeOllamaStreamingPrompt, fetchOllamaTags,
  summarizeOllamaFailure, probeOllamaBinary,
  parseAgentJsonResponse, extractCodeFence, extractJsonBlock,
  // Coaching
  loadAgentCoachingConfig, buildAgentCoachingBundle, resolveRunCoachingContext,
  buildAgentCoachingMarkdown, buildAgentCoachingPromptSection,
  scoreCoachingProfile, selectFocusedProfiles, buildCoachingDocSnapshots,
  buildCoachingProfileKeywords,
  // Maintenance
  pruneOldLogs
};
