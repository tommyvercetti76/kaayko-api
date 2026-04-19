"use strict";

const fs = require("fs");
const path = require("path");
const h = require("./loop-helpers");

// ── Dashboard Generation ────────────────────────────────────────

function generateDashboard(config, args = {}, silent = false) {
  const manifests = h.listRunManifests();
  const coachingConfig = h.loadAgentCoachingConfig();
  const runtimeConfig = h.loadOptionalJson(h.RUNTIME_CONFIG_PATH, { review_engine: {}, local_model_runtime: {} });
  const records = manifests
    .map(({ runDir, manifest }) => {
      const review = h.loadReview(runDir);
      const eligibility = h.computeTrainingEligibility(config, manifest, review);
      const metrics = h.computeRunMetrics(manifest);
      const coaching = h.resolveRunCoachingContext(manifest, coachingConfig);
      const openFindings = (review.findings || []).filter((finding) => {
        const status = String(finding.status || "open").toLowerCase();
        return status !== "resolved" && status !== "waived";
      });
      const suggestionFindings = openFindings.filter(h.isSuggestionFinding);
      const vulnerabilityFindings = openFindings.filter(h.isVulnerabilityFinding);
      const suggestionsCount =
        suggestionFindings.length + (Array.isArray(review.required_followups) ? review.required_followups.length : 0);
      const vulnerabilitiesCount = vulnerabilityFindings.length;
      const rejectedRewritesCount = Array.isArray(manifest.agent?.rejected_edits) ? manifest.agent.rejected_edits.length : 0;

      return {
        run_id: manifest.run_id,
        title: manifest.title,
        track: manifest.track,
        requested_area: manifest.requested_area || manifest.track,
        status: manifest.status,
        learnings_published_at: h.resolveLearningsPublishedAt(manifest),
        review_decision: review.decision,
        training_eligible: eligibility.eligible,
        training_reason: eligibility.reason,
        suggestions_count: suggestionsCount,
        vulnerabilities_count: vulnerabilitiesCount,
        rejected_rewrites_count: rejectedRewritesCount,
        accuracy_score: review.accuracy_score,
        maintainability_score: review.maintainability_score,
        confidence_score: review.confidence_score,
        changed_files_count: manifest.changed_files.length,
        total_churn: metrics.total_churn,
        updated_at: manifest.updated_at,
        created_at: manifest.created_at,
        changed_files: manifest.changed_files,
        quality_gates: manifest.quality_gates,
        findings: openFindings,
        suggestion_findings: suggestionFindings,
        vulnerability_findings: vulnerabilityFindings,
        required_followups: review.required_followups,
        guided_profile_ids: coaching.profile_ids,
        guided_products: coaching.guided_products,
        guided_products_count: coaching.guided_products.length,
        focused_profile_ids: coaching.focused_profile_ids,
        focused_products: coaching.focused_products,
        focused_products_count: coaching.focused_products.length,
        coached_products: coaching.guided_products,
        coached_products_count: coaching.guided_products.length,
        agent_model: manifest.agent?.model || (manifest.source === "agent" ? "configured-model" : null),
        agent_provider: manifest.agent?.provider || null,
        agent_goal_mode: manifest.agent?.goal_mode || "edit",
        agent_inspected_files_count: Array.isArray(manifest.agent?.selected_files) ? manifest.agent.selected_files.length : 0,
        agent_applied_files_count: Array.isArray(manifest.agent?.applied_files) ? manifest.agent.applied_files.length : 0,
        agent_selected_files: manifest.agent?.selected_files || [],
        agent_applied_files: manifest.agent?.applied_files || [],
        agent_applied_edits_detail: manifest.agent?.applied_edits_detail || [],
        agent_summary: manifest.agent?.summary || "",
        agent_verification: manifest.agent?.verification || null,
        coaching_source_docs: coaching.source_docs,
        coaching_doc_snapshots: coaching.doc_snapshots
      };
    })
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));

  const gateStats = {};
  const trackStats = {};
  const statusCounts = {};
  const reviewCounts = {};
  const openFindings = [];
  const suggestionFindings = [];
  const vulnerabilityFindings = [];
  const modelStats = {};
  const coachingCoverage = Object.entries(coachingConfig.profiles || {}).reduce((acc, [id, profile]) => {
    acc[id] = {
      id, name: profile.name, purpose: profile.purpose,
      source_docs: profile.source_docs || [],
      validation_focus: profile.validation_focus || [],
      risk_focus: profile.risk_focus || [],
      guided_runs: 0, focused_runs: 0, last_seen_at: null
    };
    return acc;
  }, {});
  let totalGateEvaluations = 0;
  let passedGateEvaluations = 0;
  let totalSuggestions = 0;
  let totalVulnerabilities = 0;
  let totalRejectedRewrites = 0;
  const guidedProductsSet = new Set();
  const focusedProductsSet = new Set();

  records.forEach((record) => {
    statusCounts[record.status] = (statusCounts[record.status] || 0) + 1;
    reviewCounts[record.review_decision] = (reviewCounts[record.review_decision] || 0) + 1;
    totalSuggestions += Number(record.suggestions_count || 0);
    totalVulnerabilities += Number(record.vulnerabilities_count || 0);
    totalRejectedRewrites += Number(record.rejected_rewrites_count || 0);
    (record.guided_products || []).forEach((product) => guidedProductsSet.add(product));
    (record.focused_products || []).forEach((product) => focusedProductsSet.add(product));
    (record.guided_profile_ids || []).forEach((profileId) => {
      if (!coachingCoverage[profileId]) return;
      coachingCoverage[profileId].guided_runs += 1;
      coachingCoverage[profileId].last_seen_at =
        !coachingCoverage[profileId].last_seen_at || coachingCoverage[profileId].last_seen_at < record.updated_at
          ? record.updated_at : coachingCoverage[profileId].last_seen_at;
    });
    (record.focused_profile_ids || []).forEach((profileId) => {
      if (!coachingCoverage[profileId]) return;
      coachingCoverage[profileId].focused_runs += 1;
      coachingCoverage[profileId].last_seen_at =
        !coachingCoverage[profileId].last_seen_at || coachingCoverage[profileId].last_seen_at < record.updated_at
          ? record.updated_at : coachingCoverage[profileId].last_seen_at;
    });

    if (!trackStats[record.track]) {
      trackStats[record.track] = {
        runs: 0, approved: 0, training_eligible: 0, learnings_published: 0,
        suggestions: 0, vulnerabilities: 0, accuracy_total: 0, maintainability_total: 0
      };
    }
    trackStats[record.track].runs += 1;
    trackStats[record.track].accuracy_total += Number(record.accuracy_score || 0);
    trackStats[record.track].maintainability_total += Number(record.maintainability_score || 0);
    trackStats[record.track].suggestions += Number(record.suggestions_count || 0);
    trackStats[record.track].vulnerabilities += Number(record.vulnerabilities_count || 0);
    if (record.review_decision === "approved") trackStats[record.track].approved += 1;
    if (record.training_eligible) trackStats[record.track].training_eligible += 1;
    if (record.learnings_published_at) trackStats[record.track].learnings_published += 1;

    const modelKey = record.agent_model || "heuristic";
    if (!modelStats[modelKey]) {
      modelStats[modelKey] = { model: modelKey, runs: 0, suggestions: 0, vulnerabilities: 0, applied_edits: 0, rejected_rewrites: 0 };
    }
    modelStats[modelKey].runs += 1;
    modelStats[modelKey].suggestions += Number(record.suggestions_count || 0);
    modelStats[modelKey].vulnerabilities += Number(record.vulnerabilities_count || 0);
    modelStats[modelKey].applied_edits += Number(record.agent_applied_files_count || 0);
    modelStats[modelKey].rejected_rewrites += Number(record.rejected_rewrites_count || 0);

    record.quality_gates.forEach((gate) => {
      if (!gateStats[gate.id]) {
        gateStats[gate.id] = { id: gate.id, label: gate.label, total: 0, passed: 0, failed: 0, blocked: 0 };
      }
      gateStats[gate.id].total += 1;
      totalGateEvaluations += 1;
      if (gate.status === "passed") { gateStats[gate.id].passed += 1; passedGateEvaluations += 1; }
      if (gate.status === "failed") gateStats[gate.id].failed += 1;
      if (gate.status === "blocked") gateStats[gate.id].blocked += 1;
    });

    record.findings.forEach((finding) => {
      const normalizedFinding = {
        run_id: record.run_id, track: record.track,
        severity: finding.severity || "unknown",
        title: finding.title || "Untitled finding",
        detail: finding.detail || "",
        category: finding.category || "maintainability",
        requested_area: record.requested_area,
        model: record.agent_model || "heuristic",
        line_refs: Array.isArray(finding.line_refs) ? finding.line_refs : [],
        file_paths: Array.isArray(finding.file_paths) ? finding.file_paths : []
      };
      openFindings.push(normalizedFinding);
      if (h.isVulnerabilityFinding(finding)) vulnerabilityFindings.push(normalizedFinding);
      else if (h.isSuggestionFinding(finding)) suggestionFindings.push(normalizedFinding);
    });
  });

  const trackSummary = Object.entries(trackStats)
    .map(([track, stats]) => ({
      track, runs: stats.runs, approved: stats.approved,
      training_eligible: stats.training_eligible,
      learnings_published: stats.learnings_published,
      suggestions: stats.suggestions, vulnerabilities: stats.vulnerabilities,
      average_accuracy: stats.runs ? h.roundNumber(stats.accuracy_total / stats.runs) : 0,
      average_maintainability: stats.runs ? h.roundNumber(stats.maintainability_total / stats.runs) : 0
    }))
    .sort((left, right) => left.track.localeCompare(right.track));

  const summary = {
    generated_at: new Date().toISOString(),
    totals: {
      runs: records.length,
      learnings_published: records.filter((r) => r.learnings_published_at).length,
      approved: records.filter((r) => r.review_decision === "approved").length,
      training_eligible: records.filter((r) => r.training_eligible).length,
      suggestions: totalSuggestions,
      vulnerabilities: totalVulnerabilities,
      rejected_rewrites: totalRejectedRewrites,
      coached_products: guidedProductsSet.size,
      focused_products: focusedProductsSet.size,
      portfolio_profiles: Object.keys(coachingCoverage).length,
      agent_runs: records.filter((r) => r.agent_model).length,
      capture_failures: records.filter((r) => r.status === "capture_failed").length,
      gate_pass_rate: totalGateEvaluations ? h.roundNumber((passedGateEvaluations / totalGateEvaluations) * 100) : 0
    },
    status_counts: statusCounts,
    review_counts: reviewCounts,
    queue_counts: h.queueStatusCounts(),
    runtime: {
      review_engine_mode: runtimeConfig.review_engine?.mode || "unknown",
      provider: runtimeConfig.local_model_runtime?.provider || "unknown",
      model: runtimeConfig.local_model_runtime?.model || "unset"
    },
    model_roster: buildModelRoster(runtimeConfig),
    tracks: trackSummary,
    models: Object.values(modelStats).sort((left, right) => left.model.localeCompare(right.model)),
    coaching: {
      portfolio_overview: coachingConfig.portfolio_overview || "",
      guided_products: Array.from(guidedProductsSet).sort(),
      focused_products: Array.from(focusedProductsSet).sort(),
      profiles: Object.entries(coachingConfig.profiles || {})
        .map(([id, profile]) => ({
          id, name: profile.name, purpose: profile.purpose,
          source_docs: profile.source_docs || [],
          validation_focus: profile.validation_focus || [],
          risk_focus: profile.risk_focus || [],
          keywords: profile.keywords || [],
          guided_runs: coachingCoverage[id]?.guided_runs || 0,
          focused_runs: coachingCoverage[id]?.focused_runs || 0,
          last_seen_at: coachingCoverage[id]?.last_seen_at || null
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    },
    gates: Object.values(gateStats).sort((left, right) => left.label.localeCompare(right.label)),
    recent_runs: records.slice(0, 20),
    latest_agent_run: records.find((r) => r.agent_model) || null,
    suggestion_findings: suggestionFindings.sort((l, r) => h.severityRank(l.severity) - h.severityRank(r.severity)).slice(0, 12),
    vulnerability_findings: vulnerabilityFindings.sort((l, r) => h.severityRank(l.severity) - h.severityRank(r.severity)).slice(0, 12),
    open_findings: openFindings.sort((l, r) => h.severityRank(l.severity) - h.severityRank(r.severity)).slice(0, 25)
  };

  const summaryPath = path.join(h.DASHBOARD_ROOT, "summary.json");
  const runsPath = path.join(h.DASHBOARD_ROOT, "runs.json");
  const markdownPath = path.join(h.DASHBOARD_ROOT, "latest.md");
  const htmlPath = path.join(h.DASHBOARD_ROOT, "index.html");

  h.ensureDir(h.DASHBOARD_ROOT);
  h.writeJson(summaryPath, summary);
  h.writeJson(runsPath, { generated_at: summary.generated_at, runs: records });
  h.writeText(markdownPath, buildDashboardMarkdown(summary));
  h.writeText(htmlPath, buildDashboardHtml(summary));

  if (!silent && !h.resolveBooleanArg(args.silent, false)) {
    console.log(`Dashboard refreshed at ${h.relativeToRepo(htmlPath)}`);
    console.log(`- Summary JSON: ${h.relativeToRepo(summaryPath)}`);
    console.log(`- Runs JSON: ${h.relativeToRepo(runsPath)}`);
    console.log(`- Markdown: ${h.relativeToRepo(markdownPath)}`);
  }

  return {
    summary,
    files: {
      html: h.relativeToRepo(htmlPath),
      summary: h.relativeToRepo(summaryPath),
      runs: h.relativeToRepo(runsPath),
      markdown: h.relativeToRepo(markdownPath)
    }
  };
}

function buildModelRoster(runtimeConfig) {
  const runtime = runtimeConfig.local_model_runtime || {};
  const recommended = (runtimeConfig.recommended_models || []).map((m) => ({
    id: m.id, name: m.label || m.id, note: m.fit || "", provider: m.provider || "ollama"
  }));

  let installedModels = [];
  try {
    const tags = h.fetchOllamaTags(runtime, 5000);
    installedModels = tags.map((t) => ({
      id: t.name || t.model,
      size: t.size ? `${(t.size / (1024 * 1024 * 1024)).toFixed(1)} GB` : "?",
      modified: t.modified_at || ""
    }));
  } catch { /* Ollama not running */ }

  const installedIds = new Set(installedModels.map((m) => m.id));
  const roster = [];

  for (const rec of recommended) {
    const installed = installedModels.find((m) => m.id === rec.id);
    roster.push({
      id: rec.id, name: rec.name, note: rec.note,
      installed: installedIds.has(rec.id),
      size: installed ? installed.size : "",
      active: rec.id === runtime.model,
      source: "recommended"
    });
  }

  const recommendedIds = new Set(recommended.map((m) => m.id));
  for (const inst of installedModels) {
    if (!recommendedIds.has(inst.id)) {
      roster.push({
        id: inst.id, name: inst.id, note: "Locally installed",
        installed: true, size: inst.size,
        active: inst.id === runtime.model,
        source: "local"
      });
    }
  }
  return roster;
}

// ── Dashboard Markdown ──────────────────────────────────────────

function buildDashboardMarkdown(summary) {
  const tracks = summary.tracks.length
    ? summary.tracks.map((t) =>
        `- ${t.track}: ${t.runs} runs, ${t.approved} approved, ${t.training_eligible} gold, ${t.suggestions} suggestions, ${t.vulnerabilities} vulnerabilities, avg accuracy ${t.average_accuracy}`
      ).join("\n")
    : "- No runs yet.";
  const models = summary.models.length
    ? summary.models.map((m) =>
        `- ${m.model}: ${m.runs} runs, ${m.suggestions} suggestions, ${m.vulnerabilities} vulnerabilities, ${m.applied_edits} applied edits, ${m.rejected_rewrites} rejected rewrites`
      ).join("\n")
    : "- No model-backed runs yet.";
  const coaching = summary.coaching.profiles.length
    ? summary.coaching.profiles.map((p) =>
        `- ${p.name}: guided in ${p.guided_runs} run(s), primary focus in ${p.focused_runs} run(s). ${p.purpose}`
      ).join("\n")
    : "- No coaching profiles configured.";
  const latestAgent = summary.latest_agent_run
    ? [
        `- Run: ${summary.latest_agent_run.run_id}`,
        `- Model: ${summary.latest_agent_run.agent_provider || "unknown"} / ${summary.latest_agent_run.agent_model || "heuristic"}`,
        `- Area: ${summary.latest_agent_run.requested_area || summary.latest_agent_run.track}`,
        `- Guided products: ${summary.latest_agent_run.guided_products.length ? summary.latest_agent_run.guided_products.join(", ") : "None"}`,
        `- Primary focus: ${summary.latest_agent_run.focused_products.length ? summary.latest_agent_run.focused_products.join(", ") : "None"}`,
        `- Files inspected: ${summary.latest_agent_run.agent_inspected_files_count}`,
        `- Safe edits applied: ${summary.latest_agent_run.agent_applied_files_count}`,
        `- Summary: ${summary.latest_agent_run.agent_summary || "No agent summary recorded."}`
      ].join("\n")
    : "- No model-backed runs yet.";
  const recentRuns = summary.recent_runs.length
    ? summary.recent_runs.map((run) =>
        `- ${run.run_id} | ${run.track}/${run.requested_area} | ${run.status} | ${run.review_decision} | focus=${run.focused_products.length ? run.focused_products.join(", ") : "none"} | suggestions=${run.suggestions_count} | vulnerabilities=${run.vulnerabilities_count} | eligible=${run.training_eligible}`
      ).join("\n")
    : "- No runs yet.";
  const suggestionBoard = summary.suggestion_findings.length
    ? summary.suggestion_findings.map((f) => `- [${f.severity}] ${f.track}/${f.requested_area} ${f.run_id}: ${f.title}`).join("\n")
    : "- No suggestion findings were recorded.";
  const vulnerabilityBoard = summary.vulnerability_findings.length
    ? summary.vulnerability_findings.map((f) => `- [${f.severity}] ${f.track}/${f.requested_area} ${f.run_id}: ${f.title}`).join("\n")
    : "- No vulnerability findings were recorded.";
  const findings = summary.open_findings.length
    ? summary.open_findings.map((f) => `- [${f.severity}] ${f.track} ${f.run_id}: ${f.title}`).join("\n")
    : "- No open findings.";

  return `# Kaayko API \u2014 Local Model Loop Dashboard

- Generated at: ${summary.generated_at}
- Total runs: ${summary.totals.runs}
- Learnings snapshots: ${summary.totals.learnings_published}
- Approved runs: ${summary.totals.approved}
- Training-eligible runs: ${summary.totals.training_eligible}
- Suggestions surfaced: ${summary.totals.suggestions}
- Vulnerabilities surfaced: ${summary.totals.vulnerabilities}
- Rejected rewrites: ${summary.totals.rejected_rewrites}
- Guided products across runs: ${summary.totals.coached_products}
- Primary-focus products across runs: ${summary.totals.focused_products}
- Portfolio profiles configured: ${summary.totals.portfolio_profiles}
- Engine: ${summary.runtime.review_engine_mode} (${summary.runtime.provider} / ${summary.runtime.model})
- Gate pass rate: ${summary.totals.gate_pass_rate}%

## Queue

- Pending: ${summary.queue_counts.pending}
- Processing: ${summary.queue_counts.processing}
- Done: ${summary.queue_counts.done}
- Failed: ${summary.queue_counts.failed}

## Tracks

${tracks}

## Model Signal

${models}

## Portfolio Coaching

${coaching}

## Latest Agent Run

${latestAgent}

## Suggestion Board

${suggestionBoard}

## Vulnerability Board

${vulnerabilityBoard}

## Recent Runs

${recentRuns}

## Top Open Findings

${findings}
`;
}

// ── Dashboard HTML ──────────────────────────────────────────────

function buildDashboardHtml(summary) {
  const esc = h.escapeHtml;
  const modules = [
    { key: "1", area: "weather", name: "WEATHER", desc: "Forecast, paddle score, nearby water, cache", icon: "\ud83c\udf0a" },
    { key: "2", area: "commerce", name: "COMMERCE", desc: "Products, checkout, payments, Stripe", icon: "\ud83d\uded2" },
    { key: "3", area: "kortex", name: "KORTEX", desc: "Smart links, tenant auth, billing, analytics", icon: "\ud83d\udd17" },
    { key: "4", area: "kreator", name: "KREATOR", desc: "Creator onboarding, admin review", icon: "\ud83c\udfa8" },
    { key: "5", area: "kamera", name: "KAMERA", desc: "Camera catalog, lenses, presets", icon: "\ud83d\udcf7" },
    { key: "6", area: "kutz", name: "KUTZ", desc: "Nutrition, meals, food search, Fitbit", icon: "\ud83c\udf4e" },
    { key: "7", area: "shared", name: "SHARED", desc: "Middleware, auth, error handling, CORS", icon: "\u2699\ufe0f" }
  ];
  const recommended = [
    { id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B", note: "Fast local iteration", ram: "~5 GB" },
    { id: "qwen2.5-coder:14b", name: "Qwen 2.5 Coder 14B", note: "Best default for local coding", ram: "~9 GB" },
    { id: "qwen2.5-coder:32b", name: "Qwen 2.5 Coder 32B", note: "Higher quality if memory allows", ram: "~20 GB" },
    { id: "qwen3:8b", name: "Qwen 3 8B", note: "Balanced general reasoning", ram: "~5 GB" },
    { id: "deepseek-coder-v2:16b", name: "DeepSeek Coder V2 16B", note: "Strong code review & refactor", ram: "~10 GB" },
    { id: "llama3.1:8b", name: "Llama 3.1 8B", note: "General fallback", ram: "~5 GB" }
  ];
  const defaultArea = (summary.latest_agent_run && (summary.latest_agent_run.requested_area || summary.latest_agent_run.track)) || "shared";
  const selectedModule = modules.find((m) => m.area === defaultArea) || modules.find((m) => m.area === "shared") || modules[0];
  const defaultLaunchMode = "audit";
  const launchModes = [
    { id: "audit", label: "Audit", desc: "Read-only review with findings" },
    { id: "edit", label: "Edit", desc: "Propose and apply code fixes" },
    { id: "dry-run", label: "Dry Run", desc: "Plan changes without editing files" }
  ];
  const missionPresets = [
    { label: "Security audit", goal: "Audit auth and access control gaps", mode: "audit" },
    { label: "Fix failing tests", goal: "Investigate the current failing tests and fix the root cause", mode: "edit" },
    { label: "Review approval blockers", goal: "Review the latest failing quality gates and explain what blocks approval", mode: "audit" },
    { label: "Safe cleanup", goal: "Look for low-risk cleanup opportunities and summarize them before editing", mode: "dry-run" }
  ];
  const roster = summary.model_roster || [];
  const statusIcon = (s) => {
    if (s === "approved" || s === "reviewed") return "\u2705";
    if (s === "rejected" || s === "rolled_back") return "\u274c";
    if (s === "pending_review" || s === "agent_applied") return "\ud83d\udfe1";
    if (s === "changes_requested") return "\ud83d\udfe0";
    if (s === "agent_failed" || s === "capture_failed") return "\ud83d\udd34";
    return "\u2b1c";
  };

  const moduleCards = modules.map((m) => {
    const trackData = summary.tracks.find((t) => t.track === m.area) || {};
    const selected = m.area === selectedModule.area;
    return `<button class="mod-card${selected ? " selected" : ""}" type="button" data-area="${esc(m.area)}" data-name="${esc(m.name)}" data-desc="${esc(m.desc)}" aria-pressed="${selected ? "true" : "false"}">
      <div class="mod-icon">${m.icon}</div>
      <div class="mod-info">
        <div class="mod-key">[${m.key}]</div>
        <div class="mod-name">${esc(m.name)}</div>
        <div class="mod-desc">${esc(m.desc)}</div>
        <div class="mod-stats">${trackData.runs || 0} runs \u00b7 ${trackData.approved || 0} approved \u00b7 ${trackData.suggestions || 0} suggestions</div>
        <div class="mod-hint">${selected ? "Selected for launch" : "Use this module"}</div>
      </div>
    </button>`;
  }).join("");

  const modeButtons = launchModes.map((mode) => {
    const selected = mode.id === defaultLaunchMode;
    return `<button class="mode-card${selected ? " selected" : ""}" type="button" data-mode="${esc(mode.id)}" aria-pressed="${selected ? "true" : "false"}">
      <strong>${esc(mode.label)}</strong>
      <span>${esc(mode.desc)}</span>
    </button>`;
  }).join("");

  const presetButtons = missionPresets.map((preset) => {
    return `<button class="preset-btn" type="button" data-goal="${esc(preset.goal)}" data-mode="${esc(preset.mode)}">${esc(preset.label)}</button>`;
  }).join("");

  const modelRows = (roster.length ? roster : recommended.map((m) => ({ ...m, installed: false, active: summary.runtime.model === m.id, size: m.ram, source: "recommended" }))).map((m) => {
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

  const recentRows = summary.recent_runs.slice(0, 15).map((run, idx) => {
    const findingsList = (run.suggestion_findings || []).concat(run.vulnerability_findings || []);
    const inspected = run.agent_selected_files || [];
    const applied = run.agent_applied_files || [];
    const detailId = `run-detail-${idx}`;
    const findingsHtml = findingsList.length
      ? findingsList.map((f) => `<div class="detail-finding"><span class="sev sev-${esc(f.severity || "info")}">${esc(f.severity || "info")}</span> <b>${esc(f.title)}</b><br/><span class="detail-text">${esc(f.detail || "")}</span></div>`).join("")
      : `<span class="detail-text">No findings.</span>`;
    const inspectedHtml = inspected.length
      ? `<div class="detail-section"><b>Inspected Files (${inspected.length}):</b><div class="detail-files">${inspected.map((f) => `<code>${esc(typeof f === "string" ? f : f.path || f.relative_path || String(f))}</code>`).join(" ")}</div></div>`
      : "";
    const appliedHtml = applied.length
      ? `<div class="detail-section"><b>Edited Files (${applied.length}):</b><div class="detail-files">${applied.map((f) => `<code class="applied-file">${esc(typeof f === "string" ? f : f.path || String(f))}</code>`).join(" ")}</div></div>`
      : "";
    const filesCol = applied.length
      ? `<span style="color:var(--green)">${applied.length} edited</span>`
      : (inspected.length ? `${inspected.length} inspected` : "\u2014");
    return `<tr class="run-row" onclick="toggleDetail('${detailId}')">
      <td><span class="status-badge s-${esc(run.status.replace(/_/g, "-"))}">${statusIcon(run.status)} ${esc(run.status)}</span></td>
      <td>${esc(run.requested_area || run.track)}</td>
      <td class="mono">${esc(run.run_id.slice(0, 24))}\u2026</td>
      <td>${filesCol}</td>
      <td>${run.suggestions_count + run.vulnerabilities_count}</td>
      <td>${esc(run.agent_model || "heuristic")}${run.agent_goal_mode === "audit" ? ' <span class="chip" style="font-size:0.65rem;padding:1px 4px;vertical-align:middle">AUDIT</span>' : ""}</td>
    </tr>
    <tr class="detail-row" id="${detailId}" style="display:none">
      <td colspan="6">
        <div class="detail-panel">
          <div class="detail-summary">${esc(run.agent_summary || run.title || "")}</div>
          <div class="detail-section"><b>Findings (${findingsList.length}):</b>${findingsHtml}</div>
          ${appliedHtml}
          ${inspectedHtml}
        </div>
      </td>
    </tr>`;
  }).join("");

  const latestAgent = summary.recent_runs.find((r) => r.agent_model && r.status !== "agent_failed" && r.status !== "capture_failed") || summary.latest_agent_run;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KAAYKO API \u2022 Automation Engine</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap');
  :root{--bg:#0a0e14;--surface:#111820;--surface2:#172030;--border:#1e2d3d;--border-hi:#2a4060;--text:#c8d6e5;--text-dim:#6b7f94;--text-bright:#e8f0f8;--cyan:#22d3ee;--green:#34d399;--amber:#f59e0b;--red:#ef4444;--purple:#a78bfa;--blue:#60a5fa;--cyan-glow:rgba(34,211,238,0.15);--green-glow:rgba(52,211,153,0.1);--mono:'JetBrains Mono','Fira Code','Cascadia Code',monospace;--sans:'Inter',-apple-system,'Segoe UI',sans-serif}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);min-height:100vh;background-image:radial-gradient(ellipse at 20% 0%,rgba(34,211,238,0.06) 0%,transparent 50%),radial-gradient(ellipse at 80% 100%,rgba(167,139,250,0.04) 0%,transparent 50%)}
  .header{border-bottom:1px solid var(--border);padding:24px 32px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}
  .header h1{font-family:var(--mono);font-size:1.4rem;font-weight:700;color:var(--cyan);letter-spacing:.08em;text-shadow:0 0 20px rgba(34,211,238,0.3)}
  .header h1 span{color:var(--text-dim);font-weight:400}
  .header-meta{display:flex;gap:16px;align-items:center}
  .engine-badge{font-family:var(--mono);font-size:.78rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 12px;color:var(--text-dim)}
  .engine-badge b{color:var(--green)}
  .dash{max-width:1440px;margin:0 auto;padding:24px 28px 48px}
  .row{display:grid;gap:20px;margin-bottom:20px}
  .row-2{grid-template-columns:1fr 1fr}
  .row-3{grid-template-columns:1fr 1fr 1fr}
  @media(max-width:960px){.row-2,.row-3{grid-template-columns:1fr}}
  .panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;overflow:hidden}
  .panel h2{font-family:var(--mono);font-size:.85rem;font-weight:600;color:var(--cyan);letter-spacing:.06em;text-transform:uppercase;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border)}
  .panel h2::before{content:"\\25b8 ";color:var(--text-dim)}
  .panel.highlight{border-color:var(--cyan);box-shadow:0 0 30px rgba(34,211,238,0.08)}
  .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
  .stat-card{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;transition:border-color .2s}
  .stat-card:hover{border-color:var(--border-hi)}
  .stat-card .stat-val{font-family:var(--mono);font-size:2rem;font-weight:700;color:var(--text-bright);display:block;line-height:1.1}
  .stat-card .stat-label{font-size:.75rem;color:var(--text-dim);margin-top:4px;display:block;text-transform:uppercase;letter-spacing:.04em}
  .stat-card.glow-cyan .stat-val{color:var(--cyan)}.stat-card.glow-green .stat-val{color:var(--green)}.stat-card.glow-amber .stat-val{color:var(--amber)}.stat-card.glow-red .stat-val{color:var(--red)}
  .panel-lead{color:var(--text-dim);font-size:.92rem;line-height:1.6;margin-bottom:16px}
  .mod-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
  .mod-card{appearance:none;width:100%;text-align:left;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;display:flex;gap:14px;cursor:pointer;transition:border-color .2s,box-shadow .2s,transform .2s;color:inherit}
  .mod-card:hover{border-color:var(--cyan);box-shadow:0 0 20px rgba(34,211,238,0.08)}
  .mod-card:focus-visible{outline:3px solid rgba(34,211,238,0.2);outline-offset:2px}
  .mod-card.selected{border-color:var(--cyan);background:rgba(34,211,238,0.06);box-shadow:0 0 20px rgba(34,211,238,0.12);transform:translateY(-1px)}
  .mod-icon{font-size:1.8rem;line-height:1}
  .mod-key{font-family:var(--mono);font-size:.7rem;color:var(--cyan);background:rgba(34,211,238,0.1);border-radius:4px;padding:2px 6px;display:inline-block;margin-bottom:4px}
  .mod-name{font-weight:700;font-size:.92rem;color:var(--text-bright)}.mod-desc{font-size:.78rem;color:var(--text-dim);margin-top:2px}
  .mod-stats{font-family:var(--mono);font-size:.7rem;color:var(--text-dim);margin-top:6px}
  .mod-hint{font-family:var(--mono);font-size:.68rem;color:var(--cyan);margin-top:8px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:8px 10px;font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);font-family:var(--mono)}
  td{padding:8px 10px;font-size:.82rem;border-bottom:1px solid rgba(30,45,61,0.5);vertical-align:middle}
  tr:hover td{background:rgba(34,211,238,0.03)}
  .mono{font-family:var(--mono);font-size:.76rem}.empty{color:var(--text-dim);font-style:italic;text-align:center;padding:20px}
  .status-badge{font-family:var(--mono);font-size:.7rem;padding:3px 8px;border-radius:4px;display:inline-block;font-weight:600}
  .s-approved,.s-reviewed{background:rgba(52,211,153,0.15);color:var(--green)}
  .s-pending-review,.s-agent-applied{background:rgba(96,165,250,0.15);color:var(--blue)}
  .s-changes-requested{background:rgba(245,158,11,0.15);color:var(--amber)}
  .s-rejected,.s-rolled-back{background:rgba(239,68,68,0.15);color:var(--red)}
  .s-agent-failed,.s-capture-failed{background:rgba(239,68,68,0.1);color:var(--red)}
  .active-model td{background:rgba(52,211,153,0.06)}.active-model code{color:var(--green)}
  .sev{font-family:var(--mono);font-size:.7rem;padding:2px 6px;border-radius:3px;font-weight:600}
  .sev-critical,.sev-blocking{background:rgba(239,68,68,0.2);color:var(--red)}
  .sev-high,.sev-major{background:rgba(245,158,11,0.2);color:var(--amber)}
  .sev-medium,.sev-moderate{background:rgba(96,165,250,0.15);color:var(--blue)}
  .sev-low,.sev-minor,.sev-info{background:rgba(107,127,148,0.15);color:var(--text-dim)}
  .vuln-row td{border-left:3px solid var(--red)}
  .bar-bg{background:var(--surface);border-radius:4px;height:8px;overflow:hidden;min-width:80px}.bar-fill{background:var(--green);height:100%;border-radius:4px;transition:width .3s}
  code{font-family:var(--mono);font-size:.78rem;color:var(--cyan);background:rgba(34,211,238,0.08);padding:2px 6px;border-radius:4px}
  .cmd-copy{cursor:pointer;transition:background .2s}.cmd-copy:hover{background:rgba(34,211,238,0.2)}
  details.panel{padding:0}
  details.panel>summary{cursor:pointer;list-style:none;padding:20px;user-select:none}
  details.panel>summary::-webkit-details-marker{display:none}
  details.panel>summary h2{margin-bottom:0;padding-bottom:0;border-bottom:none;display:inline}
  details.panel>summary::after{content:"\\25bc";float:right;color:var(--text-dim);font-size:.7rem;margin-top:4px;transition:transform .2s}
  details.panel:not([open])>summary::after{transform:rotate(-90deg)}
  details.panel[open]>*:not(summary){padding:0 20px 20px}
  details.panel[open]>summary{border-bottom:1px solid var(--border);margin-bottom:12px}
  .section-toggle{display:flex;align-items:center}
  .finding-card{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;margin:10px 0;transition:border-color .2s}
  .finding-card:hover{border-color:var(--border-hi)}
  .finding-header{display:flex;align-items:center;gap:10px;margin-bottom:8px}
  .finding-title{font-weight:600;font-size:.88rem;color:var(--text-bright);flex:1}
  .finding-detail{font-size:.82rem;color:var(--text-dim);line-height:1.6;margin-bottom:10px}
  .finding-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:.76rem}
  .finding-meta code{font-size:.72rem}
  .implement-btn{background:rgba(52,211,153,0.12);border:1px solid var(--green);color:var(--green);border-radius:6px;padding:6px 14px;font-family:var(--mono);font-size:.74rem;cursor:pointer;font-weight:600;transition:all .2s}
  .implement-btn:hover{background:rgba(52,211,153,0.25)}
  .implement-btn:disabled{opacity:.4;cursor:wait}
  .pr-btn{background:rgba(167,139,250,0.12);border:1px solid var(--purple);color:var(--purple);border-radius:6px;padding:6px 14px;font-family:var(--mono);font-size:.74rem;cursor:pointer;font-weight:600;transition:all .2s}
  .pr-btn:hover{background:rgba(167,139,250,0.25)}
  .pr-btn:disabled{opacity:.4;cursor:wait}
  .finding-status{font-family:var(--mono);font-size:.72rem;padding:2px 8px;border-radius:4px;margin-left:8px}
  .finding-refs{margin:4px 0 6px 0;display:flex;flex-wrap:wrap;gap:4px}
  .finding-refs code{font-size:.7rem;background:rgba(99,102,241,0.15);color:var(--indigo,#818cf8);padding:1px 6px;border-radius:3px}
  .finding-status.implementing{background:rgba(245,158,11,0.15);color:var(--amber)}
  .finding-status.done{background:rgba(52,211,153,0.15);color:var(--green)}
  .finding-status.error{background:rgba(239,68,68,0.15);color:var(--red)}
  .queue-bar{display:flex;gap:14px;flex-wrap:wrap}
  .q-item{font-family:var(--mono);font-size:.82rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 16px}
  .q-item b{color:var(--text-bright)}
  .agent-summary{font-size:.85rem;color:var(--text);line-height:1.6;margin:10px 0}
  .agent-meta{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
  .footer{text-align:center;padding:32px;color:var(--text-dim);font-family:var(--mono);font-size:.72rem;border-top:1px solid var(--border);margin-top:32px}
  .launchpad-panel{padding-bottom:24px}
  .step-pill-row{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
  .step-pill{font-family:var(--mono);font-size:.72rem;color:var(--text-dim);background:rgba(107,127,148,0.1);border:1px solid rgba(107,127,148,0.15);border-radius:999px;padding:7px 12px}
  .step-pill.active{color:var(--cyan);border-color:rgba(34,211,238,0.35);background:rgba(34,211,238,0.1)}
  .selected-module{display:grid;gap:4px;background:linear-gradient(135deg,rgba(34,211,238,0.08),rgba(96,165,250,0.05));border:1px solid rgba(34,211,238,0.18);border-radius:12px;padding:16px 18px;margin-bottom:16px}
  .selected-module-label{font-family:var(--mono);font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;color:var(--cyan)}
  .selected-module strong{font-size:1.05rem;color:var(--text-bright)}
  .selected-module span{font-size:.84rem;color:var(--text-dim)}
  .selected-module .selected-module-status{margin-top:6px;font-family:var(--mono);font-size:.76rem}
  .mod-grid-launch{margin-bottom:18px}
  .launch-form{display:grid;gap:14px;max-width:860px}
  .launch-row{display:flex;align-items:center;gap:12px}
  .launch-row label{font-family:var(--mono);font-size:.78rem;color:var(--text-dim);min-width:78px;text-transform:uppercase;letter-spacing:.04em}
  .launch-row select,.launch-row input{flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 14px;color:var(--text-bright);font-family:var(--mono);font-size:.82rem;outline:none;transition:border-color .2s}
  .launch-row select:focus,.launch-row input:focus{border-color:var(--cyan)}
  .launch-row select option{background:var(--surface)}
  .launch-row-stack{align-items:flex-start}
  .mode-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;flex:1}
  .mode-card{appearance:none;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:left;cursor:pointer;transition:border-color .2s,box-shadow .2s,transform .2s;color:inherit}
  .mode-card strong{display:block;font-family:var(--mono);font-size:.78rem;color:var(--text-bright);margin-bottom:6px}
  .mode-card span{display:block;font-size:.78rem;color:var(--text-dim);line-height:1.45}
  .mode-card:hover{border-color:var(--cyan)}
  .mode-card:focus-visible{outline:3px solid rgba(34,211,238,0.2);outline-offset:2px}
  .mode-card.selected{border-color:var(--cyan);background:rgba(34,211,238,0.08);box-shadow:0 0 20px rgba(34,211,238,0.08);transform:translateY(-1px)}
  .launch-presets{display:grid;gap:8px}
  .launch-presets-label{font-family:var(--mono);font-size:.74rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em}
  .preset-row{display:flex;flex-wrap:wrap;gap:10px}
  .preset-btn{appearance:none;background:rgba(107,127,148,0.08);border:1px solid rgba(107,127,148,0.15);border-radius:999px;padding:9px 12px;font-family:var(--mono);font-size:.76rem;color:var(--text);cursor:pointer;transition:border-color .2s,background .2s,color .2s}
  .preset-btn:hover{border-color:rgba(34,211,238,0.28);background:rgba(34,211,238,0.08);color:var(--text-bright)}
  .preset-btn:focus-visible{outline:3px solid rgba(34,211,238,0.2);outline-offset:2px}
  #lp-launch{background:var(--cyan);color:var(--bg);border:none;border-radius:6px;padding:10px 24px;font-family:var(--mono);font-size:.82rem;font-weight:700;cursor:pointer;letter-spacing:.06em;transition:opacity .2s}
  #lp-launch:hover{opacity:.85}#lp-launch:disabled{opacity:.4;cursor:not-allowed}
  .launch-status{font-family:var(--mono);font-size:.78rem;color:var(--text-dim)}
  .launch-row-actions{align-items:center}
  .launch-log-area{margin-top:16px}
  .launch-log{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;max-height:300px;overflow-y:auto;font-size:.76rem;line-height:1.5;color:var(--text);font-family:var(--mono);white-space:pre-wrap}
  .model-btn{background:transparent;border:1px solid var(--border);color:var(--cyan);border-radius:4px;padding:4px 10px;font-family:var(--mono);font-size:.72rem;cursor:pointer;transition:all .2s}
  .model-btn:hover{border-color:var(--cyan);background:rgba(34,211,238,0.1)}
  .model-btn.active{background:rgba(52,211,153,0.15);border-color:var(--green);color:var(--green);cursor:default}
  .model-btn.pull-btn{border-color:var(--amber);color:var(--amber)}
  .model-btn.pull-btn:hover{background:rgba(251,191,36,0.1)}
  .model-btn:disabled{opacity:.5;cursor:wait}
  .detail-edit{padding:4px 8px;margin:4px 0;font-size:.78rem;border-left:2px solid var(--green)}
  .applied-file{background:rgba(52,211,153,0.12);border-color:var(--green)}
  .server-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
  .server-dot.online{background:var(--green);box-shadow:0 0 6px var(--green)}.server-dot.offline{background:var(--red)}
  .nav-link{font-family:var(--mono);font-size:.78rem;color:var(--purple);background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.25);border-radius:6px;padding:6px 14px;text-decoration:none;transition:all .2s;display:inline-flex;align-items:center;gap:6px}
  .nav-link:hover{background:rgba(167,139,250,0.2);border-color:var(--purple);transform:translateY(-1px)}
  .nav-dot{font-size:0.6rem}.nav-dot.online{color:var(--green)}.nav-dot.offline{color:var(--red)}
  .run-row{cursor:pointer}.run-row:hover td{background:rgba(34,211,238,0.06)!important}
  .detail-row td{padding:0!important;border-bottom:1px solid var(--border)}
  .detail-panel{background:var(--bg);border-left:3px solid var(--cyan);padding:16px 20px}
  .detail-summary{font-size:.84rem;color:var(--text);line-height:1.6;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border)}
  .detail-section{margin-top:10px}.detail-section b{font-size:.78rem;color:var(--text-dim);display:block;margin-bottom:6px}
  .detail-finding{padding:8px 10px;margin:6px 0;border-radius:6px;background:var(--surface2);border:1px solid var(--border);font-size:.82rem;line-height:1.5}
  .detail-finding .sev{margin-right:6px}.detail-text{color:var(--text-dim);font-size:.8rem}
  .detail-followup{font-family:var(--mono);font-size:.78rem;color:var(--amber);padding:4px 0}
  .detail-files{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.detail-files code{font-size:.72rem;padding:3px 8px}
  .coach-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
  .coach-card{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px}
  .coach-card.focused{border-color:var(--green);box-shadow:0 0 15px rgba(52,211,153,0.08)}
  .coach-card h4{font-size:.88rem;color:var(--text-bright);margin-bottom:6px}
  .coach-card p{font-size:.78rem;color:var(--text-dim)}
  .coach-stats{font-family:var(--mono);font-size:.7rem;color:var(--text-dim);margin-top:8px}
  .chip-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .chip{font-family:var(--mono);font-size:.68rem;color:var(--text-dim);background:rgba(107,127,148,0.1);border-radius:4px;padding:2px 8px}
  .guide-toggle{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:0;overflow:hidden}
  .guide-toggle summary{list-style:none;cursor:pointer;padding:16px 18px;font-family:var(--mono);font-size:.82rem;color:var(--text-bright);display:flex;align-items:center;justify-content:space-between}
  .guide-toggle summary::-webkit-details-marker{display:none}
  .guide-toggle summary::after{content:"Show";color:var(--cyan);font-size:.74rem;text-transform:uppercase;letter-spacing:.06em}
  .guide-toggle[open] summary{border-bottom:1px solid var(--border)}
  .guide-toggle[open] summary::after{content:"Hide"}
  .guide-toggle-body{padding:18px}
  .step-grid{display:grid;gap:20px;margin-top:12px}
  .step{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:18px;position:relative;border-left:3px solid var(--cyan)}
  .step-num{font-family:var(--mono);font-size:.7rem;font-weight:700;color:var(--bg);background:var(--cyan);border-radius:4px;padding:2px 8px;position:absolute;top:-1px;left:-1px;border-top-left-radius:10px}
  .step h3{font-family:var(--mono);font-size:.88rem;color:var(--text-bright);margin:4px 0 8px 40px}
  .step p{font-size:.82rem;color:var(--text);margin:6px 0;line-height:1.6}
  .step pre{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin:10px 0 4px;overflow-x:auto;font-size:.8rem;line-height:1.5;color:var(--text-bright);font-family:var(--mono)}
  .step pre .comment{color:var(--text-dim)}.step pre .highlight{color:var(--green)}.step pre .flag{color:var(--amber)}
  .table-hint{color:var(--text-dim);font-size:.8rem;margin:-4px 0 12px}
  @media(max-width:960px){.mode-grid{grid-template-columns:1fr}.launch-row{flex-direction:column;align-items:stretch}.launch-row label{min-width:0}.launch-row-actions{align-items:stretch}}
</style>
</head>
<body>

<div class="header">
  <h1>KAAYKO API <span>\u2022 AUTOMATION ENGINE</span></h1>
  <div class="header-meta">
    <a href="http://localhost:4400" class="nav-link" id="nav-frontend" title="Switch to Frontend Dashboard">\u2194 Frontend Dashboard <span class="nav-dot" id="frontend-dot">\u25cf</span></a>
    <span class="engine-badge"><span id="server-dot" class="server-dot offline"></span><span id="server-label">serve offline</span></span>
    <span class="engine-badge">engine <b>${esc(summary.runtime.review_engine_mode)}</b></span>
    <span class="engine-badge">model <b>${esc(summary.runtime.model)}</b></span>
    <span class="engine-badge">provider <b>${esc(summary.runtime.provider)}</b></span>
  </div>
</div>

<div class="dash">

  <div class="row">
    <div class="stat-grid">
      <div class="stat-card glow-cyan"><span class="stat-val">${summary.totals.runs}</span><span class="stat-label">Missions</span></div>
      <div class="stat-card glow-green"><span class="stat-val">${summary.totals.approved}</span><span class="stat-label">Reviewed</span></div>
      <div class="stat-card glow-amber"><span class="stat-val">${summary.totals.suggestions}</span><span class="stat-label">Findings</span></div>
      <div class="stat-card${summary.totals.vulnerabilities ? " glow-red" : ""}"><span class="stat-val">${summary.totals.vulnerabilities}</span><span class="stat-label">Vulnerabilities</span></div>
    </div>
  </div>


  <div class="row"><div class="panel highlight launchpad-panel" id="launchpad"><h2>Start Here</h2>
    <p class="panel-lead">Pick a module, describe the mission in plain English, then choose whether to audit, edit, or do a dry run.</p>
    <div class="step-pill-row">
      <span class="step-pill active">1 Choose module</span>
      <span class="step-pill">2 Describe the job</span>
      <span class="step-pill">3 Launch the mission</span>
    </div>
    <div class="selected-module">
      <span class="selected-module-label">Selected module</span>
      <strong id="selected-module-name">${esc(selectedModule.name)}</strong>
      <span id="selected-module-desc">${esc(selectedModule.desc)}</span>
      <span class="selected-module-status" id="launch-guide">Launch is disabled until <code>kaayko-api serve</code> is running.</span>
    </div>
    <input id="lp-area" type="hidden" value="${esc(selectedModule.area)}">
    <div class="mod-grid mod-grid-launch">${moduleCards}</div>
    <div class="launch-form">
      <div class="launch-row"><label>Mission</label><input id="lp-goal" type="text" placeholder="e.g. Audit auth middleware for gaps"/></div>
      <div class="launch-row launch-row-stack"><label>Mode</label>
        <div class="mode-grid">${modeButtons}</div>
        <input id="lp-mode" type="hidden" value="${defaultLaunchMode}">
      </div>
      <div class="launch-presets">
        <span class="launch-presets-label">Quick examples</span>
        <div class="preset-row">${presetButtons}</div>
      </div>
      <div class="launch-row launch-row-actions"><button id="lp-launch" onclick="launchMission()">LAUNCH MISSION</button><span id="lp-status" class="launch-status">Choose a module and write one sentence about what you want.</span></div>
    </div>
    <div id="lp-log-area" class="launch-log-area" style="display:none">
      <h3 style="font-family:var(--mono);font-size:.78rem;color:var(--cyan);margin-bottom:8px">LIVE OUTPUT</h3>
      <pre id="lp-log" class="launch-log"></pre>
    </div>
  </div></div>

  <div class="row"><details class="panel" open><summary class="section-toggle"><h2>Model Roster <button class="model-btn" onclick="event.stopPropagation();refreshModels()" style="font-size:.7rem;padding:3px 10px;margin-left:12px;vertical-align:middle" id="model-refresh-btn">↻ refresh</button></h2></summary>
    <p style="color:var(--text-dim);font-size:.82rem;margin-bottom:12px">Current: <code>${esc(summary.runtime.model)}</code> via <code>${esc(summary.runtime.provider)}</code>.</p>
    <div id="model-roster-container"><table id="model-table"><thead><tr><th></th><th>Model ID</th><th>Best For</th><th>Size</th><th>Status</th><th>Action</th></tr></thead><tbody>${modelRows}</tbody></table></div>
  </details></div>

  <div class="row"><details class="panel" open><summary class="section-toggle"><h2>Latest Activity</h2></summary>
    ${latestAgent ? `
      <div class="agent-meta">
        <span class="status-badge s-${esc((latestAgent.status || "").replace(/_/g, "-"))}">${esc(latestAgent.status)}</span>
        <code>${esc(latestAgent.agent_model || "heuristic")}</code>
        <span style="color:var(--text-dim);font-size:.78rem">${esc(latestAgent.requested_area || latestAgent.track)}</span>
      </div>
      <p class="agent-summary">${esc(latestAgent.agent_summary || latestAgent.title || "No summary recorded.")}</p>
      ${(latestAgent.agent_selected_files || []).length ? `
        <div class="detail-section" style="margin-top:14px">
          <b>FILES INSPECTED (${latestAgent.agent_selected_files.length})</b>
          <div class="detail-files">${(latestAgent.agent_selected_files || []).map((f) => `<code>${esc(typeof f === "string" ? f : f.path || f.relative_path || String(f))}</code>`).join(" ")}</div>
        </div>` : ""}
      ${(latestAgent.agent_applied_files || []).length ? `
        <div class="detail-section" style="margin-top:14px">
          <b>FILES EDITED (${latestAgent.agent_applied_files.length})</b>
          <div class="detail-files">${(latestAgent.agent_applied_files || []).map((f) => `<code class="applied-file">${esc(typeof f === "string" ? f : f.path || String(f))}</code>`).join(" ")}</div>
          ${(latestAgent.agent_applied_edits_detail || []).map((e) => `<div class="detail-edit"><code>${esc(e.path)}</code> <span class="detail-text">${esc(e.summary || "")}</span></div>`).join("")}
        </div>` : `<p style="color:var(--text-dim);font-size:.82rem;margin-top:10px">No files edited in this run. ${latestAgent.agent_goal_mode === "audit" ? "(audit mode \u2014 read-only)" : ""}</p>`}
      ${(latestAgent.suggestion_findings || []).length || (latestAgent.vulnerability_findings || []).length ? `
        <div class="detail-section" style="margin-top:14px">
          <b>FINDINGS (${(latestAgent.suggestion_findings || []).length + (latestAgent.vulnerability_findings || []).length})</b>
          ${(latestAgent.vulnerability_findings || []).concat(latestAgent.suggestion_findings || []).slice(0, 6).map((f) => `<div class="detail-finding"><span class="sev sev-${esc(f.severity || "info")}">${esc(f.severity || "info")}</span> <b>${esc(f.title)}</b><br/><span class="detail-text">${esc(f.detail || "")}</span></div>`).join("")}
        </div>` : ""}
    ` : `<p class="empty">No agent runs recorded yet. Launch a mission above to get started.</p>`}
  </details></div>

  <div class="row"><details class="panel" open><summary class="section-toggle"><h2>Findings &amp; Suggestions <button class="model-btn" onclick="event.stopPropagation();loadFindings()" style="font-size:.7rem;padding:3px 10px;margin-left:12px;vertical-align:middle" id="findings-refresh-btn">↻ load</button></h2></summary>
    <p class="table-hint">Actionable findings from all runs. Click "Implement" to auto-fix a finding via the agent.</p>
    <div id="findings-container"><p class="empty">Click "load" to fetch findings from all runs.</p></div>
  </details></div>

  <div class="row"><details class="panel"><summary class="section-toggle"><h2>Recent Missions</h2></summary>
    <p class="table-hint">Click any mission row to open findings, verification, and touched files.</p>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>Status</th><th>Module</th><th>Run</th><th>Files</th><th>Findings</th><th>Model</th></tr></thead>
      <tbody>${recentRows || `<tr><td colspan="6" class="empty">No runs yet.</td></tr>`}</tbody>
    </table></div>
  </details></div>


</div>

<div class="footer">KAAYKO API AUTOMATION ENGINE · Generated ${esc(summary.generated_at)} · <button class="model-btn" onclick="manualRefresh()" style="font-size:.72rem;padding:4px 12px">↻ Refresh Page</button></div>

<script>
if(location.protocol==='file:'){fetch('http://localhost:7799/api/health',{signal:AbortSignal.timeout(2000)}).then(r=>{if(r.ok)location.replace('http://localhost:7799/')}).catch(()=>{})}
document.querySelectorAll('.cmd-copy').forEach(el=>{el.title='Click to copy';el.addEventListener('click',()=>{navigator.clipboard.writeText(el.textContent.trim());const o=el.style.color;el.style.color='var(--green)';setTimeout(()=>el.style.color=o,600)})});
const BASE=(location.protocol==='file:'||location.origin==='null')?'http://localhost:7799':location.origin;let serverOnline=false;let activePollToken=null;

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function postHeaders(){return {'Content-Type':'application/json','X-CSRF-Token':window.__CSRF_TOKEN||''}}

function syncSelectedModule(area){const input=document.getElementById('lp-area');if(input)input.value=area;document.querySelectorAll('.mod-card').forEach(card=>{const active=card.dataset.area===area;card.classList.toggle('selected',active);card.setAttribute('aria-pressed',active?'true':'false')});const selected=document.querySelector('.mod-card.selected');if(selected){const name=document.getElementById('selected-module-name');const desc=document.getElementById('selected-module-desc');if(name)name.textContent=selected.dataset.name||area;if(desc)desc.textContent=selected.dataset.desc||''}}
function setLaunchMode(mode){const input=document.getElementById('lp-mode');if(input)input.value=mode;document.querySelectorAll('.mode-card').forEach(card=>{const active=card.dataset.mode===mode;card.classList.toggle('selected',active);card.setAttribute('aria-pressed',active?'true':'false')})}
function syncLaunchGuide(){const guide=document.getElementById('launch-guide');const status=document.getElementById('lp-status');if(guide){if(serverOnline){guide.innerHTML='Launcher is ready.';guide.style.color='var(--green)'}else{guide.innerHTML='Launch is disabled until <code>kaayko-api serve</code> is running.';guide.style.color='var(--amber)'}}if(status&&!serverOnline){status.textContent='Server offline';status.style.color='var(--amber)'}}

async function checkServer(){try{const c=new AbortController();const t=setTimeout(()=>c.abort(),2000);const r=await fetch(BASE+'/api/health',{signal:c.signal,mode:'cors'});clearTimeout(t);if(r.ok){const d=await r.json();serverOnline=true;const dot=document.getElementById('server-dot'),lbl=document.getElementById('server-label');if(dot&&d.busy){dot.className='server-dot online';dot.style.background='var(--amber)';dot.style.boxShadow='0 0 6px var(--amber)';lbl.textContent='busy: '+d.activeMission.area+' ('+d.activeMission.elapsed+'s)';lbl.style.color='var(--amber)'}else if(dot){dot.className='server-dot online';dot.style.background='';dot.style.boxShadow='';lbl.textContent='serve active';lbl.style.color=''}}}catch{serverOnline=false}const d=document.getElementById('server-dot'),l=document.getElementById('server-label');if(!serverOnline&&d){d.className='server-dot offline';d.style.background='';d.style.boxShadow='';l.textContent='serve offline';l.style.color=''}const b=document.getElementById('lp-launch');if(b)b.disabled=!serverOnline;syncLaunchGuide()}

async function launchMission(){if(!serverOnline)return;const a=document.getElementById('lp-area').value,g=document.getElementById('lp-goal').value.trim(),m=document.getElementById('lp-mode').value,s=document.getElementById('lp-status');if(!g){s.textContent='Goal is required';s.style.color='var(--red)';return}const b=document.getElementById('lp-launch');b.disabled=true;s.textContent='Launching...';s.style.color='var(--amber)';try{const r=await fetch(BASE+'/api/launch',{method:'POST',headers:postHeaders(),body:JSON.stringify({area:a,goal:g,mode:m,goalMode:m==='dry-run'?'edit':m})});const d=await r.json();if(r.status===409){s.textContent=d.error||'Mission already running';s.style.color='var(--amber)';b.disabled=false;return}if(d.ok){s.textContent='Running (PID '+d.pid+')';s.style.color='var(--green)';activePollToken=d.logFile;document.getElementById('lp-log-area').style.display='block';pollLog()}else{s.textContent=d.error||'Failed';s.style.color='var(--red)';b.disabled=false}}catch(e){s.textContent=e.message;s.style.color='var(--red)';b.disabled=false}}

async function pollLog(){if(!activePollToken)return;try{const r=await fetch(BASE+'/api/log/'+activePollToken);if(r.ok){const t=await r.text();const el=document.getElementById('lp-log');el.textContent=t;el.scrollTop=el.scrollHeight;if(t.includes('[exit ')){document.getElementById('lp-status').textContent='Complete';document.getElementById('lp-status').style.color='var(--green)';document.getElementById('lp-launch').disabled=false;activePollToken=null;return}}}catch{}setTimeout(pollLog,1500)}

async function switchModel(id){if(!serverOnline){alert('Start kaayko-api serve first');return}try{const r=await fetch(BASE+'/api/model',{method:'POST',headers:postHeaders(),body:JSON.stringify({model:id})});const d=await r.json();if(d.ok){await refreshModels()}}catch(e){alert('Error: '+e.message)}}

async function pullModel(id,btn){if(!serverOnline){alert('Start kaayko-api serve first');return}btn.disabled=true;btn.textContent='pulling...';btn.style.color='var(--amber)';try{const r=await fetch(BASE+'/api/pull',{method:'POST',headers:postHeaders(),body:JSON.stringify({model:id})});const d=await r.json();if(d.ok){btn.textContent='started...';pollPull(id,btn)}else{btn.textContent=d.error||'failed';btn.style.color='var(--red)';setTimeout(()=>{btn.textContent='pull';btn.style.color='';btn.disabled=false},3000)}}catch(e){btn.textContent='error';btn.style.color='var(--red)';setTimeout(()=>{btn.textContent='pull';btn.style.color='';btn.disabled=false},3000)}}

async function pollPull(id,btn){let tries=0;const poll=async()=>{tries++;try{const r=await fetch(BASE+'/api/models');const d=await r.json();if(d.ok){const m=d.models.find(x=>x.id===id);if(m&&m.installed){btn.textContent='\\u2713 done';btn.style.color='var(--green)';setTimeout(()=>refreshModels(),500);return}}}catch{}if(tries<60){setTimeout(poll,5000)}else{btn.textContent='timeout';btn.style.color='var(--amber)';setTimeout(()=>{btn.textContent='pull';btn.style.color='';btn.disabled=false},3000)}};setTimeout(poll,3000)}

async function refreshModels(){if(!serverOnline)return;const btn=document.getElementById('model-refresh-btn');if(btn){btn.disabled=true;btn.textContent='\\u21bb ...'}try{const r=await fetch(BASE+'/api/models');const d=await r.json();if(d.ok&&d.html){const tbl=document.getElementById('model-table');if(tbl){const tbody=tbl.querySelector('tbody');if(tbody)tbody.innerHTML=d.html}}}catch(e){console.error('refreshModels error',e)}finally{if(btn){btn.disabled=false;btn.textContent='\\u21bb refresh'}}}

async function loadFindings(){if(!serverOnline){alert('Start kaayko-api serve first');return}const container=document.getElementById('findings-container');const btn=document.getElementById('findings-refresh-btn');if(btn){btn.disabled=true;btn.textContent='\\u21bb loading...'}container.innerHTML='<p class="empty">Loading findings...</p>';try{const r=await fetch(BASE+'/api/findings');const d=await r.json();if(!d.ok){container.innerHTML='<p class="empty">Error: '+(d.error||'unknown')+'</p>';return}const findings=d.findings||[];if(!findings.length){container.innerHTML='<p class="empty">No findings across any runs.</p>';return}container.innerHTML=findings.map((f,i)=>{const sevClass='sev-'+(f.severity||'info');const lineRefs=(f.line_refs||[]).map(r=>'<code class="line-ref">'+esc(r.file)+':'+r.start_line+(r.end_line&&r.end_line!==r.start_line?'-'+r.end_line:'')+'</code>').join(' ');const filePaths=(f.file_paths||[]).filter(p=>p).map(p=>'<code>'+esc(p)+'</code>').join(' ');const refLine=(lineRefs||filePaths)?'<div class="finding-refs">'+(lineRefs||filePaths)+'</div>':'';return '<div class="finding-card" id="finding-'+i+'"><div class="finding-header"><span class="sev '+esc(sevClass)+'">'+esc(f.severity||'info')+'</span><span class="finding-title">'+esc(f.title)+'</span><span id="finding-status-'+i+'" class="finding-status"></span></div><div class="finding-detail">'+esc(f.detail||'')+'</div>'+refLine+'<div class="finding-meta"><code>'+esc(f.track)+'</code><code>'+esc(f.run_id||'').slice(0,25)+'</code><button class="implement-btn" onclick="implementFinding('+i+',this)">\\u26a1 Implement Fix</button><button class="pr-btn" onclick="createPR(\\''+esc(f.track)+'\\',\\''+esc(f.title).replace(/'/g,"\\\\'")+'\\''+',this)">\\ud83d\\udd00 Create PR</button></div></div>'}).join('')}catch(e){container.innerHTML='<p class="empty">Error loading: '+esc(e.message)+'</p>'}finally{if(btn){btn.disabled=false;btn.textContent='\\u21bb load'}}}
window._findingsData=[];
async function loadFindingsData(){if(!serverOnline)return[];try{const r=await fetch(BASE+'/api/findings');const d=await r.json();if(d.ok)window._findingsData=d.findings||[];return window._findingsData}catch{return[]}}

async function implementFinding(idx,btn){if(!serverOnline){alert('Start kaayko-api serve first');return}const findings=window._findingsData;if(!findings[idx]){alert('Finding data not loaded');return}const f=findings[idx];btn.disabled=true;btn.textContent='\\u26a1 implementing...';const status=document.getElementById('finding-status-'+idx);if(status){status.textContent='running agent...';status.className='finding-status implementing'}try{const r=await fetch(BASE+'/api/implement',{method:'POST',headers:postHeaders(),body:JSON.stringify({track:f.track,title:f.title,detail:f.detail,severity:f.severity,line_refs:f.line_refs||[],file_paths:f.file_paths||[]})});const d=await r.json();if(d.ok){if(status){status.textContent='\\u2713 agent launched (PID '+d.pid+')';status.className='finding-status done'}btn.textContent='\\u2713 launched'}else{if(status){status.textContent='failed: '+(d.error||'unknown');status.className='finding-status error'}btn.textContent='retry';btn.disabled=false}}catch(e){if(status){status.textContent='error: '+e.message;status.className='finding-status error'}btn.textContent='retry';btn.disabled=false}}

async function createPR(track,title,btn){if(!serverOnline){alert('Start kaayko-api serve first');return}btn.disabled=true;btn.textContent='\\ud83d\\udd00 creating...';try{const r=await fetch(BASE+'/api/pr',{method:'POST',headers:postHeaders(),body:JSON.stringify({track,title})});const d=await r.json();if(d.ok){btn.textContent='\\u2713 PR created';if(d.pr_url){btn.onclick=()=>window.open(d.pr_url,'_blank');btn.style.cursor='pointer';btn.disabled=false;btn.textContent='\\ud83d\\udd17 View PR'}}else{btn.textContent=d.error||'failed';btn.disabled=false}}catch(e){btn.textContent='error';btn.disabled=false}}

function manualRefresh(){location.reload()}

function toggleDetail(id){const r=document.getElementById(id);if(!r)return;r.style.display=r.style.display==='none'?'table-row':'none'}

document.querySelectorAll('.mod-card').forEach(c=>{c.addEventListener('click',()=>{syncSelectedModule(c.dataset.area);const lp=document.getElementById('launchpad');if(lp)lp.scrollIntoView({behavior:'smooth',block:'start'});const gi=document.getElementById('lp-goal');if(gi)gi.focus()})});
document.querySelectorAll('.mode-card').forEach(c=>{c.addEventListener('click',()=>setLaunchMode(c.dataset.mode))});
document.querySelectorAll('.preset-btn').forEach(btn=>{btn.addEventListener('click',()=>{if(btn.dataset.mode)setLaunchMode(btn.dataset.mode);const gi=document.getElementById('lp-goal');if(gi){gi.value=btn.dataset.goal||'';gi.focus();gi.setSelectionRange(gi.value.length,gi.value.length)}const s=document.getElementById('lp-status');if(s){s.textContent='Example loaded. Edit the wording if you want.';s.style.color='var(--text-dim)'}})});

syncSelectedModule('${esc(selectedModule.area)}');setLaunchMode('${esc(defaultLaunchMode)}');checkServer();setInterval(checkServer,15000);
async function checkSibling(){try{const r=await fetch('http://localhost:4400/api/health',{signal:AbortSignal.timeout(2000),mode:'cors'});const dot=document.getElementById('frontend-dot');if(dot)dot.className='nav-dot '+(r.ok?'online':'offline')}catch{const dot=document.getElementById('frontend-dot');if(dot)dot.className='nav-dot offline'}}
checkSibling();setInterval(checkSibling,15000);
// Auto-load findings and models after server check
setTimeout(async()=>{if(serverOnline){await refreshModels();await loadFindingsData();loadFindings()}},2500);
</script>
</body>
</html>`;
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = { generateDashboard, buildDashboardMarkdown, buildDashboardHtml, buildModelRoster };
