#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const h = require("./loop-helpers");
const dashboard = require("./loop-dashboard");
const agentRunner = require("./agent-runner");
const agentFilesModule = require("./agent-files");
const agentVerifyModule = require("./agent-verify");
const agentPromptsModule = require("./agent-prompts");
const ollamaClient = require("./ollama-client");
const resourceGovernor = require("./resource-governor");
const findingIntelligence = require("./finding-intelligence");
const pipelineQueue = require("./pipeline-queue");
const scout = require("./scout");

// ── CLI Entry ───────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { args[key] = next; i++; }
      else { args[key] = true; }
    } else {
      positional.push(arg);
    }
  }
  args._positional = positional;
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = args._positional[0] || "help";

  h.ensureAutomationDirs();
  const config = h.loadJson(h.CONFIG_PATH);
  const runtimeConfig = h.loadOptionalJson(h.RUNTIME_CONFIG_PATH, {
    review_engine: { mode: "manual" },
    local_model_runtime: {}
  });

  try {
    switch (command) {
      case "help": printHelp(); break;
      case "console": printConsole(config, runtimeConfig); break;
      case "settings": printSettings(config, runtimeConfig); break;
      case "status": printStatus(config, args); break;
      case "model": handleModelCommand(config, runtimeConfig, args); break;
      case "doctor": runDoctor(config, runtimeConfig); break;
      case "benchmark": {
        const bp = path.join(__dirname, "benchmark.js");
        const ba = process.argv.slice(3).join(" ");
        require("child_process").execSync(`node "${bp}" ${ba}`, { cwd: h.REPO_ROOT, stdio: "inherit" });
        break;
      }
      case "init": {
        const run = initRun(config, runtimeConfig, args);
        console.log(`Run initialized: ${run.manifest.run_id}`);
        break;
      }
      case "pipeline": await pipelineRun(config, runtimeConfig, args); break;
      case "agent": await runAgent(config, runtimeConfig, args); break;
      case "mission": await runMission(config, runtimeConfig, args); break;
      case "capture": captureRun(config, args); break;
      case "review": reviewRun(config, args); break;
      case "publish": publishRun(config, args); break;
      case "reconcile": reconcileRuns(config, args); break;
      case "auto-review": applyAutoReview(config, runtimeConfig, args); break;
      case "dashboard": dashboard.generateDashboard(config, args); break;
      case "export": exportDatasets(config, args); break;
      case "enqueue": enqueueTask(config, args); break;
      case "worker": await runWorker(config, runtimeConfig, args); break;
      case "scout": handleScoutCommand(config, runtimeConfig, args); break;
      case "diff": handleDiffCommand(config, args); break;
      case "approve": handleApproveCommand(config, args); break;
      case "reject": handleRejectCommand(config, args); break;
      case "rollback": handleRollbackCommand(config, args); break;
      case "prune": handlePruneCommand(config, args); break;
      case "knowledge": handleKnowledgeCommand(config, args); break;
      case "serve": handleServeCommand(config, runtimeConfig, args); break;
      default:
        console.error(`Unknown command: ${command}. Run \`kaayko-api help\` for usage.`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`\n\u274c ${error.message}`);
    if (args.verbose) console.error(error.stack);
    process.exit(1);
  }
}

// ── Help / Console / Settings ───────────────────────────────────

function printHelp() {
  console.log(`
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 KAAYKO API  \u2022  COMMAND REFERENCE
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  ./automation/kaayko-api <command> [options]

AGENT COMMANDS (model-driven)
  agent     --area <area> --goal <goal>   Run a local-model agent mission
  mission   --area <area> --goal <goal>   Alias for agent
  pipeline  --track <t> --idea <i>        Full pipeline: init \u2192 capture \u2192 review \u2192 publish

RUN LIFECYCLE
  init      --track <t> --idea <i> [--title <t>]   Create a new run shell
  capture   [--run <id>]                            Capture git state
  review    [--run <id>]                            Validate review.json
  publish   [--run <id>]                            Publish to datasets

REVIEW WORKFLOW
  auto-review  [--run <id>]    Generate review from quality gate results
  diff         [--run <id>]    Show changes in the latest or specified run
  approve      [--run <id>] [--force]  Approve run and export training data
  reject       [--run <id>]    Reject run and restore backups
  rollback     [--run <id>]    Rollback an approved run

QUEUE / BATCH
  enqueue   --track <t> --idea <i> --goal <g>   Add a task to the queue
  worker    [--limit <n>]                        Process queued tasks

DASHBOARD / KNOWLEDGE
  dashboard                        Regenerate the dashboard
  knowledge [--area <a>]           Build knowledge graph for an area
  serve     [--port <p>]           Start the local control server
  export    [--format jsonl|json]  Export training datasets

INFO / DEBUG
  help         Show this help text
  console      Print system & loop status
  settings     Show active configuration
  status       Print status of a specific run
  doctor       Health-check the system
  model use <m>           Set the active model
  model mode <m>          Set the engine mode (manual|ollama)
  model list              List available models
  prune [--dry-run]       Remove stale runs

AREAS
  weather \u00b7 commerce \u00b7 kortex \u00b7 kreator \u00b7 kamera \u00b7 kutz \u00b7 shared

FLAGS
  --verbose         Show stack traces on error
  --interactive     Confirm before applying edits
  --apply none      Dry-run mode (no file writes)
  --apply safe      Apply only safe edits (default)
  --apply all       Apply all edits (risky)
  --silent          Suppress non-error output
  --full            Show full diff output
  --run <id>        Target a specific run (default: latest)
`);
}

function printConsole(config, runtimeConfig) {
  const runtime = runtimeConfig.local_model_runtime || {};
  const manifests = h.listRunManifests();
  const latestRun = manifests.length ? manifests[manifests.length - 1] : null;
  const approvedCount = manifests.filter(({ manifest }) => manifest.status === "reviewed").length;
  const agentCount = manifests.filter(({ manifest }) => manifest.source === "agent").length;
  const queued = h.queueStatusCounts();

  console.log(`
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 KAAYKO API  \u2022  AUTOMATION CONSOLE
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  Repo:     ${h.REPO_ROOT}
  Config:   ${h.relativeToRepo(h.CONFIG_PATH)}
  Runtime:  ${h.relativeToRepo(h.RUNTIME_CONFIG_PATH)}
  Runs:     ${h.relativeToRepo(h.RUNS_ROOT)}

ENGINE
  Mode:     ${runtimeConfig.review_engine?.mode || "manual"}
  Provider: ${runtime.provider || "unknown"}
  Model:    ${runtime.model || "unset"}
  Endpoint: ${runtime.base_url || "not configured"}

REPO
  Path:     ${h.REPO_ROOT}
  Role:     api (single-repo)

MODULES
  \ud83c\udf0a Weather    \u2502 forecast, paddle score, nearby water, cache
  \ud83d\uded2 Commerce   \u2502 products, checkout, payments, Stripe
  \ud83d\udd17 Kortex     \u2502 smart links, tenant auth, billing, analytics
  \ud83c\udfa8 Kreator    \u2502 creator onboarding, admin review
  \ud83d\udcf7 Kamera     \u2502 camera catalog, lenses, presets
  \ud83c\udf4e Kutz       \u2502 nutrition, meals, food search, Fitbit
  \u2699\ufe0f  Shared     \u2502 middleware, auth, error handling, CORS

RUNS
  Total:    ${manifests.length}
  Approved: ${approvedCount}
  Agent:    ${agentCount}
  Latest:   ${latestRun ? latestRun.manifest.run_id : "none"}
  Status:   ${latestRun ? latestRun.manifest.status : "n/a"}

QUEUE
  Pending:    ${queued.pending}
  Processing: ${queued.processing}
  Done:       ${queued.done}
  Failed:     ${queued.failed}
`);
}

function printSettings(config, runtimeConfig) {
  const runtime = runtimeConfig.local_model_runtime || {};
  const roster = dashboard.buildModelRoster(runtimeConfig);

  console.log(`
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 KAAYKO API  \u2022  SETTINGS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

ENGINE
  Review mode:     ${runtimeConfig.review_engine?.mode || "manual"}
  Provider:        ${runtime.provider || "unknown"}
  Active model:    ${runtime.model || "unset"}
  Base URL:        ${runtime.base_url || "not configured"}
  Temperature:     ${runtime.temperature ?? "default"}
  Max tokens:      ${runtime.max_tokens ?? "default"}
  Timeout:         ${runtime.timeout_ms ?? "default"} ms
  CLI fallback:    ${runtime.allow_cli_fallback ?? false}

TRAINING POLICY
  Require gates:   ${config.training_policy.require_quality_gates_passed}
  Min accuracy:    ${config.training_policy.minimum_accuracy_score}
  Min maintain.:   ${config.training_policy.minimum_maintainability_score}
  Disqualifiers:   ${config.training_policy.disqualifying_open_severities.join(", ")}

TRACKS
${Object.entries(config.tracks).map(([id, t]) => `  ${id}: ${t.description}`).join("\n")}

MODEL ROSTER
${roster.length
    ? roster.map((m) => `  ${m.active ? "\u25b6" : " "} ${m.id} ${m.installed ? "\u2713" : "\u2717"} ${m.note}`).join("\n")
    : "  No models detected. Run: ollama pull qwen2.5-coder:14b"}
`);
}

function printStatus(config, args) {
  const { runDir, manifest } = h.loadRun(args.run);
  const reviewPath = path.join(runDir, "review", "review.json");
  const hasReview = fs.existsSync(reviewPath);
  const review = hasReview ? h.loadJson(reviewPath) : null;
  const metrics = h.computeRunMetrics(manifest);

  console.log(`
Run:       ${manifest.run_id}
Track:     ${manifest.track}
Area:      ${manifest.requested_area || manifest.track}
Status:    ${manifest.status}
Title:     ${manifest.title}
Source:    ${manifest.source || "manual"}
Created:   ${manifest.created_at}
Updated:   ${manifest.updated_at}

FILES
  Changed:     ${metrics.changed_files_count}
  Backend:     ${metrics.backend_files_changed}
  ML:          ${metrics.ml_files_changed}
  Meaningful:  ${metrics.meaningful_product_files_changed}
  Churn:       +${metrics.insertions} / -${metrics.deletions}

QUALITY GATES
${manifest.quality_gates.map((g) => `  ${g.status === "passed" ? "\u2705" : g.status === "blocked" ? "\u26d4" : "\u274c"} ${g.label}: ${g.status}`).join("\n")}
${review ? `
REVIEW
  Decision:       ${review.decision}
  Accuracy:       ${review.accuracy_score}
  Maintainability:${review.maintainability_score}
  Confidence:     ${review.confidence_score}
  Findings:       ${review.findings.length}
  Followups:      ${review.required_followups.length}
  Approved for training: ${review.training_labels.approved_for_training}
` : "\nREVIEW\n  Not yet reviewed."}
${manifest.agent ? `
AGENT
  Model:       ${manifest.agent.model || "heuristic"}
  Provider:    ${manifest.agent.provider || "unknown"}
  Goal mode:   ${manifest.agent.goal_mode || "edit"}
  Selected:    ${(manifest.agent.selected_files || []).length} files
  Applied:     ${(manifest.agent.applied_files || []).length} files
  Rejected:    ${(manifest.agent.rejected_edits || []).length} edits
  Summary:     ${manifest.agent.summary || "No summary."}
` : ""}
`);
}

function printResults(run, review) {
  const manifest = run.manifest;
  const metrics = h.computeRunMetrics(manifest);
  console.log(`
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 KAAYKO API  \u2022  RUN RESULTS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  Run:        ${manifest.run_id}
  Track:      ${manifest.track}
  Status:     ${manifest.status}
  Decision:   ${review.decision}
  Changed:    ${metrics.changed_files_count} files (+${metrics.insertions} / -${metrics.deletions})
  Meaningful: ${metrics.meaningful_backend_files_changed} backend files
  Accuracy:   ${review.accuracy_score}
  Maintain.:  ${review.maintainability_score}
  Findings:   ${review.findings.length}
  Followups:  ${review.required_followups.length}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`);
}

// ── Model Command ───────────────────────────────────────────────

function handleModelCommand(config, runtimeConfig, args) {
  const subCommand = args._positional[1];
  const value = args._positional[2];

  if (subCommand === "use" && value) {
    runtimeConfig.local_model_runtime = runtimeConfig.local_model_runtime || {};
    runtimeConfig.local_model_runtime.model = value;
    h.writeJson(h.RUNTIME_CONFIG_PATH, runtimeConfig);
    console.log(`Active model set to: ${value}`);
    return;
  }

  if (subCommand === "mode" && value) {
    runtimeConfig.review_engine = runtimeConfig.review_engine || {};
    runtimeConfig.review_engine.mode = value;
    h.writeJson(h.RUNTIME_CONFIG_PATH, runtimeConfig);
    console.log(`Engine mode set to: ${value}`);
    return;
  }

  if (subCommand === "list") {
    const roster = dashboard.buildModelRoster(runtimeConfig);
    if (!roster.length) {
      console.log("No models found. Install with: ollama pull qwen2.5-coder:14b");
      return;
    }
    console.log("\nAvailable Models:");
    roster.forEach((m) => {
      const tag = m.active ? " \u25b6 ACTIVE" : "";
      const status = m.installed ? "\u2713 installed" : "\u2717 not installed";
      console.log(`  ${m.id} — ${m.note || ""} [${status}] ${m.size || ""}${tag}`);
    });
    console.log("");
    return;
  }

  console.log("Usage:");
  console.log("  kaayko-api model use <model-id>     Set the active model");
  console.log("  kaayko-api model mode <mode>         Set engine mode (manual|ollama)");
  console.log("  kaayko-api model list                List available models");
}

// ── Doctor ──────────────────────────────────────────────────────

function runDoctor(config, runtimeConfig) {
  const runtime = runtimeConfig.local_model_runtime || {};
  const checks = [];

  // Check repo exists
  checks.push(h.makeCheck("API repo exists", fs.existsSync(h.REPO_ROOT), h.REPO_ROOT));
  checks.push(h.makeCheck("functions/ exists", fs.existsSync(path.join(h.REPO_ROOT, "functions")), "functions/"));
  checks.push(h.makeCheck("functions/package.json exists", fs.existsSync(path.join(h.REPO_ROOT, "functions", "package.json")), "functions/package.json"));

  // Config files
  checks.push(h.makeCheck("api-loop.json exists", fs.existsSync(h.CONFIG_PATH), h.relativeToRepo(h.CONFIG_PATH)));
  checks.push(h.makeCheck("runtime.json exists", fs.existsSync(h.RUNTIME_CONFIG_PATH), h.relativeToRepo(h.RUNTIME_CONFIG_PATH)));
  checks.push(h.makeCheck("api-coaching.json exists", fs.existsSync(h.AGENT_COACHING_PATH), h.relativeToRepo(h.AGENT_COACHING_PATH)));

  // Git
  const gitCheck = h.runShell("git rev-parse --is-inside-work-tree", h.REPO_ROOT);
  checks.push(h.makeCheck("Git initialized", gitCheck.exit_code === 0, h.REPO_ROOT));

  // Node
  const nodeCheck = h.whichBinary("node");
  checks.push(h.makeCheck("Node.js available", !!nodeCheck, nodeCheck || "not found"));

  // npm
  const npmCheck = h.whichBinary("npm");
  checks.push(h.makeCheck("npm available", !!npmCheck, npmCheck || "not found"));

  // Ollama
  const ollamaCheck = h.whichBinary("ollama");
  const ollamaBinaryHealth = ollamaCheck ? h.probeOllamaBinary(ollamaCheck, 3000) : { ok: false, detail: "not found" };
  checks.push(h.makeCheck("Ollama binary", !!ollamaCheck, ollamaCheck || "not found (optional if using HTTP)"));
  checks.push(h.makeCheck("Ollama binary healthy", ollamaBinaryHealth.ok, ollamaBinaryHealth.detail));

  // curl
  const curlCheck = h.whichBinary("curl");
  checks.push(h.makeCheck("curl available", !!curlCheck, curlCheck || "not found"));

  // Ollama HTTP
  if (runtime.base_url) {
    try {
      const tags = h.fetchOllamaTags(runtime, 3000);
      checks.push(h.makeCheck("Ollama runtime available", true, `${tags.length} models available at ${runtime.base_url}`));
    } catch (error) {
      const detail = h.summarizeOllamaFailure(error.message);
      if (runtime.allow_cli_fallback === true && ollamaBinaryHealth.ok) {
        checks.push(
          h.makeCheck(
            "Ollama runtime available",
            true,
            `HTTP unavailable (${detail}); CLI fallback verified via ${ollamaBinaryHealth.detail}`
          )
        );
      } else {
        checks.push(
          h.makeCheck(
            "Ollama runtime available",
            false,
            `${detail}${runtime.allow_cli_fallback === true ? `; CLI fallback unhealthy (${ollamaBinaryHealth.detail})` : ""}`
          )
        );
      }
    }
  } else if (runtime.allow_cli_fallback === true && ollamaBinaryHealth.ok) {
    checks.push(h.makeCheck("Ollama runtime available", true, `No base_url configured; CLI fallback verified via ${ollamaBinaryHealth.detail}`));
  } else {
    checks.push(
      h.makeCheck(
        "Ollama runtime available",
        false,
        runtime.allow_cli_fallback === true
          ? `No base_url configured and CLI fallback unhealthy (${ollamaBinaryHealth.detail})`
          : "No base_url configured in runtime.json"
      )
    );
  }

  // Active model
  checks.push(h.makeCheck("Active model configured", !!runtime.model, runtime.model || "unset"));

  // node_modules
  const nodeModules = path.join(h.REPO_ROOT, "functions", "node_modules");
  checks.push(h.makeCheck("functions/node_modules exists", fs.existsSync(nodeModules), nodeModules));

  // Directories
  [h.RUNS_ROOT, h.DATASETS_ROOT, h.DASHBOARD_ROOT, h.KNOWLEDGE_ROOT].forEach((dir) => {
    checks.push(h.makeCheck(`${h.relativeToRepo(dir)}/ exists`, fs.existsSync(dir), dir));
  });

  // Templates
  const templatesDir = path.join(h.AUTOMATION_ROOT, "templates");
  checks.push(h.makeCheck("templates/ exists", fs.existsSync(templatesDir), templatesDir));

  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;

  console.log(`\n  KAAYKO API \u2022 DOCTOR\n`);
  checks.forEach((c) => {
    const icon = c.ok ? "\u2705" : "\u274c";
    console.log(`  ${icon} ${c.label}: ${c.detail}`);
  });
  console.log(`\n  ${passed}/${total} checks passed.\n`);
}

// ── Agent / Mission ─────────────────────────────────────────────

async function runAgent(config, runtimeConfig, args) {
  const area = args.area || args._positional[1] || "shared";
  const goal = args.goal || "general maintenance and review";
  const track = h.resolveMissionTrack(area);
  const trackConfig = config.tracks[track];
  if (!trackConfig) throw new Error(`Unknown track: ${track}. Available: ${Object.keys(config.tracks).join(", ")}`);

  const applyMode = args.apply || "safe";
  const interactive = h.resolveBooleanArg(args.interactive, false);
  const goalMode = args["goal-mode"] || "edit";

  console.log(`\n  KAAYKO API \u2022 AGENT MISSION\n`);
  console.log(`  Area:    ${area}`);
  console.log(`  Track:   ${track}`);
  console.log(`  Goal:    ${goal}`);
  console.log(`  Apply:   ${applyMode}`);
  console.log(`  Mode:    ${goalMode}`);
  console.log(`  Model:   ${runtimeConfig.local_model_runtime?.model || "unset"}`);
  console.log("");

  const created = createRun(config, runtimeConfig, { track, idea: h.slugify(goal), title: goal, area, source: "agent" });
  const runDir = created.runDir;

  try {
    const agentHelpers = {
      ensureDir: h.ensureDir,
      writeText: h.writeText,
      writeJson: h.writeJson,
      loadJson: h.loadJson,
      updateRunManifest: h.updateRunManifest,
      relativeToRepo: h.relativeToRepo,
      resolvePrefixedPath: h.resolvePrefixedPath,
      resolveRepo: h.resolveRepo,
      resolveAgentRoots: h.resolveAgentRoots,
      slugify: h.slugify,
      buildAgentCoachingBundle: h.buildAgentCoachingBundle,
      buildAgentCoachingMarkdown: h.buildAgentCoachingMarkdown,
      buildAgentCoachingPromptSection: h.buildAgentCoachingPromptSection,
      resolveRunCoachingContext: h.resolveRunCoachingContext,
      invokeOllamaPrompt: h.invokeOllamaPrompt,
      parseAgentJsonResponse: h.parseAgentJsonResponse,
      REPO_ROOT: h.REPO_ROOT
    };

    const agentResult = agentRunner.executeLocalModelAgent(
      config, runtimeConfig, runDir, created.manifest,
      { track, area, goal, apply: applyMode, interactive, "goal-mode": goalMode },
      agentHelpers
    );

    h.updateRunManifest(runDir, (manifest) => {
      manifest.agent = {
        ...h.sanitizeAgentState(manifest.agent || {}),
        model: agentResult?.runtime?.model || manifest.agent?.model || runtimeConfig.local_model_runtime?.model || "heuristic",
        provider: agentResult?.runtime?.provider || manifest.agent?.provider || runtimeConfig.local_model_runtime?.provider || "ollama",
        inventory_strategy: agentResult?.runtime?.inventory_strategy || manifest.agent?.inventory_strategy,
        analysis_strategy: agentResult?.runtime?.analysis_strategy || manifest.agent?.analysis_strategy,
        fallback_reason: agentResult?.runtime?.fallback_reason || manifest.agent?.fallback_reason || null,
        warnings: agentResult?.runtime?.warnings || manifest.agent?.warnings || [],
        goal_mode: goalMode
      };
      manifest.source = "agent";
    });

    captureRunInternal(config, runDir);

    if (runtimeConfig.review_engine?.mode === "ollama" || args["auto-review"]) {
      applyAutoReview(config, runtimeConfig, { run: created.manifest.run_id, silent: true });
    }

    const run = h.loadRun(created.manifest.run_id);
    const review = h.loadReview(runDir);
    printResults(run, review);
    dashboard.generateDashboard(config, {}, true);

  } catch (error) {
    h.updateRunManifest(runDir, { status: "agent_failed" });
    throw error;
  }
}

async function runMission(config, runtimeConfig, args) {
  return runAgent(config, runtimeConfig, args);
}

// ── Init / Pipeline / Model-Driven ──────────────────────────────

function initRun(config, runtimeConfig, args) {
  h.validateInitArgs(config, args);
  return createRun(config, runtimeConfig, args);
}

async function pipelineRun(config, runtimeConfig, args) {
  h.validateInitArgs(config, args);
  const track = args.track;
  const idea = args.idea;
  const title = args.title || `${track}/${idea}`;
  const area = args.area || track;

  console.log(`\n  KAAYKO API \u2022 PIPELINE\n`);
  console.log(`  Track: ${track}`);
  console.log(`  Idea:  ${idea}`);
  console.log(`  Title: ${title}`);
  console.log("");

  const created = createRun(config, runtimeConfig, { track, idea, title, area, source: "pipeline" });
  const runDir = created.runDir;

  // If model-driven, run agent
  if (runtimeConfig.review_engine?.mode === "ollama") {
    try {
      const agentHelpers = {
        ensureDir: h.ensureDir, writeText: h.writeText, writeJson: h.writeJson, loadJson: h.loadJson,
        updateRunManifest: h.updateRunManifest, relativeToRepo: h.relativeToRepo,
        resolvePrefixedPath: h.resolvePrefixedPath, resolveRepo: h.resolveRepo,
        resolveAgentRoots: h.resolveAgentRoots, slugify: h.slugify,
        buildAgentCoachingBundle: h.buildAgentCoachingBundle,
        buildAgentCoachingMarkdown: h.buildAgentCoachingMarkdown,
        buildAgentCoachingPromptSection: h.buildAgentCoachingPromptSection,
        resolveRunCoachingContext: h.resolveRunCoachingContext,
        invokeOllamaPrompt: h.invokeOllamaPrompt, parseAgentJsonResponse: h.parseAgentJsonResponse,
        REPO_ROOT: h.REPO_ROOT
      };

      const goal = args.goal || title;
      const agentResult = agentRunner.executeLocalModelAgent(
        config, runtimeConfig, runDir, created.manifest,
        { track, area, goal, apply: args.apply || "safe", "goal-mode": args["goal-mode"] || "edit" },
        agentHelpers
      );

      h.updateRunManifest(runDir, (manifest) => {
        manifest.agent = {
          ...h.sanitizeAgentState(manifest.agent || {}),
          model: agentResult?.runtime?.model || manifest.agent?.model || runtimeConfig.local_model_runtime?.model || "heuristic",
          provider: agentResult?.runtime?.provider || manifest.agent?.provider || runtimeConfig.local_model_runtime?.provider || "ollama",
          inventory_strategy: agentResult?.runtime?.inventory_strategy || manifest.agent?.inventory_strategy,
          analysis_strategy: agentResult?.runtime?.analysis_strategy || manifest.agent?.analysis_strategy,
          fallback_reason: agentResult?.runtime?.fallback_reason || manifest.agent?.fallback_reason || null,
          warnings: agentResult?.runtime?.warnings || manifest.agent?.warnings || [],
          goal_mode: args["goal-mode"] || "edit"
        };
        manifest.source = "agent";
      });
    } catch (error) {
      h.updateRunManifest(runDir, { status: "agent_failed" });
      console.error(`Agent step failed: ${error.message}`);
    }
  }

  captureRunInternal(config, runDir);

  if (runtimeConfig.review_engine?.mode === "ollama") {
    applyAutoReview(config, runtimeConfig, { run: created.manifest.run_id, silent: true });
  }

  reviewRunInternal(config, runDir);
  publishRunInternal(config, runDir);

  const run = h.loadRun(created.manifest.run_id);
  const review = h.loadReview(runDir);
  printResults(run, review);
  dashboard.generateDashboard(config, {}, true);
}

// ── Run Lifecycle ───────────────────────────────────────────────

function createRun(config, runtimeConfig, args) {
  const track = args.track || h.resolveMissionTrack(args.area);
  const idea = args.idea || h.slugify(args.goal || args.title || "untitled");
  const title = args.title || `${track}/${idea}`;
  const area = args.area || track;
  const now = new Date();
  const runId = `${track}-${idea}-${h.formatRunTimestamp(now)}`;
  const runDir = path.join(h.RUNS_ROOT, runId);

  h.ensureDir(runDir);
  h.ensureDir(path.join(runDir, "notes"));
  h.ensureDir(path.join(runDir, "review"));
  h.ensureDir(path.join(runDir, "artifacts"));
  h.ensureDir(path.join(runDir, "artifacts", "commands"));
  h.ensureDir(path.join(runDir, "artifacts", "agent"));
  h.ensureDir(path.join(runDir, "artifacts", "coaching"));
  h.ensureDir(path.join(runDir, "artifacts", "backups"));

  const coachingBundle = h.buildAgentCoachingBundle(track, area, args.goal || title);

  const manifest = {
    run_id: runId,
    track,
    requested_area: area,
    title,
    status: "initialized",
    source: args.source || "manual",
    repo: "api",
    changed_files: [],
    git_snapshots: [],
    quality_gates: (config.tracks[track]?.quality_gates || []).map((gate) => ({
      ...gate, status: null, last_run_at: null, exit_code: null, duration_ms: null, log_path: null
    })),
    coaching: {
      profile_ids: coachingBundle.profile_ids,
      guided_products: coachingBundle.guided_products,
      focused_profile_ids: coachingBundle.focused_profile_ids,
      focused_products: coachingBundle.focused_products,
      source_docs: coachingBundle.source_docs,
      focused_source_docs: coachingBundle.focused_source_docs
    },
    artifacts: {},
    agent: {},
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };

  h.writeJson(path.join(runDir, "manifest.json"), manifest);

  // Write coaching markdown
  const coachingMarkdown = h.buildAgentCoachingMarkdown(coachingBundle, { area, goal: args.goal || title });
  h.writeText(path.join(runDir, "artifacts", "coaching", "briefing.md"), coachingMarkdown);

  // Write spec from template
  try {
    const spec = h.renderTemplate("spec.md", {
      RUN_ID: runId, TRACK: track, TITLE: title, AREA: area,
      CREATED_AT: now.toISOString(), GOAL: args.goal || title,
      GUIDED_PRODUCTS: coachingBundle.guided_products.join(", ") || "None",
      FOCUSED_PRODUCTS: coachingBundle.focused_products.join(", ") || "None"
    });
    h.writeText(path.join(runDir, "spec.md"), spec);
  } catch { /* template may not exist */ }

  // Write initial review from template
  try {
    const review = h.renderTemplate("review.json", {
      RUN_ID: runId, TRACK: track, TITLE: title, AREA: area
    });
    h.writeText(path.join(runDir, "review", "review.json"), review);
  } catch {
    // Write a default review.json
    h.writeJson(path.join(runDir, "review", "review.json"), {
      run_id: runId, decision: "pending", summary: "",
      accuracy_score: 0, maintainability_score: 0, confidence_score: 0,
      findings: [], security_findings: [], debt_findings: [], ux_findings: [],
      required_followups: [], waivers: [],
      context_checks: { api_surfaces_checked: [], backend_routes_checked: [], tests_run: [] },
      training_labels: { approved_for_training: false, label_type: "pending", fine_tuning_notes: "" }
    });
  }

  try {
    const reviewMd = h.renderTemplate("review.md", { RUN_ID: runId, TRACK: track, TITLE: title, AREA: area });
    h.writeText(path.join(runDir, "review", "review.md"), reviewMd);
  } catch { /* optional template */ }

  try {
    const decisionLog = h.renderTemplate("decision-log.md", { RUN_ID: runId, TRACK: track, TITLE: title, AREA: area });
    h.writeText(path.join(runDir, "review", "decision-log.md"), decisionLog);
  } catch { /* optional template */ }

  console.log(`  Created run: ${runId}`);
  console.log(`  Directory:   ${h.relativeToRepo(runDir)}`);

  return { runDir, manifest };
}

function captureRun(config, args) {
  const { runDir } = h.loadRun(args.run);
  captureRunInternal(config, runDir);
  console.log("Capture complete.");
}

function captureRunInternal(config, runDir) {
  const snapshot = h.captureGitSnapshot("api", h.REPO_ROOT);

  h.updateRunManifest(runDir, (manifest) => {
    manifest.git_snapshots = [snapshot];
    manifest.changed_files = snapshot.changed_files;
    manifest.status = manifest.status === "initialized" ? "captured" : manifest.status;
  });

  // Run quality gates
  const manifestNow = h.loadJson(path.join(runDir, "manifest.json"));
  const track = manifestNow.track;
  const trackConfig = config.tracks[track];
  if (!trackConfig) return;

  const gates = (trackConfig.quality_gates || []).map((gate) => {
    try { return h.runQualityGate(config, runDir, gate); }
    catch (error) {
      return { ...gate, status: "blocked", blocking_reason: error.message, last_run_at: new Date().toISOString() };
    }
  });

  h.updateRunManifest(runDir, (manifest) => {
    manifest.quality_gates = gates;
    const failedGates = gates.filter((g) => g.status === "failed");
    if (failedGates.length > 0 && manifest.status === "captured") {
      manifest.status = "capture_failed";
    }
  });
}

function reviewRun(config, args) {
  const { runDir } = h.loadRun(args.run);
  reviewRunInternal(config, runDir);
  console.log("Review validation complete.");
}

function reviewRunInternal(config, runDir) {
  const reviewPath = path.join(runDir, "review", "review.json");
  if (!fs.existsSync(reviewPath)) {
    console.log("  No review.json found; skipping review step.");
    return;
  }

  const review = h.loadJson(reviewPath);
  if (review.decision === "pending") {
    console.log("  Review is still pending.");
    return;
  }

  h.validateReview(review);
  const newStatus = h.statusFromReview(review.decision, null);

  h.updateRunManifest(runDir, (manifest) => {
    manifest.status = newStatus;
    manifest.reviewed_at = new Date().toISOString();
  });

  console.log(`  Review validated. Decision: ${review.decision}. Status: ${newStatus}.`);
}

function publishRun(config, args) {
  const { runDir } = h.loadRun(args.run);
  publishRunInternal(config, runDir);
  console.log("Publish complete.");
}

function publishRunInternal(config, runDir) {
  const manifest = h.loadJson(path.join(runDir, "manifest.json"));
  const reviewPath = path.join(runDir, "review", "review.json");
  if (!fs.existsSync(reviewPath)) return;
  const review = h.loadJson(reviewPath);

  const eligibility = h.computeTrainingEligibility(config, manifest, review);
  const metrics = h.computeRunMetrics(manifest);
  const coaching = h.resolveRunCoachingContext(manifest);
  const agentAnalysis = h.loadAgentAnalysisFromManifest(manifest);
  const trajectory = buildTrajectoryRecord(manifest, review, metrics, coaching, agentAnalysis);
  const learning = buildLearningSummary(manifest, review, metrics, coaching);

  // Write trajectory
  h.ensureDir(path.join(runDir, "artifacts", "trajectory"));
  h.writeJson(path.join(runDir, "artifacts", "trajectory", "trajectory.json"), trajectory);
  h.writeText(path.join(runDir, "artifacts", "trajectory", "learning.md"), learning);

  // Write to learnings directory
  const learningsSlug = config.tracks[manifest.track]?.learnings_slug || manifest.track;
  const learningsDir = path.join(h.AUTOMATION_ROOT, "learnings", learningsSlug);
  h.ensureDir(learningsDir);
  const snapshotName = `${manifest.run_id}.md`;
  h.writeText(path.join(learningsDir, snapshotName), learning);

  // Write latest.json for the track
  const latest = {
    run_id: manifest.run_id,
    track: manifest.track,
    requested_area: manifest.requested_area,
    status: manifest.status,
    review_decision: review.decision,
    training_eligible: eligibility.eligible,
    changed_files_count: metrics.changed_files_count,
    meaningful_backend_files_changed: metrics.meaningful_backend_files_changed,
    api_surfaces_checked: review.context_checks?.api_surfaces_checked || [],
    backend_routes_checked: review.context_checks?.backend_routes_checked || [],
    guided_products: coaching.guided_products,
    focused_products: coaching.focused_products,
    published_at: new Date().toISOString()
  };
  h.writeJson(path.join(learningsDir, "latest.json"), latest);

  h.updateRunManifest(runDir, (manifest) => {
    manifest.learnings_published_at = new Date().toISOString();
    manifest.training_eligible = eligibility.eligible;
    manifest.training_reason = eligibility.reason;
  });

  if (eligibility.eligible) {
    exportSingleRunDataset(config, runDir, manifest, review, trajectory);
  }
}

function exportSingleRunDataset(config, runDir, manifest, review, trajectory) {
  h.ensureDir(h.DATASETS_ROOT);
  const datasetPath = path.join(h.DATASETS_ROOT, `${manifest.run_id}.jsonl`);
  const record = JSON.stringify(trajectory);
  h.writeText(datasetPath, record);
}

function reconcileRuns(config, args) {
  const manifests = h.listRunManifests();
  let reconciled = 0;

  manifests.forEach(({ runDir, manifest }) => {
    try {
      reconcileSingleRun(config, runDir, manifest);
      reconciled++;
    } catch (error) {
      console.error(`  Failed to reconcile ${manifest.run_id}: ${error.message}`);
    }
  });

  console.log(`Reconciled ${reconciled}/${manifests.length} runs.`);
  dashboard.generateDashboard(config, {}, true);
}

function reconcileSingleRun(config, runDir, manifest) {
  // Reconcile quality gates from logs
  const reconciledGates = h.reconcileQualityGatesFromLogs(manifest.quality_gates || []);
  h.updateRunManifest(runDir, (m) => {
    m.quality_gates = reconciledGates;
    m.agent = h.sanitizeAgentState(m.agent || {});
  });
}

// ── Export / Queue / Worker ──────────────────────────────────────

function exportDatasets(config, args) {
  const format = args.format || "jsonl";
  const manifests = h.listRunManifests();
  h.ensureDir(h.DATASETS_ROOT);

  const records = manifests
    .map(({ runDir, manifest }) => {
      const reviewPath = path.join(runDir, "review", "review.json");
      if (!fs.existsSync(reviewPath)) return null;
      const review = h.loadJson(reviewPath);
      const eligibility = h.computeTrainingEligibility(config, manifest, review);
      if (!eligibility.eligible) return null;

      const metrics = h.computeRunMetrics(manifest);
      const coaching = h.resolveRunCoachingContext(manifest);
      const agentAnalysis = h.loadAgentAnalysisFromManifest(manifest);
      return buildTrajectoryRecord(manifest, review, metrics, coaching, agentAnalysis);
    })
    .filter(Boolean);

  if (format === "jsonl") {
    const outputPath = path.join(h.DATASETS_ROOT, "training.jsonl");
    h.writeText(outputPath, h.joinJsonl(records.map((r) => JSON.stringify(r))));
    console.log(`Exported ${records.length} records to ${h.relativeToRepo(outputPath)}`);
  } else {
    const outputPath = path.join(h.DATASETS_ROOT, "training.json");
    h.writeJson(outputPath, { exported_at: new Date().toISOString(), count: records.length, records });
    console.log(`Exported ${records.length} records to ${h.relativeToRepo(outputPath)}`);
  }
}

function enqueueTask(config, args) {
  h.validateInitArgs(config, args);
  const taskId = `${args.track}-${h.slugify(args.idea)}-${h.formatRunTimestamp(new Date())}`;
  const taskPath = path.join(h.QUEUE_DIRS.pending, `${taskId}.json`);

  h.writeJson(taskPath, {
    task_id: taskId,
    track: args.track,
    idea: args.idea,
    goal: args.goal || args.idea,
    area: args.area || args.track,
    title: args.title || `${args.track}/${args.idea}`,
    enqueued_at: new Date().toISOString()
  });

  console.log(`Task enqueued: ${taskId}`);
  console.log(`Queue: ${h.queueStatusCounts().pending} pending`);
}

function normalizeWorkerTask(task, taskPath) {
  const track = task.track;
  if (!track) {
    throw new Error("Queued task is missing track.");
  }

  const fallbackLabel = path.basename(taskPath, path.extname(taskPath));
  const fallbackGoal = task.goal || task.title || task.idea || task.task_id || task.id || fallbackLabel;
  const area = task.area || track;
  const label = task.task_id || task.id || fallbackLabel;

  if (task.id || task.goalMode || task.priorityLabel || task.source) {
    return {
      strategy: "agent",
      label,
      args: {
        _positional: [],
        area,
        goal: fallbackGoal,
        apply: "safe",
        "goal-mode": task.goalMode || "audit"
      }
    };
  }

  const idea = task.idea || h.slugify(fallbackGoal);
  return {
    strategy: "pipeline",
    label,
    args: {
      _positional: [],
      track,
      idea,
      goal: task.goal || fallbackGoal,
      area,
      title: task.title || fallbackGoal,
      apply: "safe"
    }
  };
}

function moveWorkerTask(task, taskPath, fromState, toState, updates = {}) {
  if (task.id) {
    return pipelineQueue.moveItem(task.id, fromState, toState, updates);
  }

  const fileName = path.basename(taskPath);
  const fromPath = path.join(h.QUEUE_DIRS[fromState], fileName);
  const toPath = path.join(h.QUEUE_DIRS[toState], fileName);
  const sourcePath = fs.existsSync(fromPath) ? fromPath : taskPath;
  const nextTask = { ...task, ...updates, status: toState };

  h.writeJson(toPath, nextTask);
  if (fs.existsSync(sourcePath) && sourcePath !== toPath) {
    fs.unlinkSync(sourcePath);
  }

  return nextTask;
}

async function runWorker(config, runtimeConfig, args) {
  const limit = Number(args.limit || 10);
  const tasks = h.listJsonFiles(h.QUEUE_DIRS.pending).slice(0, limit);

  if (!tasks.length) {
    console.log("Queue is empty.");
    return;
  }

  console.log(`Processing ${tasks.length} queued tasks...`);

  for (const taskPath of tasks) {
    const task = h.loadJson(taskPath);
    const workerTask = normalizeWorkerTask(task, taskPath);
    moveWorkerTask(task, taskPath, "pending", "processing", { startedAt: new Date().toISOString() });

    try {
      console.log(`\n\u25b6 ${workerTask.label}`);
      if (workerTask.strategy === "agent") {
        await runAgent(config, runtimeConfig, workerTask.args);
      } else {
        await pipelineRun(config, runtimeConfig, workerTask.args);
      }
      moveWorkerTask(task, taskPath, "processing", "done", { completedAt: new Date().toISOString() });
    } catch (error) {
      console.error(`  Task failed: ${error.message}`);
      moveWorkerTask(task, taskPath, "processing", "failed", { error: error.message, failedAt: new Date().toISOString() });
    }
  }

  console.log(`\nWorker complete. ${h.queueStatusCounts().done} done, ${h.queueStatusCounts().failed} failed.`);
}

// ── Auto Review ─────────────────────────────────────────────────

function applyAutoReview(config, runtimeConfig, args) {
  const { runDir, manifest } = h.loadRun(args.run);
  const silent = h.resolveBooleanArg(args.silent, false);

  const metrics = h.computeRunMetrics(manifest);
  const coaching = h.resolveRunCoachingContext(manifest);
  const agentAnalysis = h.loadAgentAnalysisFromManifest(manifest);
  const review = buildAutoReview(config, manifest, metrics, coaching, agentAnalysis);

  h.writeJson(path.join(runDir, "review", "review.json"), review);

  const reviewMarkdown = buildAutoReviewMarkdown(manifest, review, metrics, coaching);
  h.writeText(path.join(runDir, "review", "review.md"), reviewMarkdown);

  h.updateRunManifest(runDir, (m) => {
    m.status = h.statusFromReview(review.decision, m.status);
    m.reviewed_at = new Date().toISOString();
  });

  if (!silent) {
    console.log(`Auto-review applied to ${manifest.run_id}: decision=${review.decision}`);
  }
}

function buildAutoReview(config, manifest, metrics, coaching, agentAnalysis) {
  const gates = manifest.quality_gates || [];
  const failedGates = gates.filter((g) => g.status === "failed");
  const blockedGates = gates.filter((g) => g.status === "blocked");
  const passedGates = gates.filter((g) => g.status === "passed");
  const debtLevel = h.debtLevelFromMetrics(failedGates.length, metrics);

  const changedFiles = manifest.changed_files || [];
  const apiSurfaces = h.deriveApiSurfaces(changedFiles);
  const backendRoutes = h.deriveBackendRoutes(changedFiles);
  const meaningfulCount = metrics.meaningful_backend_files_changed;

  // Compute scores
  let accuracyScore = 65;
  let maintainabilityScore = 65;
  let confidenceScore = 50;

  if (passedGates.length === gates.length && gates.length > 0) {
    accuracyScore += 20;
    maintainabilityScore += 15;
    confidenceScore += 20;
  }
  if (failedGates.length > 0) {
    accuracyScore -= 15 * failedGates.length;
    maintainabilityScore -= 10 * failedGates.length;
  }
  if (blockedGates.length > 0) {
    confidenceScore -= 10 * blockedGates.length;
  }
  if (meaningfulCount > 0 && meaningfulCount <= 10) {
    accuracyScore += 10;
    maintainabilityScore += 10;
    confidenceScore += 10;
  }
  if (metrics.total_churn > 500) {
    maintainabilityScore -= 10;
    confidenceScore -= 5;
  }

  // Agent analysis adjustments
  const findings = [];
  const securityFindings = [];
  const debtFindings = [];
  const followups = [];
  let unsafeEditCount = 0;

  if (agentAnalysis) {
    (agentAnalysis.findings || []).forEach((finding) => {
      findings.push(finding);
      if (h.isVulnerabilityFinding(finding)) securityFindings.push(finding);
      if (h.isSuggestionFinding(finding)) debtFindings.push(finding);
    });
    (agentAnalysis.followups || []).forEach((followup) => followups.push(followup));

    if (agentAnalysis.safe_edits && agentAnalysis.safe_edits.length > 0) {
      try {
        const unsafeEdits = agentVerifyModule.detectUnsafeEdits(agentAnalysis.safe_edits);
        unsafeEditCount = unsafeEdits.length;
        if (unsafeEditCount > 0) {
          accuracyScore -= 5 * unsafeEditCount;
          unsafeEdits.forEach((edit) => {
            findings.push({
              severity: "high", category: "security",
              title: `Unsafe edit detected: ${edit.reason}`,
              detail: `File: ${edit.file}`,
              status: "open"
            });
          });
        }
      } catch { /* verification not available */ }
    }

    if (agentAnalysis.rejected_edits && agentAnalysis.rejected_edits.length > 0) {
      confidenceScore -= 3 * agentAnalysis.rejected_edits.length;
    }
  }

  // Gate findings
  failedGates.forEach((gate) => {
    findings.push({
      severity: "high", category: "quality",
      title: `Quality gate failed: ${gate.label}`,
      detail: `Exit code ${gate.exit_code}. ${gate.blocking_reason || ""}`,
      status: "open"
    });
  });
  blockedGates.forEach((gate) => {
    findings.push({
      severity: "medium", category: "quality",
      title: `Quality gate blocked: ${gate.label}`,
      detail: gate.blocking_reason === "environment_restriction"
        ? "Verification could not complete in the current environment."
        : `Verification did not complete. ${gate.blocking_reason || ""}`.trim(),
      status: "open"
    });
  });
  if (blockedGates.length > 0) {
    followups.push("Re-run blocked quality gates in an unrestricted environment before approval.");
  }

  // Determine decision
  // Environment-blocked gates (sandbox, permissions) are warnings, not blockers
  const envBlockedGates = blockedGates.filter((g) => g.blocking_reason === "environment_restriction");
  const hardBlockedGates = blockedGates.filter((g) => g.blocking_reason !== "environment_restriction");
  let decision = "pending";
  if (failedGates.length === 0 && hardBlockedGates.length === 0 && unsafeEditCount === 0 && securityFindings.length === 0) {
    decision = "approved";
  } else if (failedGates.length > 0 || securityFindings.length > 0 || unsafeEditCount > 0) {
    decision = "changes_requested";
  }

  return {
    run_id: manifest.run_id,
    decision,
    summary: `Automated review generated from configured quality gates and agent analysis. ${passedGates.length}/${gates.length} gates passed. ${findings.length} findings. Scope: ${meaningfulCount} meaningful backend files changed.`,
    accuracy_score: h.clampScore(accuracyScore),
    maintainability_score: h.clampScore(maintainabilityScore),
    confidence_score: h.clampScore(confidenceScore),
    findings,
    security_findings: securityFindings,
    debt_findings: debtFindings,
    ux_findings: [],
    required_followups: followups,
    waivers: [],
    context_checks: {
      api_surfaces_checked: apiSurfaces,
      backend_routes_checked: backendRoutes,
      tests_run: gates.map((g) => g.label)
    },
    training_labels: {
      approved_for_training: decision === "approved",
      label_type: "auto",
      fine_tuning_notes: `Auto-reviewed. ${debtLevel} debt. ${coaching.guided_products.length} guided products.`
    }
  };
}

function buildAutoReviewMarkdown(manifest, review, metrics, coaching) {
  const findingsText = review.findings.length
    ? review.findings.map((f) => `- [${f.severity}] ${f.title}: ${f.detail || ""}`).join("\n")
    : "- No findings.";
  const followupsText = review.required_followups.length
    ? review.required_followups.map((f) => `- ${f}`).join("\n")
    : "- None.";

  return `# Auto Review: ${manifest.run_id}

Generated By: \`auto-review\`
Generated At: ${new Date().toISOString()}

## Summary

${review.summary}

## Decision: ${review.decision}

- Accuracy: ${review.accuracy_score}
- Maintainability: ${review.maintainability_score}
- Confidence: ${review.confidence_score}

## Scope

- Changed files: ${metrics.changed_files_count}
- Meaningful backend files: ${metrics.meaningful_backend_files_changed}
- Total churn: +${metrics.insertions} / -${metrics.deletions}

## Coaching

- Guided: ${coaching.guided_products.join(", ") || "None"}
- Focus: ${coaching.focused_products.join(", ") || "None"}

## Findings

${findingsText}

## Required Follow-ups

${followupsText}

## Context Checks

- API surfaces checked: ${(review.context_checks?.api_surfaces_checked || []).join(", ") || "None"}
- Backend routes checked: ${(review.context_checks?.backend_routes_checked || []).join(", ") || "None"}
- Tests run: ${(review.context_checks?.tests_run || []).join(", ") || "None"}
`;
}

// ── Trajectory / Learning ───────────────────────────────────────

function buildTrajectoryRecord(manifest, review, metrics, coaching, agentAnalysis) {
  return {
    run_id: manifest.run_id,
    track: manifest.track,
    requested_area: manifest.requested_area || manifest.track,
    title: manifest.title,
    status: manifest.status,
    source: manifest.source || "manual",
    created_at: manifest.created_at,
    updated_at: manifest.updated_at,
    review: {
      decision: review.decision,
      accuracy_score: review.accuracy_score,
      maintainability_score: review.maintainability_score,
      confidence_score: review.confidence_score,
      findings_count: review.findings.length,
      security_findings_count: review.security_findings.length,
      debt_findings_count: review.debt_findings.length,
      required_followups_count: review.required_followups.length,
      training_labels: review.training_labels,
      context_checks: review.context_checks
    },
    metrics,
    coaching: {
      guided_products: coaching.guided_products,
      focused_products: coaching.focused_products,
      profile_ids: coaching.profile_ids,
      focused_profile_ids: coaching.focused_profile_ids,
      route_focus: coaching.route_focus,
      validation_focus: coaching.validation_focus,
      risk_focus: coaching.risk_focus
    },
    agent: agentAnalysis ? {
      summary: agentAnalysis.summary,
      selected_files_count: agentAnalysis.selected_files.length,
      applied_edits_count: agentAnalysis.applied_edits.length,
      rejected_edits_count: agentAnalysis.rejected_edits.length,
      findings_count: agentAnalysis.findings.length,
      followups_count: agentAnalysis.followups.length,
      model: manifest.agent?.model || "heuristic",
      provider: manifest.agent?.provider || "unknown",
      goal_mode: manifest.agent?.goal_mode || "edit"
    } : null,
    changed_files: manifest.changed_files,
    quality_gates: (manifest.quality_gates || []).map((g) => ({
      id: g.id, label: g.label, status: g.status, exit_code: g.exit_code
    }))
  };
}

function buildLearningSummary(manifest, review, metrics, coaching) {
  const gatesText = (manifest.quality_gates || [])
    .map((g) => `- ${g.status === "passed" ? "\u2705" : "\u274c"} ${g.label}: ${g.status}`)
    .join("\n");
  const findingsText = review.findings.length
    ? review.findings.map((f) => `- [${f.severity}] ${f.title}`).join("\n")
    : "- None.";
  const coachingText = coaching.guided_products.length
    ? coaching.guided_products.map((p) => `- ${p}`).join("\n")
    : "- None.";

  return `# Learning Snapshot: ${manifest.run_id}

## Summary

- Track: ${manifest.track}
- Area: ${manifest.requested_area || manifest.track}
- Status: ${manifest.status}
- Decision: ${review.decision}
- Accuracy: ${review.accuracy_score}
- Maintainability: ${review.maintainability_score}
- Training eligible: ${review.training_labels?.approved_for_training || false}

## Metrics

- Changed files: ${metrics.changed_files_count}
- Backend files: ${metrics.backend_files_changed}
- Meaningful files: ${metrics.meaningful_backend_files_changed}
- Churn: +${metrics.insertions} / -${metrics.deletions}

## Quality Gates

${gatesText || "- No gates configured."}

## Findings

${findingsText}

## Coaching Context

${coachingText}

## Changed Files

${manifest.changed_files.map((f) => `- ${f}`).join("\n") || "- No changed files."}
`;
}

// ── Review Commands ─────────────────────────────────────────────

function resolveRunForReview(args) {
  return h.loadRun(args.run);
}

function handleDiffCommand(config, args) {
  const { runDir, manifest } = resolveRunForReview(args);
  const full = h.resolveBooleanArg(args.full, false);
  const changedFiles = manifest.changed_files || [];

  console.log(`\n  Run: ${manifest.run_id}`);
  console.log(`  Status: ${manifest.status}`);
  console.log(`  Changed files: ${changedFiles.length}\n`);

  if (!changedFiles.length) {
    console.log("  No changed files.");
    return;
  }

  changedFiles.forEach((file) => console.log(`  ${file}`));

  if (full) {
    console.log("\n  Full diff:\n");
    const diff = h.runShell("git diff", h.REPO_ROOT);
    console.log(diff.stdout || "  No unstaged changes.");
  }

  // Show applied edits if available
  const appliedEdits = getAppliedEditsForRun(manifest);
  if (appliedEdits.length) {
    console.log(`\n  Applied edits (${appliedEdits.length}):`);
    appliedEdits.forEach((edit) => {
      console.log(`    \u2192 ${edit}`);
    });
  }
}

function getAppliedEditsForRun(manifest) {
  if (!manifest.agent?.applied_files) return [];
  return manifest.agent.applied_files;
}

function computeSimpleDiff(manifest) {
  const changedFiles = manifest.changed_files || [];
  const diffs = [];

  changedFiles.forEach((prefixedPath) => {
    try {
      const absolutePath = h.resolveAbsolutePathFromPrefixed(prefixedPath);
      if (!fs.existsSync(absolutePath)) {
        diffs.push({ file: prefixedPath, status: "deleted" });
        return;
      }
      const content = fs.readFileSync(absolutePath, "utf8");
      diffs.push({
        file: prefixedPath,
        status: "modified",
        lines: content.split("\n").length
      });
    } catch {
      diffs.push({ file: prefixedPath, status: "error" });
    }
  });

  return diffs;
}

function getApprovalBlockers(config, manifest, review) {
  const blockers = [];
  const nonPassingGates = (manifest.quality_gates || []).filter((gate) => gate.status && gate.status !== "passed");
  const disqualifyingSeverities = new Set(
    (config.training_policy?.disqualifying_open_severities || []).map((severity) => String(severity).toLowerCase())
  );
  const openBlockingFindings = (review.findings || []).filter((finding) => {
    const severity = String(finding.severity || "").toLowerCase();
    const status = String(finding.status || "open").toLowerCase();
    return disqualifyingSeverities.has(severity) && status !== "resolved" && status !== "waived";
  });

  if (review.decision !== "approved") {
    blockers.push(`Review decision is \`${review.decision}\`.`);
  }

  nonPassingGates.forEach((gate) => {
    blockers.push(`Quality gate \`${gate.label}\` is \`${gate.status || "pending"}\`.`);
  });

  if (openBlockingFindings.length > 0) {
    blockers.push(`${openBlockingFindings.length} blocking finding(s) are still open.`);
  }

  return { blockers, nonPassingGates, openBlockingFindings };
}

function handleApproveCommand(config, args) {
  const { runDir, manifest } = resolveRunForReview(args);

  if (manifest.status === "reviewed") {
    console.log(`Run ${manifest.run_id} is already approved.`);
    return;
  }

  // Update review
  const reviewPath = path.join(runDir, "review", "review.json");
  const review = h.loadJson(reviewPath);
  const force = h.resolveBooleanArg(args.force, false);
  const { blockers } = getApprovalBlockers(config, manifest, review);

  if (blockers.length > 0 && !force) {
    console.log(`\n  Cannot approve ${manifest.run_id} yet:\n`);
    blockers.forEach((blocker) => console.log(`  - ${blocker}`));
    console.log("\n  Clear the blockers first, or re-run with `--force` to record a manual override without making the run training-eligible.");
    return;
  }

  review.decision = "approved";
  if (!review.summary || review.summary === "Approved via CLI." || review.summary === "Force-approved via CLI override.") {
    review.summary = blockers.length > 0 ? "Force-approved via CLI override." : "Approved via CLI.";
  }
  review.training_labels.approved_for_training = blockers.length === 0;
  review.training_labels.label_type = blockers.length === 0 ? "manual" : "manual_override";
  h.writeJson(reviewPath, review);

  // Update manifest
  h.updateRunManifest(runDir, (m) => {
    m.status = "reviewed";
    m.reviewed_at = new Date().toISOString();
  });

  // Publish
  publishRunInternal(config, runDir);

  // Commit message
  const commitMessage = `[kaayko-api] approved: ${manifest.run_id}`;
  console.log(`\n  \u2705 Approved: ${manifest.run_id}`);
  if (blockers.length > 0) {
    console.log("  Override used: training export remains disabled until the blockers are cleared.");
  }
  console.log(`  Suggested commit: git commit -m "${commitMessage}"`);

  dashboard.generateDashboard(config, {}, true);
}

function handleRejectCommand(config, args) {
  const { runDir, manifest } = resolveRunForReview(args);

  // Update review
  const reviewPath = path.join(runDir, "review", "review.json");
  const review = h.loadJson(reviewPath);
  review.decision = "rejected";
  if (!review.summary) {
    review.summary = "Rejected via CLI.";
  }
  review.training_labels.approved_for_training = false;
  h.writeJson(reviewPath, review);

  // Update manifest
  h.updateRunManifest(runDir, (m) => {
    m.status = "rejected";
    m.reviewed_at = new Date().toISOString();
  });

  // Restore backups
  restoreFromBackups(runDir, manifest);

  console.log(`\n  \u274c Rejected: ${manifest.run_id}`);
  dashboard.generateDashboard(config, {}, true);
}

function handleRollbackCommand(config, args) {
  const { runDir, manifest } = resolveRunForReview(args);

  // Update manifest
  h.updateRunManifest(runDir, (m) => {
    m.status = "rolled_back";
    m.rolled_back_at = new Date().toISOString();
  });

  // Restore backups
  restoreFromBackups(runDir, manifest);

  console.log(`\n  \u21a9 Rolled back: ${manifest.run_id}`);
  dashboard.generateDashboard(config, {}, true);
}

function restoreFromBackups(runDir, manifest) {
  const backupsDir = path.join(runDir, "artifacts", "backups");
  if (!fs.existsSync(backupsDir)) return;

  const backupFiles = fs.readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  if (!backupFiles.length) {
    console.log("  No backups to restore.");
    return;
  }

  let restored = 0;
  backupFiles.forEach((backupName) => {
    // Backup names encode the original path with -- as separator
    const originalRelative = backupName.replace(/--/g, "/").replace(/\.backup$/, "");
    const originalPath = path.join(h.REPO_ROOT, originalRelative);
    const backupPath = path.join(backupsDir, backupName);

    try {
      const backupContent = fs.readFileSync(backupPath, "utf8");
      h.ensureDir(path.dirname(originalPath));
      fs.writeFileSync(originalPath, backupContent);
      restored++;
    } catch (error) {
      console.error(`  Failed to restore ${originalRelative}: ${error.message}`);
    }
  });

  console.log(`  Restored ${restored}/${backupFiles.length} backups.`);
}

// ── Prune Command ───────────────────────────────────────────────

function handlePruneCommand(config, args) {
  const dryRun = h.resolveBooleanArg(args["dry-run"], false);
  const manifests = h.listRunManifests();
  const now = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

  const stale = manifests.filter(({ manifest }) => {
    const age = now - new Date(manifest.updated_at).getTime();
    const isStale = age > maxAge && manifest.status !== "reviewed" && !manifest.training_eligible;
    return isStale;
  });

  console.log(`\n  Found ${stale.length} stale runs (of ${manifests.length} total).`);

  if (!stale.length) return;

  stale.forEach(({ runDir, manifest }) => {
    console.log(`  ${dryRun ? "[DRY RUN] Would prune" : "Pruning"}: ${manifest.run_id} (${manifest.status})`);
    if (!dryRun) {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  if (!dryRun) {
    console.log(`  Pruned ${stale.length} runs.`);
    dashboard.generateDashboard(config, {}, true);
  }
}

// ── Knowledge Graph ─────────────────────────────────────────────

function handleKnowledgeCommand(config, args) {
  const area = args.area || "shared";
  const coachingConfig = h.loadAgentCoachingConfig();
  const graph = buildKnowledgeGraph(config, coachingConfig, area);

  h.ensureDir(h.KNOWLEDGE_ROOT);
  const outputPath = path.join(h.KNOWLEDGE_ROOT, `${h.slugify(area)}.json`);
  h.writeJson(outputPath, graph);

  const markdownPath = path.join(h.KNOWLEDGE_ROOT, `${h.slugify(area)}.md`);
  const markdown = buildKnowledgeContextMarkdown(graph);
  h.writeText(markdownPath, markdown);

  console.log(`Knowledge graph built for area "${area}".`);
  console.log(`  JSON: ${h.relativeToRepo(outputPath)}`);
  console.log(`  Markdown: ${h.relativeToRepo(markdownPath)}`);
}

function buildKnowledgeGraph(config, coachingConfig, area) {
  const profilesMap = coachingConfig.profiles || {};
  const track = h.resolveMissionTrack(area);
  const relevantProfileIds = (coachingConfig.track_profiles || {})[track] || Object.keys(profilesMap);

  const nodes = [];
  const edges = [];
  const scannedFiles = new Set();

  // Scan files from coaching profiles
  relevantProfileIds.forEach((profileId) => {
    const profile = profilesMap[profileId];
    if (!profile) return;

    (profile.api_paths || []).forEach((apiPath) => {
      const absolutePath = path.join(h.REPO_ROOT, apiPath);
      if (!fs.existsSync(absolutePath)) return;

      const stat = fs.statSync(absolutePath);
      if (stat.isDirectory()) {
        // Scan all JS files in the directory
        const files = walkDirectoryForKnowledge(absolutePath);
        files.forEach((filePath) => {
          if (scannedFiles.has(filePath)) return;
          scannedFiles.add(filePath);
          const node = scanFileForKnowledge(filePath, profileId);
          if (node) nodes.push(node);
        });
      } else if (isKnowledgeCandidate(absolutePath)) {
        if (!scannedFiles.has(absolutePath)) {
          scannedFiles.add(absolutePath);
          const node = scanFileForKnowledge(absolutePath, profileId);
          if (node) nodes.push(node);
        }
      }
    });
  });

  // Build edges from imports
  nodes.forEach((node) => {
    (node.imports || []).forEach((importPath) => {
      // Resolve relative import against the importing file's directory
      const importDir = path.dirname(node.path);
      const resolved = path.normalize(path.join(importDir, importPath));
      const candidates = [resolved, resolved + ".js", resolved + "/index.js"];
      const targetNode = nodes.find((n) => candidates.some((c) => n.path === c));
      if (targetNode) {
        edges.push({ from: node.path, to: targetNode.path, type: "imports" });
      }
    });
  });

  return {
    area,
    track,
    generated_at: new Date().toISOString(),
    conventions: [
      "Express.js routers mounted in functions/index.js",
      "Middleware in functions/middleware/ — auth, CORS, rate limiting",
      "Services in functions/services/ — shared business logic",
      "Scheduled functions in functions/scheduled/",
      "API routes follow RESTful patterns: router.get(), router.post()",
      "Firebase Admin SDK for Firestore, Auth, Cloud Storage",
      "Environment config via functions.config() or process.env",
      "Error handling: try/catch with structured JSON error responses",
      "module.exports for all public interfaces"
    ],
    nodes,
    edges,
    stats: {
      total_files: nodes.length,
      total_exports: nodes.reduce((sum, n) => sum + (n.exports || []).length, 0),
      total_imports: edges.length
    }
  };
}

function walkDirectoryForKnowledge(dirPath) {
  const results = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "__mocks__", ".git", "dist", "build"].includes(entry.name)) return;
        results.push(...walkDirectoryForKnowledge(fullPath));
      } else if (isKnowledgeCandidate(fullPath)) {
        results.push(fullPath);
      }
    });
  } catch { /* permission error or similar */ }
  return results;
}

function isKnowledgeCandidate(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return [".js", ".mjs", ".cjs", ".json"].includes(ext);
}

function scanFileForKnowledge(filePath, profileId) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const relativePath = h.relativeToRepo(filePath);
    const exports = agentVerifyModule.extractNamedExports(content);
    const imports = extractKnowledgeImports(content);
    const lines = content.split("\n").length;

    return {
      path: relativePath,
      profile: profileId,
      lines,
      exports: exports.slice(0, 30),
      imports: imports.slice(0, 20),
      has_router: /express\.Router\(\)|Router\(\)/.test(content),
      has_middleware: /module\.exports\s*=.*(?:middleware|auth|validate|cors)/i.test(content),
      has_firebase_admin: /require\(["']firebase-admin["']\)|admin\.firestore|admin\.auth/i.test(content),
      has_scheduled: /onSchedule|functions\.pubsub|functions\.scheduler/i.test(content),
      has_tests: /describe\(|it\(|test\(|expect\(/.test(content)
    };
  } catch {
    return null;
  }
}

function extractKnowledgeImports(content) {
  const imports = [];
  const requirePattern = /require\(["']([^"']+)["']\)/g;
  let match;
  while ((match = requirePattern.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith(".")) {
      imports.push(importPath);
    }
  }
  return h.uniqueStrings(imports);
}

function buildKnowledgeContextMarkdown(graph) {
  const nodesText = graph.nodes.length
    ? graph.nodes.map((n) => {
        const tags = [];
        if (n.has_router) tags.push("router");
        if (n.has_middleware) tags.push("middleware");
        if (n.has_firebase_admin) tags.push("firebase");
        if (n.has_scheduled) tags.push("scheduled");
        return `- ${n.path} (${n.lines} lines, ${n.exports.length} exports${tags.length ? `, ${tags.join(", ")}` : ""})`;
      }).join("\n")
    : "- No files scanned.";

  const conventionsText = graph.conventions.map((c) => `- ${c}`).join("\n");

  return `# Knowledge Graph: ${graph.area}

- Track: ${graph.track}
- Generated: ${graph.generated_at}
- Files: ${graph.stats.total_files}
- Exports: ${graph.stats.total_exports}
- Import edges: ${graph.stats.total_imports}

## Conventions

${conventionsText}

## Files

${nodesText}
`;
}

// ── Scout Command ───────────────────────────────────────────────

function handleScoutCommand(config, runtimeConfig, args) {
  console.log("\n  SCOUT — Autonomous codebase sweep\n");

  if (args.continuous) {
    const intervalHours = Number(args.interval || 4);
    console.log(`  Running continuously every ${intervalHours}h. Press Ctrl+C to stop.\n`);
    const handle = scout.startContinuous(
      { ideate: args.ideate, intervalHours },
      h, findingIntelligence, pipelineQueue
    );
    process.on("SIGINT", () => { handle.stop(); process.exit(0); });
    // Keep process alive
    setInterval(() => {}, 60000);
    return;
  }

  const result = scout.sweep(
    { track: args.track || args.area, ideate: args.ideate, dryRun: args["dry-run"] },
    h, findingIntelligence, pipelineQueue
  );

  if (result.skipped) {
    console.log(`  Skipped: ${result.skipped}`);
  } else {
    console.log(`  Target: ${result.track} (${result.staleness || "?"}d stale)`);
    console.log(`  Enqueued: ${result.enqueued} goals`);
    if (result.deduped) {
      console.log(`  Deduped: ${result.deduped} goal${result.deduped === 1 ? "" : "s"}`);
    }
    for (const g of result.goals) {
      console.log(`    → [${g.priority}] ${g.goalMode}: ${g.goal.slice(0, 80)}...`);
    }
  }
  console.log();
}

// ── Serve Command ───────────────────────────────────────────────

function handleServeCommand(config, runtimeConfig, args) {
  const port = Number(args.port || 7799);
  const host = args.host || "127.0.0.1";

  // ── CSRF token for mutating endpoints ─────────────────────────
  const crypto = require("crypto");
  const csrfToken = crypto.randomBytes(24).toString("hex");

  // ── Concurrency lock ─────────────────────────────────────────
  let activeMission = null; // { area, goal, pid, startedAt }

  // ── Clean stale runs on startup ───────────────────────────────
  try {
    const prunedLogs = h.pruneOldLogs();
    if (prunedLogs > 0) console.log(`  Pruned ${prunedLogs} old log file(s)`);
  } catch (e) { console.error(`  Log pruning error: ${e.message}`); }
  try {
    const manifests = h.listRunManifests();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    let cleaned = 0;
    for (const { runDir, manifest } of manifests) {
      if (["agent_selecting", "agent_analyzing", "agent_editing", "agent_verifying"].includes(manifest.status)) {
        const updatedAt = new Date(manifest.updated_at).getTime();
        if (now - updatedAt > staleThreshold) {
          manifest.status = "agent_failed";
          manifest.updated_at = new Date().toISOString();
          manifest.agent = manifest.agent || {};
          manifest.agent.failure_reason = "Stale run cleaned on server startup";
          h.writeJson(path.join(runDir, "manifest.json"), manifest);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) console.log(`  Cleaned ${cleaned} stale run(s) on startup`);
  } catch (e) { console.error(`  Stale cleanup error: ${e.message}`); }

  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const origin = req.headers.origin || "";
    const allowedOrigin = origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:") ? origin : `http://localhost:${port}`;
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    // CSRF check for mutating endpoints
    if (req.method === "POST") {
      const token = req.headers["x-csrf-token"];
      if (token !== csrfToken) {
        res.writeHead(403);
        res.end(JSON.stringify({ ok: false, error: "Invalid or missing CSRF token" }));
        return;
      }
    }

    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    if (pathname === "/api/health" && req.method === "GET") {
      const resp = { ok: true, service: "kaayko-api-automation", time: new Date().toISOString(), busy: !!activeMission };
      if (activeMission) {
        resp.activeMission = {
          area: activeMission.area,
          goal: activeMission.goal.slice(0, 120),
          pid: activeMission.pid,
          elapsed: Math.round((Date.now() - activeMission.startedAt) / 1000)
        };
      }
      res.writeHead(200);
      res.end(JSON.stringify(resp));
      return;
    }

    if (pathname === "/api/models" && req.method === "GET") {
      try {
        const roster = dashboard.buildModelRoster(runtimeConfig);
        const esc = h.escapeHtml;
        const html = roster.map((m) => {
          const installBadge = m.installed
            ? `<span class="status-badge s-approved">installed</span>`
            : `<span class="status-badge s-agent-failed">not installed</span>`;
          const actionBtn = m.installed
            ? (m.active ? `<button class="model-btn active">active</button>` : `<button class="model-btn" onclick="switchModel('${esc(m.id)}')">use</button>`)
            : `<button class="model-btn pull-btn" onclick="pullModel('${esc(m.id)}',this)">pull</button>`;
          return `<tr class="${m.active ? "active-model" : ""}">
            <td>${m.active ? "\u25b6" : "\u00a0"}</td>
            <td><code>${esc(m.id)}</code></td>
            <td>${esc(m.note)}</td>
            <td>${esc(m.size || "")}</td>
            <td>${installBadge}</td>
            <td>${actionBtn}</td>
          </tr>`;
        }).join("");
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, models: roster, html }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    if (pathname === "/api/pull" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { model } = JSON.parse(body);
          if (!model || typeof model !== "string" || model.length > 100) {
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: "Invalid model name" }));
            return;
          }
          const child = spawn("ollama", ["pull", model], {
            cwd: h.REPO_ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true
          });
          child.unref();
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, model, pid: child.pid }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }

    if (pathname === "/api/model" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { model } = JSON.parse(body);
          runtimeConfig.local_model_runtime = runtimeConfig.local_model_runtime || {};
          runtimeConfig.local_model_runtime.model = model;
          h.writeJson(h.RUNTIME_CONFIG_PATH, runtimeConfig);
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, model }));
        } catch (error) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }

    if (pathname === "/api/summary" && req.method === "GET") {
      const summary = h.readDashboardSummary();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, summary }));
      return;
    }

    if (pathname === "/api/runs" && req.method === "GET") {
      const manifests = h.listRunManifests();
      const runs = manifests.map(({ manifest }) => ({
        run_id: manifest.run_id, track: manifest.track, status: manifest.status,
        updated_at: manifest.updated_at, source: manifest.source
      }));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, runs }));
      return;
    }

    if (pathname === "/api/findings" && req.method === "GET") {
      try {
        const manifests = h.listRunManifests();
        const result = findingIntelligence.processFindings(manifests, h.REPO_ROOT);
        res.writeHead(200);
        res.end(JSON.stringify({
          ok: true,
          findings: result.findings,
          count: result.findings.length,
          stats: result.stats
        }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    if (pathname === "/api/suppress" && req.method === "POST") {
      let body = "";
      req.on("data", (d) => { body += d; });
      req.on("end", () => {
        try {
          const { fingerprint, title, severity, track, reason } = JSON.parse(body || "{}");
          if (!fingerprint) {
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: "fingerprint required" }));
            return;
          }

          const suppressionsPath = require("path").join(h.REPO_ROOT, "automation", "config", "suppressions.json");
          let raw = {};
          try { raw = JSON.parse(require("fs").readFileSync(suppressionsPath, "utf8")); } catch { /* new file */ }

          raw.fingerprints = raw.fingerprints || [];
          // Avoid duplicates
          const existing = raw.fingerprints.findIndex((e) => e.fingerprint === fingerprint);
          const entry = {
            fingerprint,
            title: title || "",
            severity: severity || "unknown",
            track: track || "unknown",
            reason: reason || "Suppressed via dashboard",
            created_at: new Date().toISOString()
          };
          if (existing >= 0) {
            raw.fingerprints[existing] = entry;
          } else {
            raw.fingerprints.push(entry);
          }

          require("fs").writeFileSync(suppressionsPath, JSON.stringify(raw, null, 2));
          console.log(`  [suppress] Added fingerprint ${fingerprint} (${title || "?"}) to suppressions.json`);
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, fingerprint }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    if (pathname === "/api/queue" && req.method === "GET") {
      try {
        const overview = pipelineQueue.getQueueOverview();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, ...overview }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    if (pathname === "/api/queue" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { track, goal, goalMode, priority, source } = JSON.parse(body);
          if (!goal) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: "goal required" })); return; }
          const item = pipelineQueue.enqueue({ track, goal, goalMode, priority, source: source || "dashboard" });
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, item }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }

    if (pathname === "/api/diagnostics" && req.method === "GET") {
      try {
        const diag = resourceGovernor.getDiagnostics();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, ...diag }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    if (pathname === "/api/scout" && req.method === "GET") {
      try {
        const report = scout.getScoutReport(h, findingIntelligence);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, ...report }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    if (pathname === "/api/scout" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { track, ideate, dryRun } = JSON.parse(body);
          const result = scout.sweep({ track, ideate, dryRun }, h, findingIntelligence, pipelineQueue);
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, ...result }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }

    if (pathname === "/api/implement" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          // Concurrency guard
          if (activeMission) {
            const elapsed = Math.round((Date.now() - activeMission.startedAt) / 1000);
            res.writeHead(409);
            res.end(JSON.stringify({
              ok: false,
              error: `Mission already running: ${activeMission.area} (${elapsed}s)`,
              activeMission: { area: activeMission.area, pid: activeMission.pid, elapsed }
            }));
            return;
          }

          const { track, title, detail, severity, line_refs, file_paths } = JSON.parse(body);
          if (!track || !title) {
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: "track and title required" }));
            return;
          }
          const lineRefText = Array.isArray(line_refs) && line_refs.length
            ? " Locations: " + line_refs.map((r) => `${r.file}:${r.start_line}${r.end_line && r.end_line !== r.start_line ? "-" + r.end_line : ""}`).join(", ")
            : "";
          const filePathText = Array.isArray(file_paths) && file_paths.length && !lineRefText
            ? " Files: " + file_paths.join(", ")
            : "";
          const goal = `Fix the following ${severity || "medium"} severity issue: ${title}. Detail: ${(detail || "").slice(0, 500)}${lineRefText}${filePathText}`;
          const logFile = `implement-${Date.now()}.log`;
          const logPath = path.join(h.AUTOMATION_ROOT, "logs", logFile);
          h.ensureDir(path.dirname(logPath));

          const child = spawn(
            "node",
            [path.join(h.SCRIPT_DIR, "portfolio-loop.js"), "agent", "--area", track, "--goal", goal, "--apply", "safe", "--goal-mode", "edit"],
            { cwd: h.REPO_ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true }
          );

          activeMission = { area: track, goal, pid: child.pid, startedAt: Date.now() };

          const logStream = fs.createWriteStream(logPath, { flags: "a" });
          child.stdout.pipe(logStream);
          child.stderr.pipe(logStream);
          child.on("exit", (code) => {
            logStream.write(`\n[exit ${code}]\n`);
            logStream.end();
            if (activeMission && activeMission.pid === child.pid) {
              activeMission = null;
            }
          });
          child.unref();

          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, pid: child.pid, logFile, goal }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }

    // ── Fix All: pipeline that triages, verifies, and fixes findings sequentially ──
    if (pathname === "/api/fix-all" && req.method === "POST") {
      try {
        // Concurrency guard
        if (activeMission) {
          const elapsed = Math.round((Date.now() - activeMission.startedAt) / 1000);
          res.writeHead(409);
          res.end(JSON.stringify({
            ok: false,
            error: `Mission already running: ${activeMission.area} (${elapsed}s)`,
            activeMission: { area: activeMission.area, pid: activeMission.pid, elapsed }
          }));
          return;
        }

        // 1. Run finding intelligence pipeline
        const manifests = h.listRunManifests();
        const result = findingIntelligence.processFindings(manifests, h.REPO_ROOT);
        const findings = result.findings || [];

        // 2. Filter to actionable, verified findings only (skip hallucinations, suppressed, unverified)
        const fixable = findings.filter((f) =>
          f.verification !== "hallucination" &&
          f.verification !== "suppressed" &&
          f.priority_score > 0 &&
          (f.severity === "critical" || f.severity === "high" || f.severity === "medium" || f.severity === "major" || f.severity === "blocking")
        );

        if (!fixable.length) {
          res.writeHead(200);
          res.end(JSON.stringify({
            ok: true,
            message: "No actionable findings to fix",
            stats: result.stats,
            pipeline: { total: findings.length, filtered: 0, skipped_reasons: { hallucination: result.stats.hallucinations, suppressed: result.stats.suppressed, low_severity: findings.length - fixable.length } }
          }));
          return;
        }

        // 3. Group by track for sequential processing
        const byTrack = {};
        for (const f of fixable) {
          const t = f.track || "shared";
          if (!byTrack[t]) byTrack[t] = [];
          byTrack[t].push(f);
        }

        // 3b. Cross-track conflict detection: find files referenced by findings in >1 track.
        // Findings that share a file path across tracks are merged into the "shared" track
        // to prevent one track's edit from silently overwriting another track's edit.
        const fileToTracks = {};
        for (const [track, trackFindings] of Object.entries(byTrack)) {
          for (const f of trackFindings) {
            const refs = ((f.detail || "") + " " + (f.title || "")).match(
              /(?:functions|api|src|middleware|services)\/[\w/./-]+\.(?:js|ts|json)/gi
            ) || [];
            for (const ref of refs) {
              if (!fileToTracks[ref]) fileToTracks[ref] = new Set();
              fileToTracks[ref].add(track);
            }
          }
        }
        const conflictFiles = Object.entries(fileToTracks)
          .filter(([, tracks]) => tracks.size > 1)
          .map(([file, tracks]) => ({ file, tracks: Array.from(tracks) }));

        if (conflictFiles.length > 0) {
          // Move conflicting findings to "shared" track so they are edited once
          const conflictingTrackPairs = new Set(
            conflictFiles.flatMap(({ tracks }) => tracks)
          );
          const sharedFindings = byTrack["shared"] || [];
          for (const t of conflictingTrackPairs) {
            if (t === "shared") continue;
            // Move findings from conflicting tracks that reference shared files into shared
            const trackFindings = byTrack[t] || [];
            const conflictSet = new Set(conflictFiles.flatMap((c) => c.tracks.includes(t) ? [c.file] : []));
            const toMove = trackFindings.filter((f) => {
              const refs = ((f.detail || "") + " " + (f.title || "")).match(
                /(?:functions|api|src|middleware|services)\/[\w/./-]+\.(?:js|ts|json)/gi
              ) || [];
              return refs.some((r) => conflictSet.has(r));
            });
            const toKeep = trackFindings.filter((f) => !toMove.includes(f));
            sharedFindings.push(...toMove);
            if (toKeep.length) byTrack[t] = toKeep;
            else delete byTrack[t];
          }
          if (sharedFindings.length) byTrack["shared"] = sharedFindings;
          console.log(`  [fix-all] Cross-track conflicts detected in ${conflictFiles.length} file(s) — merged into shared track: ${conflictFiles.map((c) => c.file).join(", ")}`);
        }

        // 4. Build plan
        const plan = [];
        for (const [track, trackFindings] of Object.entries(byTrack)) {
          // Combine findings for this track into a single goal
          const findingDescriptions = trackFindings.slice(0, 5).map((f, i) =>
            `${i + 1}. [${f.severity}] ${f.title}${f.detail ? ": " + f.detail.slice(0, 150) : ""}`
          ).join("\\n");
          const goal = `Fix the following ${trackFindings.length} issue${trackFindings.length > 1 ? "s" : ""} (verified by code analysis, sorted by priority):\\n${findingDescriptions}`;

          plan.push({ track, goal, findingCount: trackFindings.length, severity: trackFindings[0].severity });
        }

        // Sort plan: critical/high severity tracks first
        const sevPrio = { critical: 0, blocking: 0, high: 1, major: 1, medium: 2 };
        plan.sort((a, b) => (sevPrio[a.severity] ?? 3) - (sevPrio[b.severity] ?? 3));

        // 5. Execute sequentially via queue file (so dashboard can track progress)
        const fixAllId = `fixall-${Date.now()}`;
        const logFile = `${fixAllId}.log`;
        const logPath = path.join(h.AUTOMATION_ROOT, "logs", logFile);
        h.ensureDir(path.dirname(logPath));

        const stateFile = path.join(h.AUTOMATION_ROOT, "logs", `${fixAllId}.state.json`);
        const state = {
          id: fixAllId,
          status: "running",
          startedAt: new Date().toISOString(),
          plan,
          stats: result.stats,
          progress: { completed: 0, total: plan.length, current: null, results: [] }
        };
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

        // Launch async runner
        const runnerCode = `
          const fs = require("fs");
          const path = require("path");
          const { spawnSync } = require("child_process");
          const plan = ${JSON.stringify(plan)};
          const stateFile = ${JSON.stringify(stateFile)};
          const logFile = ${JSON.stringify(logPath)};
          const scriptPath = ${JSON.stringify(path.join(h.SCRIPT_DIR, "portfolio-loop.js"))};
          const repoRoot = ${JSON.stringify(h.REPO_ROOT)};

          function updateState(update) {
            try {
              const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
              Object.assign(s, update);
              fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
            } catch {}
          }

          function log(msg) {
            const ts = new Date().toISOString().slice(11, 19);
            const line = "[" + ts + "] " + msg + "\\n";
            fs.appendFileSync(logFile, line);
          }

          (async () => {
            log("=== FIX ALL PIPELINE ===");
            log("Plan: " + plan.length + " track(s) to fix");
            log("");

            const results = [];
            for (let i = 0; i < plan.length; i++) {
              const step = plan[i];
              log("--- Step " + (i + 1) + "/" + plan.length + ": " + step.track + " (" + step.findingCount + " findings) ---");
              updateState({
                progress: { completed: i, total: plan.length, current: step.track, results }
              });

              const r = spawnSync(
                "node",
                [scriptPath, "agent", "--area", step.track, "--goal", step.goal, "--apply", "safe", "--goal-mode", "edit"],
                { cwd: repoRoot, env: process.env, encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "pipe"] }
              );

              const exitCode = r.status;
              const output = (r.stdout || "").slice(-500);
              log("Exit code: " + exitCode);
              if (output) log("Output tail: " + output.split("\\n").slice(-5).join("\\n"));
              log("");

              results.push({ track: step.track, findingCount: step.findingCount, exitCode, success: exitCode === 0 });
            }

            const succeeded = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;
            log("=== COMPLETE: " + succeeded + " succeeded, " + failed + " failed ===");

            updateState({
              status: "complete",
              completedAt: new Date().toISOString(),
              progress: { completed: plan.length, total: plan.length, current: null, results }
            });
          })();
        `;

        const child = spawn("node", ["-e", runnerCode], {
          cwd: h.REPO_ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true
        });

        activeMission = { area: "fix-all", goal: `Fixing ${fixable.length} findings across ${plan.length} track(s)`, pid: child.pid, startedAt: Date.now() };

        const logStream = fs.createWriteStream(logPath, { flags: "a" });
        child.stdout.pipe(logStream);
        child.stderr.pipe(logStream);
        child.on("exit", (code) => {
          logStream.write(`\n[exit ${code}]\n`);
          logStream.end();
          if (activeMission && activeMission.pid === child.pid) {
            activeMission = null;
          }
        });
        child.unref();

        res.writeHead(200);
        res.end(JSON.stringify({
          ok: true,
          fixAllId,
          pid: child.pid,
          logFile,
          stateFile: path.basename(stateFile),
          plan,
          stats: result.stats,
          pipeline: {
            total_raw: result.stats.total_raw,
            unique: result.stats.unique,
            verified: result.stats.verified,
            hallucinations: result.stats.hallucinations,
            suppressed: result.stats.suppressed,
            fixable: fixable.length,
            tracks: plan.length
          }
        }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    // ── Fix All: progress check ──
    if (pathname === "/api/fix-all/status" && req.method === "GET") {
      try {
        const logsDir = path.join(h.AUTOMATION_ROOT, "logs");
        const stateFiles = fs.readdirSync(logsDir).filter((f) => f.startsWith("fixall-") && f.endsWith(".state.json")).sort().reverse();
        if (!stateFiles.length) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, running: false, message: "No fix-all runs yet" }));
          return;
        }
        const latestState = JSON.parse(fs.readFileSync(path.join(logsDir, stateFiles[0]), "utf8"));
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, ...latestState }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    if (pathname === "/api/pr" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { track, title } = JSON.parse(body);
          if (!track) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: "track required" })); return; }

          const branchName = `auto/${track}-${Date.now()}`;
          const commitMsg = `fix(${track}): ${(title || "agent fix").slice(0, 72)}`;

          // Create branch, stage changes, commit, push
          const cmds = [
            `git checkout -b "${branchName}"`,
            `git add -A`,
            `git diff --cached --quiet && echo "NO_CHANGES" || git commit -m "${commitMsg}"`,
            `git push origin "${branchName}" 2>&1`
          ];
          const result = spawnSync("bash", ["-c", cmds.join(" && ")], {
            cwd: h.REPO_ROOT, encoding: "utf8", timeout: 30000, env: process.env
          });

          if (result.stdout && result.stdout.includes("NO_CHANGES")) {
            // Switch back to previous branch
            spawnSync("git", ["checkout", "-"], { cwd: h.REPO_ROOT, encoding: "utf8" });
            spawnSync("git", ["branch", "-D", branchName], { cwd: h.REPO_ROOT, encoding: "utf8" });
            res.writeHead(200);
            res.end(JSON.stringify({ ok: false, error: "No uncommitted changes to push" }));
            return;
          }

          if (result.status !== 0) {
            // Cleanup: switch back
            spawnSync("git", ["checkout", "-"], { cwd: h.REPO_ROOT, encoding: "utf8" });
            res.writeHead(200);
            res.end(JSON.stringify({ ok: false, error: `git failed: ${(result.stderr || result.stdout || "").slice(0, 200)}` }));
            return;
          }

          // Try to create PR via GitHub API using git credential
          const prTitle = `[Agent] ${commitMsg}`;
          const prBody = `Automated fix by kaayko-api agent.\n\nTrack: ${track}\nFinding: ${title || "N/A"}`;
          const prResult = spawnSync("bash", ["-c",
            `curl -s -X POST -H "Accept: application/vnd.github+json" ` +
            `-H "Authorization: Bearer $(git credential fill <<< "protocol=https\nhost=github.com" 2>/dev/null | grep password | cut -d= -f2)" ` +
            `"https://api.github.com/repos/tommyvercetti76/kaayko-api/pulls" ` +
            `-d '${JSON.stringify({ title: prTitle, body: prBody, head: branchName, base: "main" }).replace(/'/g, "'\\''")}'`
          ], { cwd: h.REPO_ROOT, encoding: "utf8", timeout: 15000, env: process.env });

          let prUrl = null;
          try {
            const prData = JSON.parse(prResult.stdout || "{}");
            prUrl = prData.html_url || null;
          } catch { /* PR API may fail, branch is still pushed */ }

          // Switch back to main
          spawnSync("git", ["checkout", "-"], { cwd: h.REPO_ROOT, encoding: "utf8" });

          res.writeHead(200);
          res.end(JSON.stringify({
            ok: true, branch: branchName, pr_url: prUrl,
            message: prUrl ? `PR created: ${prUrl}` : `Branch pushed: ${branchName}. Create PR manually on GitHub.`
          }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }

    if (pathname === "/api/kill" && req.method === "POST") {
      if (!activeMission) {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: false, error: "No active mission to kill" }));
        return;
      }
      try {
        process.kill(activeMission.pid, "SIGTERM");
        const killed = { ...activeMission };
        activeMission = null;
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, killed }));
      } catch (error) {
        activeMission = null;
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, message: "Mission cleared (process already exited)" }));
      }
      return;
    }

    if (pathname === "/api/cleanup" && req.method === "POST") {
      try {
        const manifests = h.listRunManifests();
        const staleThreshold = 10 * 60 * 1000;
        const now = Date.now();
        let cleaned = 0;
        for (const { runDir, manifest } of manifests) {
          if (["agent_selecting", "agent_analyzing", "agent_editing", "agent_verifying"].includes(manifest.status)) {
            const updatedAt = new Date(manifest.updated_at).getTime();
            if (now - updatedAt > staleThreshold) {
              manifest.status = "agent_failed";
              manifest.updated_at = new Date().toISOString();
              manifest.agent = manifest.agent || {};
              manifest.agent.failure_reason = "Manually cleaned via /api/cleanup";
              h.writeJson(path.join(runDir, "manifest.json"), manifest);
              cleaned++;
            }
          }
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, cleaned }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    if (pathname === "/api/launch" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          // Concurrency guard
          if (activeMission) {
            const elapsed = Math.round((Date.now() - activeMission.startedAt) / 1000);
            res.writeHead(409);
            res.end(JSON.stringify({
              ok: false,
              error: `Mission already running: ${activeMission.area} (${elapsed}s)`,
              activeMission: { area: activeMission.area, goal: activeMission.goal.slice(0, 120), pid: activeMission.pid, elapsed }
            }));
            return;
          }

          const { area, goal, mode, goalMode } = JSON.parse(body);
          if (!goal) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: "goal is required" })); return; }

          const logFile = `launch-${Date.now()}.log`;
          const logPath = path.join(h.AUTOMATION_ROOT, "logs", logFile);
          h.ensureDir(path.dirname(logPath));

          const applyFlag = mode === "dry-run" ? "none" : (mode === "audit" ? "none" : "safe");
          const resolvedGoalMode = goalMode || (mode === "audit" ? "audit" : "edit");
          const child = spawn(
            "node",
            [path.join(h.SCRIPT_DIR, "portfolio-loop.js"), "agent", "--area", area || "shared", "--goal", goal, "--apply", applyFlag, "--goal-mode", resolvedGoalMode],
            { cwd: h.REPO_ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true }
          );

          activeMission = { area: area || "shared", goal, pid: child.pid, startedAt: Date.now() };

          const logStream = fs.createWriteStream(logPath, { flags: "a" });
          child.stdout.pipe(logStream);
          child.stderr.pipe(logStream);
          child.on("exit", (code) => {
            logStream.write(`\n[exit ${code}]\n`);
            logStream.end();
            if (activeMission && activeMission.pid === child.pid) {
              activeMission = null;
            }
          });
          child.unref();

          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, pid: child.pid, logFile }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }

    if (pathname.startsWith("/api/log/") && req.method === "GET") {
      const logName = pathname.replace("/api/log/", "").replace(/[^a-zA-Z0-9._-]/g, "");
      const logPath = path.join(h.AUTOMATION_ROOT, "logs", logName);
      if (!fs.existsSync(logPath)) { res.writeHead(404); res.end("Log not found."); return; }
      res.setHeader("Content-Type", "text/plain");
      res.writeHead(200);
      res.end(fs.readFileSync(logPath, "utf8"));
      return;
    }

    if (pathname === "/" && req.method === "GET") {
      const htmlPath = path.join(h.DASHBOARD_ROOT, "index.html");
      if (!fs.existsSync(htmlPath)) {
        dashboard.generateDashboard(config, {}, true);
      }
      res.setHeader("Content-Type", "text/html");
      res.writeHead(200);
      // Inject CSRF token into dashboard HTML so fetch calls can use it
      let html = fs.readFileSync(htmlPath, "utf8");
      html = html.replace("<script>", `<script>window.__CSRF_TOKEN="${csrfToken}";`);
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  });

  server.listen(port, host, () => {
    console.log(`\n  KAAYKO API \u2022 CONTROL SERVER\n`);
    console.log(`  Dashboard:  http://${host}:${port}`);
    console.log(`  Health:     http://${host}:${port}/api/health`);
    console.log(`  Models:     http://${host}:${port}/api/models`);
    console.log(`  Runs:       http://${host}:${port}/api/runs`);
    console.log(`  Launch:     POST http://${host}:${port}/api/launch`);
    console.log(`  CSRF Token: ${csrfToken}`);
    console.log(`\n  Press Ctrl+C to stop.\n`);

    // Initial dashboard generation
    try { dashboard.generateDashboard(config, {}, true); }
    catch (error) { console.error(`Dashboard generation failed: ${error.message}`); }
  });
}

// ── Main ────────────────────────────────────────────────────────

if (require.main === module) {
  main().catch((error) => {
    console.error(`Fatal: ${error.message}`);
    process.exit(1);
  });
} else {
  module.exports = {
    normalizeWorkerTask
  };
}
