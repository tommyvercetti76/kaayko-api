"use strict";

const fs = require("fs");
const path = require("path");
const h = require("./loop-helpers");
const { loadSuppressions, isSuppressed, fingerprintFinding } = require("./finding-intelligence");

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
  const suppressions = loadSuppressions();
  let totalSuppressed = 0;
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
      const fp = fingerprintFinding(normalizedFinding);
      if (isSuppressed(normalizedFinding, fp, suppressions).suppressed) {
        totalSuppressed++;
        return;
      }
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
      suggestions: suggestionFindings.length,
      vulnerabilities: vulnerabilityFindings.length,
      suggestions_raw: totalSuggestions,
      vulnerabilities_raw: totalVulnerabilities,
      suppressed: totalSuppressed,
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
- Suggestions surfaced: ${summary.totals.suggestions}${summary.totals.suggestions_raw !== summary.totals.suggestions ? ` (${summary.totals.suppressed} suppressed, ${summary.totals.suggestions_raw} raw)` : ""}
- Vulnerabilities surfaced: ${summary.totals.vulnerabilities}${summary.totals.vulnerabilities_raw !== summary.totals.vulnerabilities ? ` (${summary.totals.suppressed} suppressed, ${summary.totals.vulnerabilities_raw} raw)` : ""}
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
    { id: "audit", label: "Audit", desc: "Read-only review" },
    { id: "edit", label: "Edit", desc: "Apply code fixes" },
    { id: "dry-run", label: "Dry Run", desc: "Plan without editing" }
  ];
  const missionPresets = [
    { label: "Security audit", goal: "Audit auth and access control gaps", mode: "audit" },
    { label: "Fix failing tests", goal: "Investigate the current failing tests and fix the root cause", mode: "edit" },
    { label: "Review blockers", goal: "Review the latest failing quality gates and explain what blocks approval", mode: "audit" },
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

  // ── Compute intelligence metrics ──
  const now = new Date();
  const latestRun = summary.recent_runs[0] || null;
  const lastRunAge = latestRun ? Math.round((now - new Date(latestRun.updated_at)) / 60000) : null;
  const staleThresholdMs = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Classify findings by age
  const allFindings = summary.open_findings || [];
  const criticalFindings = allFindings.filter((f) => f.severity === "critical" || f.severity === "blocking");
  const highFindings = allFindings.filter((f) => f.severity === "high" || f.severity === "major");
  const vulnFindings = summary.vulnerability_findings || [];
  const resolvedEntries = []; // from suppressions.json resolved array — rendered client-side via /api/findings

  // Brief text
  const briefLines = [];
  if (lastRunAge !== null) {
    if (lastRunAge < 60) briefLines.push(`Last mission completed <b>${lastRunAge}m ago</b>.`);
    else if (lastRunAge < 1440) briefLines.push(`Last mission completed <b>${Math.round(lastRunAge / 60)}h ago</b>.`);
    else briefLines.push(`Last mission completed <b>${Math.round(lastRunAge / 1440)}d ago</b> \u2014 consider running a fresh audit.`);
  } else {
    briefLines.push("No missions have been run yet. Launch one below.");
  }
  if (vulnFindings.length > 0) briefLines.push(`<span style="color:var(--red)">${vulnFindings.length} open vulnerabilit${vulnFindings.length === 1 ? "y" : "ies"}</span> need attention.`);
  if (criticalFindings.length > 0) briefLines.push(`<span style="color:var(--red)">${criticalFindings.length} critical finding${criticalFindings.length === 1 ? "" : "s"}</span> unresolved.`);
  else if (highFindings.length > 0) briefLines.push(`${highFindings.length} high-severity finding${highFindings.length === 1 ? "" : "s"} open.`);
  if (summary.totals.suppressed > 0) briefLines.push(`${summary.totals.suppressed} finding${summary.totals.suppressed === 1 ? "" : "s"} suppressed as false positive${summary.totals.suppressed === 1 ? "" : "s"}.`);
  if (allFindings.length === 0 && vulnFindings.length === 0) briefLines.push('<span style="color:var(--green)">All clear \u2014 no open findings.</span>');

  // ── Module health chips ──
  const moduleChips = modules.map((m) => {
    const trackData = summary.tracks.find((t) => t.track === m.area) || {};
    const vulns = trackData.vulnerabilities || 0;
    const sugs = trackData.suggestions || 0;
    const runs = trackData.runs || 0;
    let healthColor = "var(--green)";
    let healthLabel = "clean";
    if (vulns > 0) { healthColor = "var(--red)"; healthLabel = `${vulns} vuln`; }
    else if (sugs > 3) { healthColor = "var(--amber)"; healthLabel = `${sugs} findings`; }
    else if (sugs > 0) { healthColor = "var(--blue)"; healthLabel = `${sugs} findings`; }
    else if (runs === 0) { healthColor = "var(--text-dim)"; healthLabel = "unscanned"; }
    return `<div class="health-chip" data-area="${esc(m.area)}">
      <span class="health-dot" style="background:${healthColor}"></span>
      <span class="health-icon">${m.icon}</span>
      <span class="health-name">${esc(m.name)}</span>
      <span class="health-label" style="color:${healthColor}">${healthLabel}</span>
      <span class="health-runs">${runs} run${runs !== 1 ? "s" : ""}</span>
    </div>`;
  }).join("");

  // ── Timeline from recent runs ──
  const timelineEntries = summary.recent_runs.slice(0, 12).map((run, idx) => {
    const ts = run.updated_at || run.created_at || "";
    const findingsCount = (run.suggestions_count || 0) + (run.vulnerabilities_count || 0);
    const appliedCount = (run.agent_applied_files || []).length;
    const inspectedCount = (run.agent_selected_files || []).length;
    const mode = run.agent_goal_mode || "edit";
    const modeChip = mode === "audit" ? '<span class="tl-chip tl-chip-audit">AUDIT</span>' : (mode === "dry-run" ? '<span class="tl-chip tl-chip-dry">DRY RUN</span>' : '<span class="tl-chip tl-chip-edit">EDIT</span>');
    const detailId = `tl-detail-${idx}`;

    // Build detail content
    const findingsList = (run.vulnerability_findings || []).concat(run.suggestion_findings || []);
    const inspected = run.agent_selected_files || [];
    const applied = run.agent_applied_files || [];

    let detailHtml = "";
    if (run.agent_summary || run.title) {
      detailHtml += `<div class="tl-detail-summary">${esc(run.agent_summary || run.title)}</div>`;
    }
    if (findingsList.length) {
      detailHtml += `<div class="tl-detail-section"><b>Findings (${findingsList.length})</b>${findingsList.slice(0, 6).map((f) => `<div class="tl-detail-finding"><span class="sev sev-${esc(f.severity || "info")}">${esc(f.severity || "info")}</span> ${esc(f.title)}</div>`).join("")}</div>`;
    }
    if (applied.length) {
      detailHtml += `<div class="tl-detail-section"><b>Edited (${applied.length})</b><div class="detail-files">${applied.map((f) => `<code class="applied-file">${esc(typeof f === "string" ? f : f.path || String(f))}</code>`).join(" ")}</div></div>`;
    }
    if (inspected.length && !applied.length) {
      detailHtml += `<div class="tl-detail-section"><b>Inspected (${inspected.length})</b><div class="detail-files">${inspected.slice(0, 8).map((f) => `<code>${esc(typeof f === "string" ? f : f.path || f.relative_path || String(f))}</code>`).join(" ")}${inspected.length > 8 ? `<code>+${inspected.length - 8} more</code>` : ""}</div></div>`;
    }

    // Action line
    let actionText = "";
    if (appliedCount > 0) actionText = `<span style="color:var(--green)">${appliedCount} file${appliedCount !== 1 ? "s" : ""} edited</span>`;
    else if (inspectedCount > 0) actionText = `${inspectedCount} file${inspectedCount !== 1 ? "s" : ""} inspected`;
    const findingsText = findingsCount > 0 ? `${findingsCount} finding${findingsCount !== 1 ? "s" : ""}` : "no findings";

    return `<div class="tl-entry" onclick="toggleDetail('${detailId}')">
      <div class="tl-line"><span class="tl-dot s-dot-${esc(run.status.replace(/_/g, "-"))}"></span></div>
      <div class="tl-content">
        <div class="tl-header">
          <span class="tl-time" data-ts="${esc(ts)}">${esc(ts.slice(0, 16).replace("T", " "))}</span>
          <span class="status-badge s-${esc(run.status.replace(/_/g, "-"))}">${statusIcon(run.status)} ${esc(run.status)}</span>
          ${modeChip}
        </div>
        <div class="tl-body">
          <span class="tl-area">${esc(run.requested_area || run.track)}</span>
          <span class="tl-sep">\u2014</span>
          <span class="tl-action">${actionText || "\u2014"}, ${findingsText}</span>
          <span class="tl-model">${esc(run.agent_model || "heuristic")}</span>
        </div>
        <div class="tl-expand" id="${detailId}" style="display:none">${detailHtml}</div>
      </div>
    </div>`;
  }).join("");

  // ── Findings cards (static, from summary) ──
  const findingsCards = allFindings.slice(0, 10).map((f, i) => {
    const sevClass = "sev-" + (f.severity || "info");
    const lineRefs = (f.line_refs || []).map((r) => `<code class="line-ref">${esc(r.file)}:${r.start_line}${r.end_line && r.end_line !== r.start_line ? "-" + r.end_line : ""}</code>`).join(" ");
    const filePaths = (f.file_paths || []).filter((p) => p).map((p) => `<code>${esc(p)}</code>`).join(" ");
    const refLine = (lineRefs || filePaths) ? `<div class="finding-refs">${lineRefs || filePaths}</div>` : "";
    return `<div class="finding-card${f.severity === "critical" || f.severity === "blocking" ? " finding-critical" : ""}">
      <div class="finding-header">
        <span class="sev ${esc(sevClass)}">${esc(f.severity || "info")}</span>
        <span class="finding-title">${esc(f.title)}</span>
      </div>
      <div class="finding-detail">${esc(f.detail || "")}</div>
      ${refLine}
      <div class="finding-meta">
        <code>${esc(f.track)}</code>
        <span id="finding-status-s-${i}" class="finding-status"></span>
      </div>
    </div>`;
  }).join("");

  // ── Model rows ──
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

  // ── Launch module selector (compact) ──
  const moduleOptions = modules.map((m) => {
    const selected = m.area === selectedModule.area;
    return `<button class="mod-chip${selected ? " selected" : ""}" type="button" data-area="${esc(m.area)}" data-name="${esc(m.name)}" data-desc="${esc(m.desc)}" aria-pressed="${selected ? "true" : "false"}">${m.icon} ${esc(m.name)}</button>`;
  }).join("");

  const modeButtons = launchModes.map((mode) => {
    const selected = mode.id === defaultLaunchMode;
    return `<button class="mode-chip${selected ? " selected" : ""}" type="button" data-mode="${esc(mode.id)}" aria-pressed="${selected ? "true" : "false"}">${esc(mode.label)}</button>`;
  }).join("");

  const presetButtons = missionPresets.map((preset) => {
    return `<button class="preset-btn" type="button" data-goal="${esc(preset.goal)}" data-mode="${esc(preset.mode)}">${esc(preset.label)}</button>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KAAYKO API \u2022 Automation Engine</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap');
  :root{--bg:#0a0e14;--surface:#111820;--surface2:#172030;--border:#1e2d3d;--border-hi:#2a4060;--text:#c8d6e5;--text-dim:#6b7f94;--text-bright:#e8f0f8;--cyan:#22d3ee;--green:#34d399;--amber:#f59e0b;--red:#ef4444;--purple:#a78bfa;--blue:#60a5fa;--mono:'JetBrains Mono','Fira Code','Cascadia Code',monospace;--sans:'Inter',-apple-system,'Segoe UI',sans-serif}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);min-height:100vh;background-image:radial-gradient(ellipse at 20% 0%,rgba(34,211,238,0.06) 0%,transparent 50%),radial-gradient(ellipse at 80% 100%,rgba(167,139,250,0.04) 0%,transparent 50%)}

  /* ── Header ── */
  .header{border-bottom:1px solid var(--border);padding:16px 28px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
  .header h1{font-family:var(--mono);font-size:1.1rem;font-weight:700;color:var(--cyan);letter-spacing:.08em;text-shadow:0 0 20px rgba(34,211,238,0.3)}
  .header h1 span{color:var(--text-dim);font-weight:400}
  .header-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .engine-badge{font-family:var(--mono);font-size:.72rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:5px 10px;color:var(--text-dim)}
  .engine-badge b{color:var(--green)}

  .dash{max-width:1280px;margin:0 auto;padding:20px 24px 48px}
  .row{display:grid;gap:16px;margin-bottom:16px}
  .row-2{grid-template-columns:1fr 1fr}
  .row-3{grid-template-columns:2fr 1fr}
  @media(max-width:960px){.row-2,.row-3{grid-template-columns:1fr}}

  /* ── Panels ── */
  .panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;overflow:hidden}
  .panel h2{font-family:var(--mono);font-size:.78rem;font-weight:600;color:var(--cyan);letter-spacing:.06em;text-transform:uppercase;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--border)}
  .panel h2::before{content:"\\25b8 ";color:var(--text-dim)}
  details.panel{padding:0}
  details.panel>summary{cursor:pointer;list-style:none;padding:18px;user-select:none}
  details.panel>summary::-webkit-details-marker{display:none}
  details.panel>summary h2{margin-bottom:0;padding-bottom:0;border-bottom:none;display:inline}
  details.panel>summary::after{content:"\\25bc";float:right;color:var(--text-dim);font-size:.65rem;margin-top:4px;transition:transform .2s}
  details.panel:not([open])>summary::after{transform:rotate(-90deg)}
  details.panel[open]>*:not(summary){padding:0 18px 18px}
  details.panel[open]>summary{border-bottom:1px solid var(--border);margin-bottom:10px}

  /* ── Intelligence Brief ── */
  .brief{background:linear-gradient(135deg,var(--surface) 0%,rgba(34,211,238,0.04) 100%);border:1px solid var(--border);border-radius:12px;padding:20px 24px;display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start}
  .brief-body{display:grid;gap:6px}
  .brief-line{font-size:.86rem;line-height:1.5;color:var(--text)}
  .brief-stats{display:flex;gap:10px;flex-wrap:wrap;align-items:start}
  .brief-stat{text-align:center;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 16px;min-width:80px}
  .brief-stat .bv{font-family:var(--mono);font-size:1.6rem;font-weight:700;color:var(--text-bright);display:block;line-height:1.1}
  .brief-stat .bl{font-size:.65rem;color:var(--text-dim);margin-top:2px;display:block;text-transform:uppercase;letter-spacing:.04em}
  .brief-stat.glow-cyan .bv{color:var(--cyan)}.brief-stat.glow-green .bv{color:var(--green)}.brief-stat.glow-amber .bv{color:var(--amber)}.brief-stat.glow-red .bv{color:var(--red)}

  /* ── Module Health ── */
  .health-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
  .health-chip{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:8px;cursor:pointer;transition:border-color .2s}
  .health-chip:hover{border-color:var(--border-hi)}
  .health-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .health-icon{font-size:1rem}
  .health-name{font-family:var(--mono);font-size:.72rem;font-weight:600;color:var(--text-bright);flex:1}
  .health-label{font-family:var(--mono);font-size:.66rem;font-weight:600}
  .health-runs{font-family:var(--mono);font-size:.62rem;color:var(--text-dim)}

  /* ── Timeline ── */
  .timeline{position:relative;padding-left:0}
  .tl-entry{display:flex;gap:14px;padding:10px 0;cursor:pointer;transition:background .15s;border-radius:8px;margin:0 -8px;padding-left:8px;padding-right:8px}
  .tl-entry:hover{background:rgba(34,211,238,0.03)}
  .tl-line{width:20px;display:flex;flex-direction:column;align-items:center;position:relative}
  .tl-line::after{content:"";position:absolute;top:22px;bottom:-10px;width:1px;background:var(--border)}
  .tl-entry:last-child .tl-line::after{display:none}
  .tl-dot{width:10px;height:10px;border-radius:50%;margin-top:5px;flex-shrink:0;z-index:1;background:var(--text-dim)}
  .s-dot-approved,.s-dot-reviewed{background:var(--green)}.s-dot-pending-review,.s-dot-agent-applied{background:var(--blue)}
  .s-dot-rejected,.s-dot-rolled-back{background:var(--red)}.s-dot-agent-failed,.s-dot-capture-failed{background:var(--red)}
  .s-dot-changes-requested{background:var(--amber)}
  .tl-content{flex:1;min-width:0}
  .tl-header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .tl-time{font-family:var(--mono);font-size:.72rem;color:var(--text-dim);min-width:120px}
  .tl-body{display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap;font-size:.82rem}
  .tl-area{font-weight:600;color:var(--text-bright)}
  .tl-sep{color:var(--text-dim);font-size:.7rem}
  .tl-action{color:var(--text)}
  .tl-model{font-family:var(--mono);font-size:.68rem;color:var(--text-dim);background:var(--surface2);border-radius:4px;padding:2px 6px}
  .tl-chip{font-family:var(--mono);font-size:.62rem;padding:2px 7px;border-radius:4px;font-weight:600;letter-spacing:.04em}
  .tl-chip-audit{background:rgba(96,165,250,0.15);color:var(--blue)}
  .tl-chip-edit{background:rgba(52,211,153,0.12);color:var(--green)}
  .tl-chip-dry{background:rgba(167,139,250,0.12);color:var(--purple)}
  .tl-expand{margin-top:10px;padding:12px 14px;background:var(--bg);border-left:3px solid var(--cyan);border-radius:0 8px 8px 0}
  .tl-detail-summary{font-size:.82rem;color:var(--text);line-height:1.6;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)}
  .tl-detail-section{margin-top:8px}
  .tl-detail-section b{font-size:.74rem;color:var(--text-dim);display:block;margin-bottom:4px}
  .tl-detail-finding{padding:6px 8px;margin:4px 0;border-radius:4px;background:var(--surface2);font-size:.78rem;line-height:1.4}
  .tl-detail-finding .sev{margin-right:6px}

  /* ── Findings ── */
  .finding-card{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px;margin:8px 0;transition:border-color .2s}
  .finding-card:hover{border-color:var(--border-hi)}
  .finding-card.finding-critical{border-color:rgba(239,68,68,0.4);background:rgba(239,68,68,0.04)}
  .finding-header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .finding-title{font-weight:600;font-size:.84rem;color:var(--text-bright);flex:1}
  .finding-detail{font-size:.8rem;color:var(--text-dim);line-height:1.5;margin-bottom:8px}
  .finding-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:.74rem}
  .finding-meta code{font-size:.7rem}
  .finding-refs{margin:4px 0 6px 0;display:flex;flex-wrap:wrap;gap:4px}
  .finding-refs code{font-size:.68rem;background:rgba(99,102,241,0.15);color:#818cf8;padding:1px 6px;border-radius:3px}
  .finding-status{font-family:var(--mono);font-size:.7rem;padding:2px 8px;border-radius:4px}
  .finding-status.implementing{background:rgba(245,158,11,0.15);color:var(--amber)}
  .finding-status.done{background:rgba(52,211,153,0.15);color:var(--green)}
  .finding-status.error{background:rgba(239,68,68,0.15);color:var(--red)}

  /* ── Dynamic findings (loaded from server) ── */
  .findings-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
  .findings-filter{appearance:none;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);font-family:var(--mono);font-size:.72rem;cursor:pointer}
  .findings-filter:focus{border-color:var(--cyan);outline:none}

  /* ── Launch pad (compact) ── */
  .launch-compact{background:linear-gradient(135deg,rgba(34,211,238,0.06),rgba(96,165,250,0.03));border:1px solid rgba(34,211,238,0.15);border-radius:12px;padding:18px}
  .launch-compact h2::before{content:"\\25b6 ";color:var(--cyan)}
  .mod-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .mod-chip{appearance:none;font-family:var(--mono);font-size:.72rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;color:var(--text);transition:all .2s}
  .mod-chip:hover{border-color:var(--cyan);color:var(--text-bright)}
  .mod-chip.selected{border-color:var(--cyan);background:rgba(34,211,238,0.1);color:var(--cyan);font-weight:600}
  .launch-row{display:flex;gap:8px;align-items:center;margin-bottom:10px}
  .launch-row input{flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:9px 12px;color:var(--text-bright);font-family:var(--mono);font-size:.8rem;outline:none;transition:border-color .2s}
  .launch-row input:focus{border-color:var(--cyan)}
  .mode-chips{display:flex;gap:6px;margin-bottom:10px}
  .mode-chip{appearance:none;font-family:var(--mono);font-size:.72rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 12px;cursor:pointer;color:var(--text);transition:all .2s}
  .mode-chip:hover{border-color:var(--cyan)}
  .mode-chip.selected{border-color:var(--cyan);background:rgba(34,211,238,0.08);color:var(--cyan)}
  .preset-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .preset-btn{appearance:none;background:rgba(107,127,148,0.08);border:1px solid rgba(107,127,148,0.15);border-radius:999px;padding:6px 10px;font-family:var(--mono);font-size:.7rem;color:var(--text);cursor:pointer;transition:all .2s}
  .preset-btn:hover{border-color:rgba(34,211,238,0.28);background:rgba(34,211,238,0.08);color:var(--text-bright)}
  .launch-actions{display:flex;gap:10px;align-items:center}
  #lp-launch{background:var(--cyan);color:var(--bg);border:none;border-radius:6px;padding:9px 20px;font-family:var(--mono);font-size:.78rem;font-weight:700;cursor:pointer;letter-spacing:.06em;transition:opacity .2s}
  #lp-launch:hover{opacity:.85}#lp-launch:disabled{opacity:.4;cursor:not-allowed}
  .launch-status{font-family:var(--mono);font-size:.72rem;color:var(--text-dim)}
  .launch-log-area{margin-top:12px}
  .launch-log{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;max-height:280px;overflow-y:auto;font-size:.74rem;line-height:1.5;color:var(--text);font-family:var(--mono);white-space:pre-wrap}

  /* ── Shared ── */
  .status-badge{font-family:var(--mono);font-size:.68rem;padding:2px 7px;border-radius:4px;display:inline-block;font-weight:600}
  .s-approved,.s-reviewed{background:rgba(52,211,153,0.15);color:var(--green)}
  .s-pending-review,.s-agent-applied{background:rgba(96,165,250,0.15);color:var(--blue)}
  .s-changes-requested{background:rgba(245,158,11,0.15);color:var(--amber)}
  .s-rejected,.s-rolled-back{background:rgba(239,68,68,0.15);color:var(--red)}
  .s-agent-failed,.s-capture-failed{background:rgba(239,68,68,0.1);color:var(--red)}
  .sev{font-family:var(--mono);font-size:.68rem;padding:2px 6px;border-radius:3px;font-weight:600}
  .sev-critical,.sev-blocking{background:rgba(239,68,68,0.2);color:var(--red)}
  .sev-high,.sev-major{background:rgba(245,158,11,0.2);color:var(--amber)}
  .sev-medium,.sev-moderate{background:rgba(96,165,250,0.15);color:var(--blue)}
  .sev-low,.sev-minor,.sev-info{background:rgba(107,127,148,0.15);color:var(--text-dim)}
  code{font-family:var(--mono);font-size:.76rem;color:var(--cyan);background:rgba(34,211,238,0.08);padding:2px 6px;border-radius:4px}
  .applied-file{background:rgba(52,211,153,0.12);border-color:var(--green)}
  .detail-files{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}.detail-files code{font-size:.7rem;padding:2px 6px}
  .mono{font-family:var(--mono);font-size:.76rem}.empty{color:var(--text-dim);font-style:italic;text-align:center;padding:16px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:7px 10px;font-size:.7rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);font-family:var(--mono)}
  td{padding:7px 10px;font-size:.8rem;border-bottom:1px solid rgba(30,45,61,0.5);vertical-align:middle}
  tr:hover td{background:rgba(34,211,238,0.03)}
  .active-model td{background:rgba(52,211,153,0.06)}.active-model code{color:var(--green)}
  .model-btn{background:transparent;border:1px solid var(--border);color:var(--cyan);border-radius:4px;padding:3px 8px;font-family:var(--mono);font-size:.7rem;cursor:pointer;transition:all .2s}
  .model-btn:hover{border-color:var(--cyan);background:rgba(34,211,238,0.1)}
  .model-btn.active{background:rgba(52,211,153,0.15);border-color:var(--green);color:var(--green);cursor:default}
  .model-btn.pull-btn{border-color:var(--amber);color:var(--amber)}
  .model-btn.pull-btn:hover{background:rgba(251,191,36,0.1)}
  .model-btn:disabled{opacity:.5;cursor:wait}
  .implement-btn{background:rgba(52,211,153,0.12);border:1px solid var(--green);color:var(--green);border-radius:6px;padding:5px 12px;font-family:var(--mono);font-size:.72rem;cursor:pointer;font-weight:600;transition:all .2s}
  .implement-btn:hover{background:rgba(52,211,153,0.25)}
  .implement-btn:disabled{opacity:.4;cursor:wait}
  .suppress-btn{background:rgba(107,127,148,0.1);border:1px solid var(--border);color:var(--text-dim);border-radius:6px;padding:5px 12px;font-family:var(--mono);font-size:.72rem;cursor:pointer;transition:all .2s}
  .suppress-btn:hover{background:rgba(107,127,148,0.2);color:var(--text)}
  .server-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
  .server-dot.online{background:var(--green);box-shadow:0 0 6px var(--green)}.server-dot.offline{background:var(--red)}
  .nav-link{font-family:var(--mono);font-size:.72rem;color:var(--purple);background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.25);border-radius:6px;padding:5px 10px;text-decoration:none;transition:all .2s;display:inline-flex;align-items:center;gap:5px}
  .nav-link:hover{background:rgba(167,139,250,0.2);border-color:var(--purple)}
  .nav-dot{font-size:0.5rem}.nav-dot.online{color:var(--green)}.nav-dot.offline{color:var(--red)}
  .footer{text-align:center;padding:24px;color:var(--text-dim);font-family:var(--mono);font-size:.68rem;border-top:1px solid var(--border);margin-top:24px}
  @media(max-width:960px){.brief{grid-template-columns:1fr}.brief-stats{justify-content:center}}
</style>
</head>
<body>

<div class="header">
  <h1>KAAYKO API <span>\u2022 AUTOMATION ENGINE</span></h1>
  <div class="header-meta">
    <a href="http://localhost:4400" class="nav-link" id="nav-frontend">\u2194 Frontend <span class="nav-dot" id="frontend-dot">\u25cf</span></a>
    <span class="engine-badge"><span id="server-dot" class="server-dot offline"></span><span id="server-label">serve offline</span></span>
    <span class="engine-badge">model <b>${esc(summary.runtime.model)}</b></span>
  </div>
</div>

<div class="dash">

  <!-- Intelligence Brief -->
  <div class="row">
    <div class="brief">
      <div class="brief-body">
        ${briefLines.map((l) => `<div class="brief-line">${l}</div>`).join("")}
      </div>
      <div class="brief-stats">
        <div class="brief-stat glow-cyan"><span class="bv">${summary.totals.runs}</span><span class="bl">Missions</span></div>
        <div class="brief-stat glow-green"><span class="bv">${summary.totals.approved}</span><span class="bl">Approved</span></div>
        <div class="brief-stat${summary.totals.suggestions ? " glow-amber" : ""}"><span class="bv">${summary.totals.suggestions}</span><span class="bl">Findings</span></div>
        <div class="brief-stat${summary.totals.vulnerabilities ? " glow-red" : ""}"><span class="bv">${summary.totals.vulnerabilities}</span><span class="bl">Vulns</span></div>
      </div>
    </div>
  </div>

  <!-- Module Health -->
  <div class="row">
    <div class="panel"><h2>Module Health</h2>
      <div class="health-grid">${moduleChips}</div>
    </div>
  </div>

  <!-- Main two-column: Timeline + Findings -->
  <div class="row row-3">
    <!-- Activity Timeline -->
    <div class="panel"><h2>Activity Timeline</h2>
      ${timelineEntries ? `<div class="timeline">${timelineEntries}</div>` : `<p class="empty">No missions recorded yet.</p>`}
    </div>

    <!-- Open Findings -->
    <div class="panel"><h2>Open Findings (${allFindings.length})</h2>
      ${findingsCards || `<p class="empty">No open findings.</p>`}
      ${allFindings.length > 10 ? `<p style="text-align:center;margin-top:10px"><button class="model-btn" onclick="loadFindings()" id="findings-refresh-btn">\u21bb Load all from server</button></p>` : ""}
      <div id="findings-container"></div>
    </div>
  </div>

  <!-- Launch Pad -->
  <div class="row">
    <div class="launch-compact" id="launchpad">
      <h2>Launch Mission</h2>
      <div class="mod-chips">${moduleOptions}</div>
      <input id="lp-area" type="hidden" value="${esc(selectedModule.area)}">
      <div class="launch-row">
        <input id="lp-goal" type="text" placeholder="Describe the mission \u2014 e.g. Audit auth middleware for gaps"/>
      </div>
      <div class="mode-chips">${modeButtons}</div>
      <input id="lp-mode" type="hidden" value="${defaultLaunchMode}">
      <div class="preset-row">${presetButtons}</div>
      <div class="launch-actions">
        <button id="lp-launch" onclick="launchMission()" disabled>LAUNCH</button>
        <span id="lp-status" class="launch-status" id="launch-guide">Waiting for server\u2026</span>
      </div>
      <div id="lp-log-area" class="launch-log-area" style="display:none">
        <pre id="lp-log" class="launch-log"></pre>
      </div>
    </div>
  </div>

  <!-- Models -->
  <div class="row"><details class="panel"><summary><h2>Model Roster <button class="model-btn" onclick="event.stopPropagation();refreshModels()" style="font-size:.68rem;padding:2px 8px;margin-left:10px;vertical-align:middle" id="model-refresh-btn">\u21bb refresh</button></h2></summary>
    <div id="model-roster-container"><table id="model-table"><thead><tr><th></th><th>Model</th><th>Best For</th><th>Size</th><th>Status</th><th></th></tr></thead><tbody>${modelRows}</tbody></table></div>
  </details></div>

</div>

<div class="footer">KAAYKO API AUTOMATION ENGINE \u00b7 ${esc(summary.generated_at)} \u00b7 <button class="model-btn" onclick="manualRefresh()" style="font-size:.68rem;padding:3px 10px">\u21bb Refresh</button></div>

<script>
if(location.protocol==='file:'){fetch('http://localhost:7799/api/health',{signal:AbortSignal.timeout(2000)}).then(r=>{if(r.ok)location.replace('http://localhost:7799/')}).catch(()=>{})}
const BASE=(location.protocol==='file:'||location.origin==='null')?'http://localhost:7799':location.origin;let serverOnline=false;let activePollToken=null;

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function postHeaders(){return {'Content-Type':'application/json','X-CSRF-Token':window.__CSRF_TOKEN||''}}

// Relative time display
function timeAgo(iso){if(!iso)return'';const d=new Date(iso),now=Date.now(),ms=now-d.getTime();if(ms<0)return'just now';const m=Math.floor(ms/60000);if(m<1)return'just now';if(m<60)return m+'m ago';const hr=Math.floor(m/60);if(hr<24)return hr+'h ago';const dy=Math.floor(hr/24);if(dy<30)return dy+'d ago';return d.toLocaleDateString()}
function refreshTimestamps(){document.querySelectorAll('.tl-time[data-ts]').forEach(el=>{const ago=timeAgo(el.dataset.ts);if(ago)el.textContent=ago})}

// Module selection
function syncSelectedModule(area){const input=document.getElementById('lp-area');if(input)input.value=area;document.querySelectorAll('.mod-chip').forEach(c=>{const active=c.dataset.area===area;c.classList.toggle('selected',active);c.setAttribute('aria-pressed',active?'true':'false')})}
function setLaunchMode(mode){const input=document.getElementById('lp-mode');if(input)input.value=mode;document.querySelectorAll('.mode-chip').forEach(c=>{const active=c.dataset.mode===mode;c.classList.toggle('selected',active);c.setAttribute('aria-pressed',active?'true':'false')})}

async function checkServer(){try{const c=new AbortController();const t=setTimeout(()=>c.abort(),2000);const r=await fetch(BASE+'/api/health',{signal:c.signal,mode:'cors'});clearTimeout(t);if(r.ok){const d=await r.json();serverOnline=true;const dot=document.getElementById('server-dot'),lbl=document.getElementById('server-label');if(dot&&d.busy){dot.className='server-dot online';dot.style.background='var(--amber)';dot.style.boxShadow='0 0 6px var(--amber)';lbl.textContent='busy: '+d.activeMission.area+' ('+d.activeMission.elapsed+'s)';lbl.style.color='var(--amber)'}else if(dot){dot.className='server-dot online';dot.style.background='';dot.style.boxShadow='';lbl.textContent='serve active';lbl.style.color=''}}}catch{serverOnline=false}const d=document.getElementById('server-dot'),l=document.getElementById('server-label');if(!serverOnline&&d){d.className='server-dot offline';d.style.background='';d.style.boxShadow='';l.textContent='serve offline';l.style.color=''}const b=document.getElementById('lp-launch');if(b)b.disabled=!serverOnline;const s=document.getElementById('lp-status');if(s){if(serverOnline){s.textContent='Ready';s.style.color='var(--green)'}else{s.textContent='Server offline';s.style.color='var(--amber)'}}}

async function launchMission(){if(!serverOnline)return;const a=document.getElementById('lp-area').value,g=document.getElementById('lp-goal').value.trim(),m=document.getElementById('lp-mode').value,s=document.getElementById('lp-status');if(!g){s.textContent='Write a mission goal first';s.style.color='var(--red)';return}const b=document.getElementById('lp-launch');b.disabled=true;s.textContent='Launching...';s.style.color='var(--amber)';try{const r=await fetch(BASE+'/api/launch',{method:'POST',headers:postHeaders(),body:JSON.stringify({area:a,goal:g,mode:m,goalMode:m==='dry-run'?'edit':m})});const d=await r.json();if(r.status===409){s.textContent=d.error||'Mission already running';s.style.color='var(--amber)';b.disabled=false;return}if(d.ok){s.textContent='Running (PID '+d.pid+')';s.style.color='var(--green)';activePollToken=d.logFile;document.getElementById('lp-log-area').style.display='block';pollLog()}else{s.textContent=d.error||'Failed';s.style.color='var(--red)';b.disabled=false}}catch(e){s.textContent=e.message;s.style.color='var(--red)';b.disabled=false}}

async function pollLog(){if(!activePollToken)return;try{const r=await fetch(BASE+'/api/log/'+activePollToken);if(r.ok){const t=await r.text();const el=document.getElementById('lp-log');el.textContent=t;el.scrollTop=el.scrollHeight;if(t.includes('[exit ')){document.getElementById('lp-status').textContent='Complete';document.getElementById('lp-status').style.color='var(--green)';document.getElementById('lp-launch').disabled=false;activePollToken=null;return}}}catch{}setTimeout(pollLog,1500)}

async function switchModel(id){if(!serverOnline){alert('Start kaayko-api serve first');return}try{const r=await fetch(BASE+'/api/model',{method:'POST',headers:postHeaders(),body:JSON.stringify({model:id})});const d=await r.json();if(d.ok){await refreshModels()}}catch(e){alert('Error: '+e.message)}}

async function pullModel(id,btn){if(!serverOnline){alert('Start kaayko-api serve first');return}btn.disabled=true;btn.textContent='pulling...';btn.style.color='var(--amber)';try{const r=await fetch(BASE+'/api/pull',{method:'POST',headers:postHeaders(),body:JSON.stringify({model:id})});const d=await r.json();if(d.ok){btn.textContent='started...';pollPull(id,btn)}else{btn.textContent=d.error||'failed';btn.style.color='var(--red)';setTimeout(()=>{btn.textContent='pull';btn.style.color='';btn.disabled=false},3000)}}catch(e){btn.textContent='error';btn.style.color='var(--red)';setTimeout(()=>{btn.textContent='pull';btn.style.color='';btn.disabled=false},3000)}}

async function pollPull(id,btn){let tries=0;const poll=async()=>{tries++;try{const r=await fetch(BASE+'/api/models');const d=await r.json();if(d.ok){const m=d.models.find(x=>x.id===id);if(m&&m.installed){btn.textContent='\\u2713 done';btn.style.color='var(--green)';setTimeout(()=>refreshModels(),500);return}}}catch{}if(tries<60){setTimeout(poll,5000)}else{btn.textContent='timeout';btn.style.color='var(--amber)';setTimeout(()=>{btn.textContent='pull';btn.style.color='';btn.disabled=false},3000)}};setTimeout(poll,3000)}

async function refreshModels(){if(!serverOnline)return;const btn=document.getElementById('model-refresh-btn');if(btn){btn.disabled=true;btn.textContent='\\u21bb ...'}try{const r=await fetch(BASE+'/api/models');const d=await r.json();if(d.ok&&d.html){const tbl=document.getElementById('model-table');if(tbl){const tbody=tbl.querySelector('tbody');if(tbody)tbody.innerHTML=d.html}}}catch(e){console.error('refreshModels error',e)}finally{if(btn){btn.disabled=false;btn.textContent='\\u21bb refresh'}}}

window._findingsData=[];
async function loadFindings(){if(!serverOnline){alert('Start kaayko-api serve first');return}const container=document.getElementById('findings-container');const btn=document.getElementById('findings-refresh-btn');if(btn){btn.disabled=true;btn.textContent='\\u21bb loading...'}container.innerHTML='<p class="empty">Loading...</p>';try{const r=await fetch(BASE+'/api/findings');const d=await r.json();if(!d.ok){container.innerHTML='<p class="empty">Error: '+(d.error||'unknown')+'</p>';return}const findings=d.findings||[];window._findingsData=findings;if(!findings.length){container.innerHTML='<p class="empty">No open findings.</p>';return}container.innerHTML=findings.map((f,i)=>{const sevClass='sev-'+(f.severity||'info');const lineRefs=(f.line_refs||[]).map(r=>'<code class="line-ref">'+esc(r.file)+':'+r.start_line+(r.end_line&&r.end_line!==r.start_line?'-'+r.end_line:'')+'</code>').join(' ');const filePaths=(f.file_paths||[]).filter(p=>p).map(p=>'<code>'+esc(p)+'</code>').join(' ');const refLine=(lineRefs||filePaths)?'<div class="finding-refs">'+(lineRefs||filePaths)+'</div>':'';return '<div class="finding-card'+(f.severity==='critical'||f.severity==='blocking'?' finding-critical':'')+'" id="finding-'+i+'"><div class="finding-header"><span class="sev '+esc(sevClass)+'">'+esc(f.severity||'info')+'</span><span class="finding-title">'+esc(f.title)+'</span><span id="finding-status-'+i+'" class="finding-status"></span></div><div class="finding-detail">'+esc(f.detail||'')+'</div>'+refLine+'<div class="finding-meta"><code>'+esc(f.track)+'</code><button class="implement-btn" onclick="implementFinding('+i+',this)">\\u26a1 Fix</button><button class="suppress-btn" onclick="suppressFinding('+i+',this)">\\u2715 Suppress</button></div></div>'}).join('')}catch(e){container.innerHTML='<p class="empty">Error: '+esc(e.message)+'</p>'}finally{if(btn){btn.disabled=false;btn.textContent='\\u21bb Load all from server'}}}

async function implementFinding(idx,btn){if(!serverOnline){alert('Start kaayko-api serve first');return}const findings=window._findingsData;if(!findings[idx]){alert('Finding data not loaded');return}const f=findings[idx];btn.disabled=true;btn.textContent='\\u26a1 running...';const status=document.getElementById('finding-status-'+idx);if(status){status.textContent='agent running...';status.className='finding-status implementing'}try{const r=await fetch(BASE+'/api/implement',{method:'POST',headers:postHeaders(),body:JSON.stringify({track:f.track,title:f.title,detail:f.detail,severity:f.severity,line_refs:f.line_refs||[],file_paths:f.file_paths||[]})});const d=await r.json();if(d.ok){if(status){status.textContent='\\u2713 launched (PID '+d.pid+')';status.className='finding-status done'}btn.textContent='\\u2713 launched'}else{if(status){status.textContent='failed: '+(d.error||'unknown');status.className='finding-status error'}btn.textContent='retry';btn.disabled=false}}catch(e){if(status){status.textContent='error: '+e.message;status.className='finding-status error'}btn.textContent='retry';btn.disabled=false}}

function suppressFinding(idx,btn){const findings=window._findingsData;if(!findings[idx])return;const f=findings[idx];if(!confirm('Suppress "'+f.title+'" as a false positive?'))return;btn.disabled=true;btn.textContent='suppressed';btn.style.color='var(--green)';const card=document.getElementById('finding-'+idx);if(card){card.style.opacity='0.4';card.style.borderColor='var(--text-dim)'}}

function manualRefresh(){location.reload()}
function toggleDetail(id){const r=document.getElementById(id);if(!r)return;r.style.display=r.style.display==='none'?'block':'none'}

// Event wiring
document.querySelectorAll('.mod-chip').forEach(c=>{c.addEventListener('click',()=>syncSelectedModule(c.dataset.area))});
document.querySelectorAll('.mode-chip').forEach(c=>{c.addEventListener('click',()=>setLaunchMode(c.dataset.mode))});
document.querySelectorAll('.preset-btn').forEach(btn=>{btn.addEventListener('click',()=>{if(btn.dataset.mode)setLaunchMode(btn.dataset.mode);const gi=document.getElementById('lp-goal');if(gi){gi.value=btn.dataset.goal||'';gi.focus()}})});
document.querySelectorAll('.health-chip').forEach(c=>{c.addEventListener('click',()=>{syncSelectedModule(c.dataset.area);const lp=document.getElementById('launchpad');if(lp)lp.scrollIntoView({behavior:'smooth',block:'start'})})});

syncSelectedModule('${esc(selectedModule.area)}');setLaunchMode('${esc(defaultLaunchMode)}');
refreshTimestamps();setInterval(refreshTimestamps,60000);
checkServer();setInterval(checkServer,15000);

async function checkSibling(){try{const r=await fetch('http://localhost:4400/api/health',{signal:AbortSignal.timeout(2000),mode:'cors'});const dot=document.getElementById('frontend-dot');if(dot)dot.className='nav-dot '+(r.ok?'online':'offline')}catch{const dot=document.getElementById('frontend-dot');if(dot)dot.className='nav-dot offline'}}
checkSibling();setInterval(checkSibling,15000);

setTimeout(async()=>{if(serverOnline){await refreshModels();loadFindings()}},2500);
</script>
</body>
</html>`;
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = { generateDashboard, buildDashboardMarkdown, buildDashboardHtml, buildModelRoster };
