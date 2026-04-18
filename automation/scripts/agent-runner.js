/**
 * agent-runner.js — Orchestrates the complete agent lifecycle for kaayko-api.
 *
 * Phases:
 * 1. PLAN — collect candidate files, detect goal mode (audit vs edit)
 * 2. SELECT — model picks files to inspect (dynamic limits based on mode)
 * 3. LOAD — read file contents with smart truncation
 * 4. ANALYZE — model produces findings (audit mode) or findings + edits (edit mode)
 * 5. VERIFY — apply edits (if edit mode), run syntax/lint checks, generate verification report
 * 6. GATE — require user approval via diff → approve/reject before anything is committed
 */

const path = require("path");
const os = require("os");
const agentFiles = require("./agent-files");
const agentPrompts = require("./agent-prompts");
const agentVerify = require("./agent-verify");

// ── Progress Display Helpers ────────────────────────────────────

const PHASE_ICONS = ["📂", "🔍", "📄", "🧠", "🔧", "📋"];
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";

function phaseHeader(n, total, label, detail) {
  const icon = PHASE_ICONS[n - 1] || "▸";
  const line = `  ${icon} [${n}/${total}] ${BOLD}${label}${RESET}`;
  console.log(line);
  if (detail) console.log(`    ${DIM}${detail}${RESET}`);
}

function phaseResult(text) {
  console.log(`    ${GREEN}→${RESET} ${text}`);
}

function phaseDetail(text) {
  console.log(`    ${DIM}${text}${RESET}`);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function missionBanner(manifest, args, runtime, goalMode) {
  const memFree = (os.freemem() / (1024 ** 3)).toFixed(1);
  const cpus = os.cpus().length;
  console.log();
  console.log(`  ${BOLD}╔══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`  ${BOLD}║${RESET}  ${CYAN}AGENT MISSION${RESET}                                      ${BOLD}║${RESET}`);
  console.log(`  ${BOLD}╠══════════════════════════════════════════════════════╣${RESET}`);
  console.log(`  ${BOLD}║${RESET}  Track:  ${manifest.track || args.area}${" ".repeat(Math.max(0, 42 - (manifest.track || args.area || "").length))}${BOLD}║${RESET}`);
  console.log(`  ${BOLD}║${RESET}  Mode:   ${goalMode}${" ".repeat(Math.max(0, 42 - goalMode.length))}${BOLD}║${RESET}`);
  console.log(`  ${BOLD}║${RESET}  Model:  ${runtime.model || "?"}${" ".repeat(Math.max(0, 42 - (runtime.model || "?").length))}${BOLD}║${RESET}`);
  console.log(`  ${BOLD}║${RESET}  System: ${cpus} cores · ${memFree}GB free${" ".repeat(Math.max(0, 42 - `${cpus} cores · ${memFree}GB free`.length))}${BOLD}║${RESET}`);
  console.log(`  ${BOLD}╚══════════════════════════════════════════════════════╝${RESET}`);
  console.log();
}

function missionSummary(timings, goalMode, findings, editsApplied, editsRejected) {
  const totalSec = Object.values(timings).reduce((a, b) => a + b, 0);
  console.log();
  console.log(`  ${BOLD}── Mission Complete ─────────────────────────────────${RESET}`);
  console.log(`  ${DIM}Total: ${totalSec.toFixed(1)}s${RESET}`);
  console.log();
  const phases = ["Collect", "Select", "Load", "Analyze", "Verify", "Report"];
  const maxLabel = Math.max(...phases.map((p) => p.length));
  const maxTime = Math.max(...Object.values(timings));
  for (let i = 0; i < phases.length; i++) {
    const key = phases[i].toLowerCase();
    const sec = timings[key] || 0;
    const barLen = maxTime > 0 ? Math.round((sec / maxTime) * 30) : 0;
    const bar = "█".repeat(barLen) + "░".repeat(30 - barLen);
    const pct = totalSec > 0 ? ((sec / totalSec) * 100).toFixed(0) : 0;
    console.log(`  ${PHASE_ICONS[i]} ${phases[i].padEnd(maxLabel)} ${CYAN}${bar}${RESET} ${sec.toFixed(1)}s ${DIM}(${pct}%)${RESET}`);
  }
  console.log();
  if (findings > 0) {
    console.log(`  ${YELLOW}⚑${RESET} ${findings} finding${findings === 1 ? "" : "s"} discovered`);
  }
  if (editsApplied > 0) {
    console.log(`  ${GREEN}✓${RESET} ${editsApplied} edit${editsApplied === 1 ? "" : "s"} applied`);
  }
  if (editsRejected > 0) {
    console.log(`  ${YELLOW}✗${RESET} ${editsRejected} edit${editsRejected === 1 ? "" : "s"} rejected`);
  }
  console.log();
}

/**
 * Execute the full local model agent pipeline.
 */
function executeLocalModelAgent(config, runtimeConfig, runDir, manifest, args, helpers) {
  const {
    ensureDir, writeText, writeJson, loadJson, updateRunManifest, relativeToRepo,
    resolvePrefixedPath, resolveAgentRoots, slugify,
    buildAgentCoachingBundle, buildAgentCoachingMarkdown, buildAgentCoachingPromptSection,
    resolveRunCoachingContext, invokeOllamaPrompt, parseAgentJsonResponse, REPO_ROOT
  } = helpers;

  const agentDir = path.join(runDir, "artifacts", "agent");
  const backupsDir = path.join(agentDir, "backups");
  const runtime = runtimeConfig.local_model_runtime || {};

  const explicitMode = args["goal-mode"];
  const goalMode = (explicitMode === "audit" || explicitMode === "edit") ? explicitMode : agentFiles.detectGoalMode(args.goal);

  // Artifact paths
  const inventoryPath = path.join(agentDir, "inventory.json");
  const inventoryPromptPath = path.join(agentDir, "inventory-prompt.md");
  const inventoryRawPath = path.join(agentDir, "inventory-response.raw.txt");
  const inventoryJsonPath = path.join(agentDir, "inventory-response.json");
  const selectedPath = path.join(agentDir, "selected-files.json");
  const analysisPromptPath = path.join(agentDir, "analysis-prompt.md");
  const analysisRawPath = path.join(agentDir, "analysis-response.raw.txt");
  const analysisJsonPath = path.join(agentDir, "analysis-response.json");
  const analysisMarkdownPath = path.join(runDir, "notes", "agent-analysis.md");
  const verificationPath = path.join(runDir, "notes", "verification-report.md");

  ensureDir(agentDir);
  ensureDir(backupsDir);

  const coachingBundle = buildAgentCoachingBundle(manifest.track, args.area, args.goal);
  writeText(path.join(runDir, "notes", "agent-briefing.md"), buildAgentCoachingMarkdown(coachingBundle, args));

  // ──────────────── PHASE 1: COLLECT CANDIDATES ────────────────

  process.stdout.write("  [1/6] Collecting candidate files...");
  const inventory = agentFiles.collectAgentCandidateFiles(config, manifest, args.area, args.goal, coachingBundle, {
    resolveAgentRoots, REPO_ROOT
  });
  writeJson(inventoryPath, { generated_at: new Date().toISOString(), goal_mode: goalMode, files: inventory });
  console.log(` ${inventory.length} candidates`);

  updateRunManifest(runDir, (m) => {
    m.status = "agent_selecting";
    m.agent = {
      ...(m.agent || {}),
      stage: "selecting",
      goal_mode: goalMode,
      inventory_candidates: inventory.length
    };
    m.artifacts.agent_inventory_path = relativeToRepo(inventoryPath);
    return m;
  });

  // ──────────────── PHASE 2: MODEL SELECTS FILES ────────────────

  process.stdout.write("  [2/6] Model selecting files...");
  const inventoryPrompt = agentPrompts.buildAgentInventoryPrompt(manifest, args, inventory, coachingBundle, goalMode, {
    buildAgentCoachingPromptSection
  });
  writeText(inventoryPromptPath, inventoryPrompt);
  const t2 = Date.now();
  const inventoryRaw = invokeOllamaPrompt(runtime, inventoryPrompt, "inventory selection");
  console.log(` done (${((Date.now() - t2) / 1000).toFixed(1)}s)`);
  writeText(inventoryRawPath, inventoryRaw);
  const inventoryResponse = parseAgentJsonResponse(inventoryRaw, "inventory selection");
  writeJson(inventoryJsonPath, inventoryResponse);

  // ──────────────── PHASE 3: LOAD FILE CONTENTS ────────────────

  process.stdout.write("  [3/6] Loading selected files...");
  const selectedFilesList = agentFiles.chooseAgentSelectedFiles(inventory, inventoryResponse, goalMode);
  const selectedFilePayload = selectedFilesList.map((candidate) =>
    agentFiles.loadAgentFilePayload(candidate, {
      goalMode,
      maxChars: runtime.analysis_max_file_chars || null,
      helpers: { resolvePrefixedPath }
    })
  );

  const analysisCoachingBundle = buildAgentCoachingBundle(manifest.track, args.area, args.goal, {
    filePaths: selectedFilePayload.map((item) => item.path)
  });
  writeJson(selectedPath, { selected_files: selectedFilePayload.map(agentFiles.serializeAgentFilePayload) });
  writeText(path.join(runDir, "notes", "agent-briefing.md"), buildAgentCoachingMarkdown(analysisCoachingBundle, args));
  console.log(` ${selectedFilePayload.length} files loaded`);

  updateRunManifest(runDir, (m) => {
    m.status = "agent_analyzing";
    m.agent = {
      ...(m.agent || {}),
      stage: "analyzing",
      goal_mode: goalMode,
      selected_files: selectedFilePayload.map((item) => item.path)
    };
    m.coaching = {
      ...(m.coaching || {}),
      profile_ids: analysisCoachingBundle.profile_ids,
      guided_products: analysisCoachingBundle.guided_products,
      focused_profile_ids: analysisCoachingBundle.focused_profile_ids,
      focused_products: analysisCoachingBundle.focused_products,
      source_docs: analysisCoachingBundle.source_docs,
      focused_source_docs: analysisCoachingBundle.focused_source_docs,
      validation_focus: analysisCoachingBundle.validation_focus,
      risk_focus: analysisCoachingBundle.risk_focus,
      route_focus: analysisCoachingBundle.route_focus
    };
    m.artifacts.agent_selected_files_path = relativeToRepo(selectedPath);
    return m;
  });

  // ──────────────── PHASE 4: MODEL ANALYZES ────────────────

  process.stdout.write("  [4/6] Model analyzing (this may take a few minutes)...");
  const analysisPrompt = agentPrompts.buildAgentAnalysisPrompt(manifest, args, selectedFilePayload, analysisCoachingBundle, goalMode, {
    buildAgentCoachingPromptSection
  });
  writeText(analysisPromptPath, analysisPrompt);
  const t4 = Date.now();
  const analysisRaw = invokeOllamaPrompt(runtime, analysisPrompt, "agent analysis");
  console.log(` done (${((Date.now() - t4) / 1000).toFixed(1)}s)`);
  writeText(analysisRawPath, analysisRaw);
  const analysisResponse = parseAgentJsonResponse(analysisRaw, "agent analysis");
  const normalizedAnalysis = normalizeAgentAnalysis(analysisResponse, selectedFilePayload, goalMode);
  writeJson(analysisJsonPath, normalizedAnalysis);

  // ──────────────── PHASE 5: VERIFY & APPLY (edit mode only) ────────────────

  let appliedEdits = [];
  let rejectedEdits = [];
  let verification = {
    summary: "no_edits",
    syntax_check: { passed: true, details: [] },
    lint_check: { passed: true, details: [], skipped: true },
    smoke_test: { passed: true, details: [], skipped: true }
  };

  if (goalMode === "edit" && args.apply === "safe" && normalizedAnalysis.safe_edits.length) {
    console.log(`  [5/6] Applying ${normalizedAnalysis.safe_edits.length} safe edits...`);
    updateRunManifest(runDir, (m) => {
      m.status = "agent_applying";
      m.agent = { ...(m.agent || {}), stage: "applying" };
      return m;
    });

    const result = agentVerify.applyAndVerifyEdits(config, runDir, selectedFilePayload, normalizedAnalysis.safe_edits, backupsDir, {
      helpers: { resolvePrefixedPath, slugify, REPO_ROOT }
    });
    appliedEdits = result.applied;
    rejectedEdits = result.rejected;
    verification = result.verification;

    // If syntax failed, auto-rollback all applied edits
    if (verification.summary === "syntax_failed") {
      appliedEdits.forEach((edit) => {
        const backupContent = require("fs").readFileSync(edit.backup_path, "utf8");
        require("fs").writeFileSync(edit.absolute_path, backupContent);
      });
      rejectedEdits.push(...appliedEdits.map((e) => ({ path: e.path, reason: "Auto-rolled back due to syntax failure" })));
      appliedEdits = [];
    }
  }

  // ──────────────── PHASE 6: WRITE REPORTS ────────────────

  console.log("  [6/6] Writing reports...");

  const analysisManifest = loadJson(path.join(runDir, "manifest.json"));
  const analysisMarkdown = agentPrompts.buildAgentAnalysisMarkdown(
    analysisManifest, args, normalizedAnalysis, selectedFilePayload,
    appliedEdits, rejectedEdits, goalMode,
    { resolveRunCoachingContext }
  );
  writeText(analysisMarkdownPath, analysisMarkdown);

  const verificationReport = agentVerify.buildVerificationReport(
    manifest.run_id, appliedEdits, rejectedEdits, verification
  );
  writeText(verificationPath, verificationReport);

  let finalStatus;
  if (goalMode === "audit") {
    finalStatus = "agent_analyzed";
  } else if (appliedEdits.length) {
    finalStatus = "pending_review";
  } else {
    finalStatus = "agent_analyzed";
  }

  updateRunManifest(runDir, (m) => {
    m.status = finalStatus;
    m.agent = {
      ...(m.agent || {}),
      stage: "completed",
      goal_mode: goalMode,
      summary: normalizedAnalysis.summary,
      findings_count: normalizedAnalysis.findings.length,
      applied_files: appliedEdits.map((item) => item.path),
      applied_edits_detail: appliedEdits.map((item) => ({
        path: item.path,
        absolute_path: item.absolute_path,
        summary: item.summary || "",
        confidence: item.confidence || "medium",
        backup_name: path.basename(item.backup_path)
      })),
      rejected_edits: rejectedEdits,
      verification: {
        summary: verification.summary,
        syntax_passed: verification.syntax_check.passed,
        lint_passed: verification.lint_check.passed,
        lint_skipped: verification.lint_check.skipped,
        smoke_test_passed: verification.smoke_test.passed,
        smoke_test_skipped: verification.smoke_test.skipped
      },
      completed_at: new Date().toISOString()
    };
    m.artifacts.agent_prompt_path = relativeToRepo(analysisPromptPath);
    m.artifacts.agent_response_path = relativeToRepo(analysisJsonPath);
    m.artifacts.agent_analysis_path = relativeToRepo(analysisMarkdownPath);
    m.artifacts.verification_report_path = relativeToRepo(verificationPath);
    return m;
  });

  return {
    goal_mode: goalMode,
    inventory,
    inventory_response: inventoryResponse,
    selected_files: selectedFilePayload,
    analysis: normalizedAnalysis,
    applied_edits: appliedEdits,
    rejected_edits: rejectedEdits,
    verification,
    artifacts: {
      inventory: relativeToRepo(inventoryPath),
      selected: relativeToRepo(selectedPath),
      analysis: relativeToRepo(analysisJsonPath),
      analysis_markdown: relativeToRepo(analysisMarkdownPath),
      verification_report: relativeToRepo(verificationPath)
    }
  };
}

/**
 * Normalize analysis response from the model.
 * Handles both audit and edit response shapes for the API context.
 */
function normalizeAgentAnalysis(response, selectedFiles, goalMode) {
  const selectedPaths = new Set(selectedFiles.map((file) => file.path));

  const findings = Array.isArray(response.findings)
    ? response.findings
        .map((finding) => ({
          severity: ["low", "medium", "high"].includes(String(finding.severity || "").toLowerCase())
            ? String(finding.severity).toLowerCase()
            : "medium",
          status: "open",
          title: String(finding.title || "Agent finding").trim(),
          detail: String(finding.detail || "").trim(),
          category: String(finding.category || "maintainability").trim(),
          file_paths: Array.isArray(finding.file_paths) ? finding.file_paths.filter((item) => selectedPaths.has(item)) : []
        }))
        .filter((finding) => finding.title && finding.detail)
    : [];

  const base = {
    summary: String(response.summary || "").trim(),
    insights: Array.isArray(response.insights) ? response.insights.map((item) => String(item).trim()).filter(Boolean) : [],
    findings,
    followups: Array.isArray(response.followups) ? response.followups.map((item) => String(item).trim()).filter(Boolean) : []
  };

  if (goalMode === "audit") {
    base.endpoint_inventory = Array.isArray(response.endpoint_inventory)
      ? response.endpoint_inventory.map((e) => ({
          method: String(e.method || "").trim(),
          path: String(e.path || "").trim(),
          file: String(e.file || "").trim(),
          auth: String(e.auth || "none").trim(),
          middleware: Array.isArray(e.middleware) ? e.middleware : [],
          description: String(e.description || "").trim()
        }))
      : [];
    base.auth_audit = Array.isArray(response.auth_audit)
      ? response.auth_audit.map((a) => ({
          file: String(a.file || "").trim(),
          pattern: String(a.pattern || "").trim(),
          gaps: Array.isArray(a.gaps) ? a.gaps : [],
          risk_level: String(a.risk_level || "medium").trim()
        }))
      : [];
    base.duplicated_patterns = Array.isArray(response.duplicated_patterns)
      ? response.duplicated_patterns.map((d) => ({
          pattern: String(d.pattern || "").trim(),
          files: Array.isArray(d.files) ? d.files : [],
          severity: String(d.severity || "medium").trim(),
          recommendation: String(d.recommendation || "").trim()
        }))
      : [];
    base.dependency_map = Array.isArray(response.dependency_map)
      ? response.dependency_map.map((d) => ({
          file: String(d.file || "").trim(),
          imports: Array.isArray(d.imports) ? d.imports : [],
          exports: Array.isArray(d.exports) ? d.exports : [],
          used_by: Array.isArray(d.used_by) ? d.used_by : []
        }))
      : [];
    base.safe_edits = [];
  } else {
    base.safe_edits = Array.isArray(response.safe_edits)
      ? response.safe_edits
          .map((edit) => ({
            path: String(edit.path || "").trim(),
            kind: String(edit.kind || "rewrite").trim(),
            summary: String(edit.summary || "").trim(),
            confidence: Number(edit.confidence || 0),
            content: typeof edit.content === "string" ? edit.content : ""
          }))
          .filter((edit) => selectedPaths.has(edit.path) && edit.kind === "rewrite" && edit.content.trim())
          .slice(0, 2)
      : [];
  }

  return base;
}

module.exports = {
  executeLocalModelAgent,
  normalizeAgentAnalysis
};
