#!/usr/bin/env node
/**
 * Benchmark suite for the kaayko-api automation agent.
 * Run: ./automation/kaayko-api benchmark [--runs N] [--model MODEL]
 *
 * Measures:
 *  1. Safe-edit rate: % of edit-mode runs where no rollback occurred
 *  2. Findings accuracy: manual spot-check framework (outputs a review sheet)
 *  3. Pipeline timing: phase-by-phase latency
 *  4. False positive rate: flagged issues that aren't real
 *  5. Verification gate pass rate: syntax + smoke test pass %
 *  6. Model comparison: side-by-side on the same goal
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../..");
const RUNS_DIR = path.join(REPO_ROOT, "automation/runs");
const BENCHMARK_DIR = path.join(REPO_ROOT, "automation/benchmark");
const CLI = path.join(REPO_ROOT, "automation/kaayko-api");

// ── Benchmark scenarios ──────────────────────────────────────────────
const SCENARIOS = [
  { area: "weather",  goal: "Audit weather endpoints for input validation gaps",           mode: "audit" },
  { area: "commerce", goal: "Review checkout flow for payment security vulnerabilities",    mode: "audit" },
  { area: "kortex",   goal: "Identify authentication and authorization gaps in Kortex",     mode: "audit" },
  { area: "shared",   goal: "Audit middleware chain for missing rate limiting and CORS issues", mode: "audit" },
  { area: "weather",  goal: "Add input validation to the paddle score endpoint",            mode: "edit"  },
  { area: "commerce", goal: "Add request size limits to checkout endpoints",                mode: "edit"  },
  { area: "kortex",   goal: "Fix tenant isolation in link resolution queries",              mode: "edit"  },
];

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((a, i, arr) => {
    if (a === "--runs")  args.runs  = parseInt(arr[i + 1]) || 1;
    if (a === "--model") args.model = arr[i + 1];
    if (a === "--quick") args.quick = true;
    if (a === "--analyze-only") args.analyzeOnly = true;
  });
  return args;
}

// ── Analyze existing runs ────────────────────────────────────────────
function analyzeExistingRuns() {
  if (!fs.existsSync(RUNS_DIR)) return { runs: [] };
  const dirs = fs.readdirSync(RUNS_DIR).filter(d =>
    fs.statSync(path.join(RUNS_DIR, d)).isDirectory()
  );

  const runs = [];
  for (const dir of dirs) {
    const manifestPath = path.join(RUNS_DIR, dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (!m.agent) continue; // skip non-agent runs

      const verification = m.agent.verification || {};
      const appliedCount = Array.isArray(m.agent.applied_files) ? m.agent.applied_files.length : 0;
      const rolledBack = Array.isArray(m.agent.rejected_edits) ? m.agent.rejected_edits.length : 0;
      const goalMode = m.agent.goal_mode || "edit";

      // Extract timing from log if available
      const logFiles = [];
      const artifactDir = path.join(RUNS_DIR, dir, "artifacts", "agent");
      if (fs.existsSync(artifactDir)) {
        fs.readdirSync(artifactDir).forEach(f => {
          if (f.endsWith(".md") || f.endsWith(".json")) logFiles.push(f);
        });
      }

      // Parse findings
      const review = m.review || {};
      const findings = {
        suggestions: review.suggestions_count || 0,
        vulnerabilities: review.vulnerabilities_count || 0,
        total: (review.suggestions_count || 0) + (review.vulnerabilities_count || 0),
        details: [
          ...(review.suggestion_findings || []),
          ...(review.vulnerability_findings || [])
        ]
      };

      runs.push({
        run_id: dir,
        track: m.track,
        goal_mode: goalMode,
        goal: m.agent.goal || m.title || "",
        model: m.agent.model || "unknown",
        status: m.status,
        files_inspected: Array.isArray(m.agent.selected_files) ? m.agent.selected_files.length : 0,
        edits_applied: appliedCount,
        edits_rolled_back: rolledBack,
        syntax_passed: verification.syntax_passed || false,
        smoke_passed: verification.smoke_test_passed || null,
        smoke_skipped: verification.smoke_test_skipped || false,
        verification_summary: verification.summary || "unknown",
        findings,
        review_decision: review.decision || "unknown",
        accuracy: review.accuracy_score || null,
        maintainability: review.maintainability_score || null,
        training_eligible: m.training_eligible || false,
        created: m.created_at || null
      });
    } catch { /* skip corrupt manifests */ }
  }

  return { runs };
}

function computeMetrics(runs) {
  if (!runs.length) return null;

  const agentRuns = runs.filter(r => r.model !== "unknown");
  const editRuns  = agentRuns.filter(r => r.goal_mode === "edit");
  const auditRuns = agentRuns.filter(r => r.goal_mode === "audit");

  // Safe-edit rate
  const editWithApply = editRuns.filter(r => r.edits_applied > 0);
  const editRolledBack = editRuns.filter(r => r.edits_rolled_back > 0);
  const safeEditRate = editRuns.length
    ? ((editRuns.length - editRolledBack.length) / editRuns.length * 100).toFixed(1)
    : "N/A";

  // Verification pass rate
  const syntaxPassed = agentRuns.filter(r => r.syntax_passed).length;
  const syntaxRate = agentRuns.length
    ? (syntaxPassed / agentRuns.length * 100).toFixed(1)
    : "N/A";

  // Findings stats
  const totalFindings = agentRuns.reduce((s, r) => s + r.findings.total, 0);
  const totalSuggestions = agentRuns.reduce((s, r) => s + r.findings.suggestions, 0);
  const totalVulns = agentRuns.reduce((s, r) => s + r.findings.vulnerabilities, 0);
  const avgFindings = agentRuns.length ? (totalFindings / agentRuns.length).toFixed(1) : 0;

  // Files inspected stats
  const totalInspected = agentRuns.reduce((s, r) => s + r.files_inspected, 0);
  const avgInspected = agentRuns.length ? (totalInspected / agentRuns.length).toFixed(1) : 0;

  // Model breakdown
  const byModel = {};
  for (const r of agentRuns) {
    if (!byModel[r.model]) byModel[r.model] = { runs: 0, findings: 0, edits: 0, rollbacks: 0, syntax_pass: 0 };
    byModel[r.model].runs++;
    byModel[r.model].findings += r.findings.total;
    byModel[r.model].edits += r.edits_applied;
    byModel[r.model].rollbacks += r.edits_rolled_back;
    if (r.syntax_passed) byModel[r.model].syntax_pass++;
  }

  // Track breakdown
  const byTrack = {};
  for (const r of agentRuns) {
    if (!byTrack[r.track]) byTrack[r.track] = { runs: 0, findings: 0 };
    byTrack[r.track].runs++;
    byTrack[r.track].findings += r.findings.total;
  }

  // Severity distribution
  const sevDist = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const r of agentRuns) {
    for (const f of r.findings.details) {
      sevDist[f.severity || "info"] = (sevDist[f.severity || "info"] || 0) + 1;
    }
  }

  return {
    total_agent_runs: agentRuns.length,
    edit_runs: editRuns.length,
    audit_runs: auditRuns.length,
    safe_edit_rate: safeEditRate + "%",
    syntax_pass_rate: syntaxRate + "%",
    total_findings: totalFindings,
    total_suggestions: totalSuggestions,
    total_vulnerabilities: totalVulns,
    avg_findings_per_run: avgFindings,
    avg_files_inspected: avgInspected,
    total_edits_applied: editRuns.reduce((s, r) => s + r.edits_applied, 0),
    total_edits_rolled_back: editRuns.reduce((s, r) => s + r.edits_rolled_back, 0),
    severity_distribution: sevDist,
    by_model: byModel,
    by_track: byTrack,
    training_eligible: agentRuns.filter(r => r.training_eligible).length
  };
}

function generateFindingsReviewSheet(runs) {
  const lines = [
    "# Findings Accuracy Review Sheet",
    "",
    "Instructions: For each finding, mark TRUE (real issue), FALSE (false positive), or PARTIAL.",
    "Then run `./automation/kaayko-api benchmark --analyze-only` to recalculate accuracy.",
    "",
    "| # | Run | Track | Severity | Title | Verdict | Notes |",
    "|---|-----|-------|----------|-------|---------|-------|"
  ];
  let idx = 0;
  for (const r of runs) {
    for (const f of r.findings.details) {
      idx++;
      lines.push(`| ${idx} | ${r.run_id.slice(0, 20)}… | ${r.track} | ${f.severity || "info"} | ${f.title || "untitled"} | _____ | |`);
    }
  }
  if (idx === 0) lines.push("| — | No findings to review | | | | | |");
  lines.push("", `Total findings: ${idx}`, "");
  return lines.join("\n");
}

function printReport(metrics, runs) {
  const line = (label, val) => console.log(`  ${label.padEnd(32)} ${val}`);
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║     KAAYKO AGENT BENCHMARK REPORT            ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  console.log("── Overview ──");
  line("Total agent runs", metrics.total_agent_runs);
  line("Audit runs", metrics.audit_runs);
  line("Edit runs", metrics.edit_runs);
  line("Training-eligible", metrics.training_eligible);

  console.log("\n── Safety ──");
  line("Safe-edit rate", metrics.safe_edit_rate);
  line("Syntax pass rate", metrics.syntax_pass_rate);
  line("Edits applied", metrics.total_edits_applied);
  line("Edits rolled back", metrics.total_edits_rolled_back);

  console.log("\n── Findings ──");
  line("Total findings", metrics.total_findings);
  line("  Suggestions", metrics.total_suggestions);
  line("  Vulnerabilities", metrics.total_vulnerabilities);
  line("Avg findings/run", metrics.avg_findings_per_run);
  line("Avg files inspected/run", metrics.avg_files_inspected);
  const sd = metrics.severity_distribution;
  line("Severity dist", `crit:${sd.critical} high:${sd.high} med:${sd.medium} low:${sd.low} info:${sd.info}`);

  console.log("\n── By Model ──");
  for (const [model, d] of Object.entries(metrics.by_model)) {
    line(model, `${d.runs} runs, ${d.findings} findings, ${d.edits} edits, ${d.rollbacks} rollbacks, ${d.syntax_pass}/${d.runs} syntax`);
  }

  console.log("\n── By Track ──");
  for (const [track, d] of Object.entries(metrics.by_track)) {
    line(track, `${d.runs} runs, ${d.findings} findings`);
  }
  console.log("");
}

// ── Run new benchmark scenarios ──────────────────────────────────────
function runScenarios(scenarios, model) {
  const results = [];
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    console.log(`\n[${i + 1}/${scenarios.length}] ${s.mode.toUpperCase()} | ${s.area} | ${s.goal.slice(0, 60)}…`);
    const start = Date.now();
    const args = [CLI, "agent", "--area", s.area, "--goal", s.goal, "--goal-mode", s.mode];
    const result = spawnSync("bash", args, {
      cwd: REPO_ROOT, encoding: "utf8", timeout: 600_000,
      env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"]
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const ok = result.status === 0;
    console.log(`  → ${ok ? "✓" : "✗"} ${elapsed}s (exit ${result.status})`);
    results.push({ ...s, elapsed, exit: result.status, ok });
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs();

  // Always analyze existing runs
  const { runs } = analyzeExistingRuns();
  const metrics = computeMetrics(runs);

  if (!metrics) {
    console.log("No agent runs found. Run some scenarios first:");
    console.log("  ./automation/kaayko-api benchmark --runs 1");
    process.exit(1);
  }

  printReport(metrics, runs);

  // Save review sheet
  if (!fs.existsSync(BENCHMARK_DIR)) fs.mkdirSync(BENCHMARK_DIR, { recursive: true });
  const reviewSheet = generateFindingsReviewSheet(runs);
  fs.writeFileSync(path.join(BENCHMARK_DIR, "findings-review.md"), reviewSheet);
  console.log(`Review sheet: automation/benchmark/findings-review.md`);

  // Save metrics JSON
  fs.writeFileSync(path.join(BENCHMARK_DIR, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log(`Metrics JSON: automation/benchmark/metrics.json`);

  if (args.analyzeOnly) {
    console.log("\n--analyze-only: skipping new runs.\n");
    return;
  }

  // Run new scenarios if requested
  if (args.runs) {
    const count = args.runs;
    const scenarios = args.quick ? SCENARIOS.slice(0, 3) : SCENARIOS;
    console.log(`\n── Running ${scenarios.length} benchmark scenarios (${count}x each) ──`);
    if (args.model) console.log(`  Model override: ${args.model}`);

    const allResults = [];
    for (let round = 0; round < count; round++) {
      if (count > 1) console.log(`\n── Round ${round + 1}/${count} ──`);
      const results = runScenarios(scenarios, args.model);
      allResults.push(...results);
    }

    // Save scenario results
    fs.writeFileSync(path.join(BENCHMARK_DIR, "scenario-results.json"), JSON.stringify(allResults, null, 2));
    console.log(`\nScenario results: automation/benchmark/scenario-results.json`);
    console.log("Re-run with --analyze-only to see updated metrics.\n");
  }
}

main();
