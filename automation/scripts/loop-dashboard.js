"use strict";

const fs = require("fs");
const path = require("path");
const h = require("./loop-helpers");
const { loadSuppressions, isSuppressed, fingerprintFinding, processFindings } = require("./finding-intelligence");

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

  // Run finding intelligence pipeline for verified findings (same as /api/findings)
  try {
    const fiResult = processFindings(manifests, h.REPO_ROOT);
    summary.verified_findings = fiResult.findings;
    summary.finding_stats = fiResult.stats;
  } catch {
    summary.verified_findings = [];
    summary.finding_stats = null;
  }

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
    { key: "1", area: "weather", name: "Weather", icon: "\ud83c\udf0a" },
    { key: "2", area: "commerce", name: "Commerce", icon: "\ud83d\uded2" },
    { key: "3", area: "kortex", name: "Kortex", icon: "\ud83d\udd17" },
    { key: "4", area: "kreator", name: "Kreator", icon: "\ud83c\udfa8" },
    { key: "5", area: "kamera", name: "Kamera", icon: "\ud83d\udcf7" },
    { key: "6", area: "kutz", name: "Kutz", icon: "\ud83c\udf4e" },
    { key: "7", area: "shared", name: "Shared", icon: "\u2699\ufe0f" }
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
    { id: "audit", label: "Audit" },
    { id: "edit", label: "Edit" },
    { id: "dry-run", label: "Dry Run" }
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

  // ── Use verified findings from intelligence pipeline (same as /api/findings + Fix All) ──
  const verifiedFindings = summary.verified_findings || [];
  const allFindings = verifiedFindings.length > 0 ? verifiedFindings : (summary.open_findings || []);
  const vulnFindings = verifiedFindings.length > 0
    ? verifiedFindings.filter((f) => f.severity === "critical" || f.severity === "high" || f.severity === "blocking" || f.severity === "major")
    : (summary.vulnerability_findings || []);
  const findingGroups = [];
  const seenTitles = new Map();
  allFindings.forEach((f) => {
    const key = f.title;
    if (seenTitles.has(key)) {
      const group = findingGroups[seenTitles.get(key)];
      group.count++;
      if (!group.tracks.includes(f.track)) group.tracks.push(f.track);
      if (f.line_refs) group.allRefs.push(...f.line_refs);
    } else {
      seenTitles.set(key, findingGroups.length);
      findingGroups.push({ ...f, count: 1, tracks: [f.track], allRefs: [...(f.line_refs || [])] });
    }
  });
  // Sort: highest severity first, then by count
  const sevOrder = { critical: 0, blocking: 0, high: 1, major: 1, medium: 2, moderate: 2, low: 3, minor: 3, info: 4 };
  findingGroups.sort((a, b) => (sevOrder[a.severity] ?? 5) - (sevOrder[b.severity] ?? 5) || b.count - a.count);

  // ── Compute per-module health ──
  const moduleHealth = modules.map((m) => {
    const t = summary.tracks.find((tr) => tr.track === m.area) || {};
    return { ...m, runs: t.runs || 0, vulns: t.vulnerabilities || 0, sugs: t.suggestions || 0, approved: t.approved || 0 };
  });
  const scannedModules = moduleHealth.filter((m) => m.runs > 0);
  const unscannedModules = moduleHealth.filter((m) => m.runs === 0);

  // ── Build smart recommendations ──
  const actions = [];
  // Recommend scanning unscanned modules
  if (unscannedModules.length > 0) {
    const names = unscannedModules.map((m) => m.name).join(", ");
    actions.push({ priority: 3, icon: "\ud83d\udd0d", text: `${unscannedModules.length} module${unscannedModules.length > 1 ? "s" : ""} never scanned: ${names}`, action: `audit`, area: unscannedModules[0].area, color: "var(--text-dim)" });
  }
  // Recommend fixing modules with vulns
  moduleHealth.filter((m) => m.vulns > 0).sort((a, b) => b.vulns - a.vulns).forEach((m) => {
    actions.push({ priority: 1, icon: "\ud83d\udee1\ufe0f", text: `<b>${m.name}</b> has ${m.vulns} vulnerabilit${m.vulns === 1 ? "y" : "ies"} across ${m.runs} run${m.runs !== 1 ? "s" : ""}`, action: "edit", area: m.area, color: "var(--red)" });
  });
  // Recommend quality gate fixes (deduplicated)
  const gateFailGroups = findingGroups.filter((g) => g.title.toLowerCase().includes("quality gate"));
  gateFailGroups.forEach((g) => {
    actions.push({ priority: 2, icon: "\u26a0\ufe0f", text: `<b>${g.tracks.join(", ")}</b>: ${g.title}${g.count > 1 ? ` (${g.count}\u00d7)` : ""}`, action: "edit", area: g.tracks[0], color: "var(--amber)" });
  });
  actions.sort((a, b) => a.priority - b.priority);

  // ── Time context ──
  const now = new Date();
  const latestRun = summary.recent_runs[0] || null;
  const lastRunAge = latestRun ? Math.round((now - new Date(latestRun.updated_at)) / 60000) : null;

  // ── Group timeline by "session" (same track within 10 min) ──
  const timelineGroups = [];
  summary.recent_runs.slice(0, 20).forEach((run) => {
    const lastGroup = timelineGroups[timelineGroups.length - 1];
    const ts = new Date(run.updated_at || run.created_at || 0);
    if (lastGroup && lastGroup.track === (run.requested_area || run.track) && (lastGroup.lastTs - ts) < 600000) {
      lastGroup.runs.push(run);
      lastGroup.lastTs = ts;
      lastGroup.totalFindings += (run.suggestions_count || 0) + (run.vulnerabilities_count || 0);
      lastGroup.totalEdited += (run.agent_applied_files || []).length;
      lastGroup.totalInspected += (run.agent_selected_files || []).length;
    } else {
      timelineGroups.push({
        track: run.requested_area || run.track,
        firstTs: ts,
        lastTs: ts,
        runs: [run],
        totalFindings: (run.suggestions_count || 0) + (run.vulnerabilities_count || 0),
        totalEdited: (run.agent_applied_files || []).length,
        totalInspected: (run.agent_selected_files || []).length
      });
    }
  });

  const timelineHtml = timelineGroups.slice(0, 8).map((group, gIdx) => {
    const run = group.runs[0]; // representative run
    const ts = run.updated_at || run.created_at || "";
    const mode = run.agent_goal_mode || "edit";
    const modeClass = mode === "audit" ? "tl-audit" : (mode === "dry-run" ? "tl-dry" : "tl-edit");
    const statusClass = run.status.replace(/_/g, "-");
    const detailId = `tl-d-${gIdx}`;
    const batchLabel = group.runs.length > 1 ? `<span class="tl-batch">${group.runs.length} runs</span>` : "";

    // Summary line — prefer agent_summary, fall back to generated
    let summaryText = "";
    if (run.agent_summary) {
      summaryText = run.agent_summary.length > 140 ? run.agent_summary.slice(0, 140) + "\u2026" : run.agent_summary;
    }

    // Detail panel
    let detailHtml = "";
    group.runs.forEach((r, rIdx) => {
      const fList = (r.vulnerability_findings || []).concat(r.suggestion_findings || []);
      const applied = r.agent_applied_files || [];
      const inspected = r.agent_selected_files || [];
      if (group.runs.length > 1) detailHtml += `<div class="tl-run-sep">Run ${rIdx + 1} \u00b7 ${esc(r.run_id.slice(0, 16))}</div>`;
      if (r.agent_summary) detailHtml += `<div class="tl-detail-summary">${esc(r.agent_summary)}</div>`;
      if (fList.length) {
        detailHtml += fList.slice(0, 4).map((f) => `<div class="tl-detail-finding"><span class="sev sev-${esc(f.severity || "info")}">${esc(f.severity || "info")}</span> ${esc(f.title)}</div>`).join("");
        if (fList.length > 4) detailHtml += `<div class="tl-detail-more">+${fList.length - 4} more findings</div>`;
      }
      if (applied.length) {
        detailHtml += `<div class="tl-detail-files"><b>Edited:</b> ${applied.map((f) => `<code class="applied-file">${esc(typeof f === "string" ? f : f.path || String(f))}</code>`).join(" ")}</div>`;
      } else if (inspected.length) {
        detailHtml += `<div class="tl-detail-files"><b>Inspected:</b> ${inspected.slice(0, 6).map((f) => `<code>${esc(typeof f === "string" ? f : f.path || f.relative_path || String(f))}</code>`).join(" ")}${inspected.length > 6 ? ` <code>+${inspected.length - 6}</code>` : ""}</div>`;
      }
    });

    // Metrics line
    const metricsItems = [];
    if (group.totalEdited > 0) metricsItems.push(`<span style="color:var(--green)">${group.totalEdited} edited</span>`);
    else if (group.totalInspected > 0) metricsItems.push(`${group.totalInspected} inspected`);
    if (group.totalFindings > 0) metricsItems.push(`${group.totalFindings} findings`);
    const metrics = metricsItems.join(" \u00b7 ") || "no changes";

    return `<div class="tl-entry" onclick="toggleDetail('${detailId}')">
      <div class="tl-gutter"><span class="tl-dot s-dot-${esc(statusClass)}"></span><span class="tl-line-v"></span></div>
      <div class="tl-body">
        <div class="tl-row-1">
          <span class="tl-time" data-ts="${esc(ts)}">${esc(ts.slice(0, 16).replace("T", " "))}</span>
          <span class="tl-track">${esc(group.track)}</span>
          <span class="tl-mode ${modeClass}">${esc(mode.toUpperCase().replace("-", " "))}</span>
          ${batchLabel}
          <span class="status-badge s-${esc(statusClass)}">${statusIcon(run.status)}</span>
        </div>
        ${summaryText ? `<div class="tl-summary">${esc(summaryText)}</div>` : ""}
        <div class="tl-metrics">${metrics}</div>
        <div class="tl-expand" id="${detailId}" style="display:none"><div class="tl-expand-inner">${detailHtml}</div></div>
      </div>
    </div>`;
  }).join("");

  // ── Deduplicated findings cards ──
  const findingsHtml = findingGroups.slice(0, 12).map((f, i) => {
    const sevClass = "sev-" + (f.severity || "info");
    const isVuln = f.severity === "critical" || f.severity === "blocking" || f.severity === "high" || f.severity === "major";
    const countBadge = f.count > 1 ? `<span class="finding-count">${f.count}\u00d7</span>` : "";
    const trackBadges = f.tracks.map((t) => `<code>${esc(t)}</code>`).join(" ");
    const refs = f.allRefs.slice(0, 3).map((r) => `<code class="line-ref">${esc(r.file)}:${r.start_line}</code>`).join(" ");
    const moreRefs = f.allRefs.length > 3 ? `<code class="line-ref">+${f.allRefs.length - 3}</code>` : "";
    const verifiedBadge = f.verification === "verified" ? `<span class="sev sev-low" style="font-size:.5rem;padding:1px 4px">\u2713 verified</span>` : "";
    return `<div class="finding-card${isVuln ? " finding-vuln" : ""}" id="fg-${i}">
      <div class="finding-header">
        <span class="sev ${esc(sevClass)}">${esc(f.severity || "info")}</span>
        <span class="finding-title">${esc(f.title)}</span>
        ${countBadge}${verifiedBadge}
      </div>
      ${f.detail ? `<div class="finding-detail">${esc(f.detail.length > 200 ? f.detail.slice(0, 200) + "\u2026" : f.detail)}</div>` : ""}
      ${refs ? `<div class="finding-refs">${refs}${moreRefs}</div>` : ""}
      <div class="finding-meta">${trackBadges}</div>
    </div>`;
  }).join("");

  // ── Module health cards (proper grid) ──
  const healthCards = moduleHealth.map((m) => {
    let statusColor = "var(--green)";
    let statusText = "clean";
    let barPct = 100;
    if (m.runs === 0) { statusColor = "var(--text-dim)"; statusText = "unscanned"; barPct = 0; }
    else if (m.vulns > 0) { statusColor = "var(--red)"; statusText = `${m.vulns} vuln${m.vulns !== 1 ? "s" : ""}`; barPct = Math.max(10, 100 - m.vulns * 15); }
    else if (m.sugs > 0) { statusColor = "var(--amber)"; statusText = `${m.sugs} issue${m.sugs !== 1 ? "s" : ""}`; barPct = Math.max(20, 100 - m.sugs * 5); }
    return `<div class="hc" data-area="${esc(m.area)}">
      <div class="hc-top">
        <span class="hc-icon">${m.icon}</span>
        <span class="hc-name">${esc(m.name)}</span>
        <span class="hc-status" style="color:${statusColor}">${statusText}</span>
      </div>
      <div class="hc-bar"><div class="hc-bar-fill" style="width:${barPct}%;background:${statusColor}"></div></div>
      <div class="hc-meta">${m.runs} run${m.runs !== 1 ? "s" : ""} \u00b7 ${m.approved} approved</div>
    </div>`;
  }).join("");

  // ── Target cards (module selection + health combined) ──
  const targetCards = moduleHealth.map((m) => {
    const selected = m.area === selectedModule.area;
    let statusColor = "var(--green)"; let statusText = "\u2713"; let barPct = 100;
    if (m.runs === 0) { statusColor = "var(--text-dim)"; statusText = "\u2014"; barPct = 0; }
    else if (m.vulns > 0) { statusColor = "var(--red)"; statusText = `${m.vulns} vln`; barPct = Math.max(10, 100 - m.vulns * 15); }
    else if (m.sugs > 0) { statusColor = "var(--amber)"; statusText = `${m.sugs} sug`; barPct = Math.max(20, 100 - m.sugs * 5); }
    return `<div class="target-card${selected ? " selected" : ""}" data-area="${esc(m.area)}" data-icon="${m.icon}" data-name="${esc(m.name)}">
      <span class="tc-icon">${m.icon}</span>
      <span class="tc-name">${esc(m.name)}</span>
      <span class="tc-status" style="color:${statusColor}">${statusText}</span>
      <div class="tc-bar"><div class="tc-bar-fill" style="width:${barPct}%;background:${statusColor}"></div></div>
      <span class="tc-meta">${m.runs ? `${m.runs} run${m.runs !== 1 ? "s" : ""}` : "never"}</span>
    </div>`;
  }).join("");

  // ── Engine pills (model selector strip) ──
  const modelData = roster.length ? roster : recommended.map((m) => ({ ...m, installed: false, active: summary.runtime.model === m.id, size: m.ram }));
  const powerLevel = (id) => { if (id.includes("32b")) return 5; if (id.includes("16b") || id.includes("14b")) return 4; return 3; };
  const shortName = (id) => id.replace("qwen2.5-coder:","qwen:").replace("deepseek-coder-v2:","ds-v2:").replace("llama3.1:","llama:");
  const enginePills = modelData.map((m) => {
    const lvl = powerLevel(m.id);
    const dots = Array.from({length:5},(_,i)=>`<span class="ep-dot${i<lvl?" filled":""}"></span>`).join("");
    const isInstalled = m.installed !== false;
    return `<button class="engine-pill${m.active?" ep-active":""}" data-model="${esc(m.id)}" data-installed="${isInstalled}" data-note="${esc(m.note||"")}" data-size="${esc(m.size||m.ram||"")}" title="${esc((m.note||"")+" \u00b7 "+(m.size||m.ram||""))}">
      <span class="ep-status ${isInstalled?"installed":"not-installed"}"></span>
      <span class="ep-label">${esc(shortName(m.id))}</span>
      <span class="ep-dots">${dots}</span>
    </button>`;
  }).join("");

  // ── Quick missions (contextual, data-driven) ──
  const quickMissions = [];
  actions.slice(0,4).forEach((a) => {
    const pClass = a.priority<=1?"qo-urgent":(a.priority<=2?"qo-warn":"qo-info");
    const goalText = (a.text||"").replace(/<[^>]*>/g,"").slice(0,80);
    quickMissions.push(`<div class="qo-card ${pClass}" data-area="${esc(a.area||"")}" data-mode="${esc(a.action||"audit")}" data-goal="${esc(goalText)}">
      <span class="qo-icon">${a.icon}</span>
      <div class="qo-title">${a.text}</div>
      <div class="qo-sub">${esc(a.area||"")} \u00b7 ${esc(a.action||"audit")}</div>
    </div>`);
  });
  if (quickMissions.length < 4) {
    missionPresets.slice(0, 4 - quickMissions.length).forEach((p) => {
      quickMissions.push(`<div class="qo-card qo-info" data-area="${esc(selectedModule.area)}" data-mode="${esc(p.mode)}" data-goal="${esc(p.goal)}">
        <span class="qo-icon">${p.mode==="audit"?"\ud83d\udd0d":(p.mode==="edit"?"\u270f\ufe0f":"\ud83d\udc41")}</span>
        <div class="qo-title">${esc(p.label)}</div>
        <div class="qo-sub">${esc(p.mode)}</div>
      </div>`);
    });
  }
  const quickMissionsHtml = quickMissions.join("");

  // ── Command bar mode buttons ──
  const modeIcons = { audit: "\ud83d\udd0d", edit: "\u270f\ufe0f", "dry-run": "\ud83d\udc41" };
  const cmdModeButtons = launchModes.map((mode) => {
    const selected = mode.id === defaultLaunchMode;
    return `<button class="cmd-mode-btn${selected?" active":""}" type="button" data-mode="${esc(mode.id)}"><span class="cmd-mode-icon">${modeIcons[mode.id]||""}</span>${esc(mode.label)}</button>`;
  }).join("");

  // ── Module dropdown items ──
  const dropdownItems = modules.map((m) => {
    const mh = moduleHealth.find((x) => x.area === m.area) || {};
    const statusDot = mh.vulns > 0 ? `<span class="dd-status" style="color:var(--red)">\u25cf</span>` : (mh.runs > 0 ? `<span class="dd-status" style="color:var(--green)">\u25cf</span>` : `<span class="dd-status" style="color:var(--text-dim)">\u25cb</span>`);
    return `<div class="cmd-dropdown-item" data-area="${esc(m.area)}" data-icon="${m.icon}" data-name="${esc(m.name)}"><span class="dd-icon">${m.icon}</span>${esc(m.name)}${statusDot}</div>`;
  }).join("");

  // ── Engine strip with confirm bar ──
  const engineStripHtml = `<div class="engine-strip">
      <span class="engine-label">Engine</span>
      ${enginePills}
      <div class="engine-confirm" id="engine-confirm">
        <span class="engine-confirm-label" id="ec-label"></span>
        <button class="engine-confirm-btn ec-activate" id="ec-activate" onclick="confirmEngine()">Activate</button>
        <button class="engine-confirm-btn ec-cancel" onclick="cancelEngineSelect()">\u2715</button>
      </div>
    </div>`;

  // ── Assembled command bar HTML ──
  const cmdBarHtml = `<div class="cmd-bar" id="cmd-bar">
      <div class="cmd-tag" id="cmd-tag" onclick="toggleDropdown(event)">
        <span class="cmd-icon" id="cmd-icon">${selectedModule.icon}</span>
        <span id="cmd-area-label">${esc(selectedModule.name)}</span>
        <span class="cmd-caret">\u25bc</span>
        <div class="cmd-dropdown" id="cmd-dropdown">${dropdownItems}</div>
      </div>
      <span class="cmd-sep">\u25b8</span>
      <input class="cmd-input" id="lp-goal" type="text" placeholder="Describe what the agent should do\u2026" autocomplete="off">
      <input id="lp-area" type="hidden" value="${esc(selectedModule.area)}">
      <input id="lp-mode" type="hidden" value="${defaultLaunchMode}">
      <div class="cmd-mode">${cmdModeButtons}</div>
      <button class="cmd-launch" id="lp-launch" onclick="launchMission()" disabled>LAUNCH</button>
    </div>`;

  // ── Assemble time label ──
  let timeLabel = "";
  if (lastRunAge !== null) {
    if (lastRunAge < 60) timeLabel = `${lastRunAge}m ago`;
    else if (lastRunAge < 1440) timeLabel = `${Math.round(lastRunAge / 60)}h ago`;
    else timeLabel = `${Math.round(lastRunAge / 1440)}d ago`;
  }

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
  body{background:var(--bg);color:var(--text);font-family:var(--sans);min-height:100vh;background-image:radial-gradient(ellipse at 20% 0%,rgba(34,211,238,0.06) 0%,transparent 50%)}

  /* ── Layout ── */
  .header{border-bottom:1px solid var(--border);padding:8px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
  .header h1{font-family:var(--mono);font-size:.88rem;font-weight:700;color:var(--cyan);letter-spacing:.06em}
  .header h1 span{color:var(--text-dim);font-weight:400;font-size:.76rem}
  .header-right{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .hdr-badge{font-family:var(--mono);font-size:.62rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text-dim)}
  .hdr-badge b{color:var(--green)}
  .dash{max-width:1200px;margin:0 auto;padding:10px 14px 24px}
  .grid-main{display:grid;grid-template-columns:1fr 300px;gap:10px;align-items:start}
  @media(max-width:960px){.grid-main{grid-template-columns:1fr}}
  .stack{display:grid;gap:8px}
  .findings-scroll{max-height:420px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
  .findings-scroll::-webkit-scrollbar{width:4px}
  .findings-scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
  .panel{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;overflow:hidden}
  .panel-title{font-family:var(--mono);font-size:.66rem;font-weight:600;color:var(--cyan);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
  details.panel{padding:0}
  details.panel>summary{cursor:pointer;list-style:none;padding:10px;user-select:none}
  details.panel>summary::-webkit-details-marker{display:none}
  details.panel>summary .panel-title{margin-bottom:0;padding-bottom:0;border-bottom:none}
  details.panel>summary::after{content:"\\25bc";float:right;color:var(--text-dim);font-size:.55rem;transition:transform .2s}
  details.panel:not([open])>summary::after{transform:rotate(-90deg)}
  details.panel[open]>*:not(summary){padding:0 10px 10px}
  details.panel[open]>summary{border-bottom:1px solid var(--border);margin-bottom:6px}

  /* ── Score Bar (top) ── */
  .score-bar{display:flex;align-items:stretch;gap:1px;background:var(--border);border-radius:7px;overflow:hidden;margin-bottom:10px}
  .sb-cell{background:var(--surface);padding:8px 0;flex:1;text-align:center;min-width:0}
  .sb-cell:first-child{border-radius:7px 0 0 7px}.sb-cell:last-child{border-radius:0 7px 7px 0}
  .sb-val{font-family:var(--mono);font-size:1.15rem;font-weight:700;display:block;line-height:1.1}
  .sb-label{font-size:.56rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em;margin-top:2px;display:block}
  .sb-sub{font-family:var(--mono);font-size:.54rem;color:var(--text-dim);margin-top:1px;display:block}

  /* ── Actions ── */
  .action-list{display:grid;gap:4px}
  .action-item{display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:6px 8px;cursor:pointer;transition:border-color .15s}
  .action-item:hover{border-color:var(--border-hi)}
  .action-icon{font-size:.85rem;flex-shrink:0}
  .action-text{flex:1;font-size:.72rem;line-height:1.3;color:var(--text)}
  .action-text b{color:var(--text-bright)}
  .action-go{appearance:none;background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.2);color:var(--cyan);border-radius:4px;padding:2px 7px;font-family:var(--mono);font-size:.6rem;cursor:pointer;font-weight:600;flex-shrink:0;transition:all .15s}
  .action-go:hover{background:rgba(34,211,238,0.2)}

  /* ── Module Health ── */
  .health-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:5px}
  .hc{background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:6px 7px;cursor:pointer;transition:border-color .15s}
  .hc:hover{border-color:var(--border-hi)}
  .hc-top{display:flex;align-items:center;gap:4px;margin-bottom:3px}
  .hc-icon{font-size:.75rem}
  .hc-name{font-family:var(--mono);font-size:.64rem;font-weight:600;color:var(--text-bright);flex:1}
  .hc-status{font-family:var(--mono);font-size:.58rem;font-weight:600}
  .hc-bar{height:3px;background:var(--bg);border-radius:2px;overflow:hidden;margin-bottom:2px}
  .hc-bar-fill{height:100%;border-radius:2px;transition:width .3s}
  .hc-meta{font-family:var(--mono);font-size:.52rem;color:var(--text-dim)}

  /* ── Timeline ── */
  .timeline{display:grid;gap:0}
  .tl-entry{display:flex;gap:8px;padding:5px 4px;cursor:pointer;transition:background .12s;border-radius:4px}
  .tl-entry:hover{background:rgba(34,211,238,0.03)}
  .tl-gutter{width:12px;display:flex;flex-direction:column;align-items:center;padding-top:5px;position:relative}
  .tl-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;z-index:1}
  .tl-line-v{flex:1;width:1px;background:var(--border);margin-top:3px}
  .tl-entry:last-child .tl-line-v{display:none}
  .s-dot-approved,.s-dot-reviewed{background:var(--green)}.s-dot-pending-review,.s-dot-agent-applied{background:var(--blue)}
  .s-dot-rejected,.s-dot-rolled-back,.s-dot-agent-failed,.s-dot-capture-failed{background:var(--red)}
  .s-dot-changes-requested{background:var(--amber)}
  .tl-body{flex:1;min-width:0}
  .tl-row-1{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
  .tl-time{font-family:var(--mono);font-size:.6rem;color:var(--text-dim);min-width:36px}
  .tl-track{font-family:var(--mono);font-size:.68rem;font-weight:700;color:var(--text-bright)}
  .tl-mode{font-family:var(--mono);font-size:.58rem;padding:1px 6px;border-radius:3px;font-weight:600}
  .tl-audit{background:rgba(96,165,250,0.15);color:var(--blue)}
  .tl-edit{background:rgba(52,211,153,0.12);color:var(--green)}
  .tl-dry{background:rgba(167,139,250,0.12);color:var(--purple)}
  .tl-batch{font-family:var(--mono);font-size:.6rem;color:var(--text-dim);background:var(--surface2);border-radius:3px;padding:1px 5px}
  .tl-summary{font-size:.68rem;color:var(--text-dim);margin-top:2px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .tl-metrics{font-family:var(--mono);font-size:.58rem;color:var(--text-dim);margin-top:2px}
  .tl-expand{margin-top:6px}
  .tl-expand-inner{background:var(--bg);border-left:2px solid var(--cyan);border-radius:0 6px 6px 0;padding:10px 12px}
  .tl-run-sep{font-family:var(--mono);font-size:.66rem;color:var(--cyan);padding:6px 0 2px;border-top:1px solid var(--border);margin-top:6px}
  .tl-run-sep:first-child{border-top:none;margin-top:0;padding-top:0}
  .tl-detail-summary{font-size:.76rem;color:var(--text);line-height:1.5;margin-bottom:6px}
  .tl-detail-finding{padding:4px 6px;margin:3px 0;border-radius:3px;background:var(--surface2);font-size:.72rem;line-height:1.3}
  .tl-detail-finding .sev{margin-right:4px}
  .tl-detail-more{font-size:.68rem;color:var(--text-dim);padding:2px 0}
  .tl-detail-files{font-size:.7rem;margin-top:4px;line-height:1.5}
  .tl-detail-files b{color:var(--text-dim)}

  /* ── Findings ── */
  .finding-card{background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:7px 8px;margin-bottom:4px;transition:border-color .15s}
  .finding-card:hover{border-color:var(--border-hi)}
  .finding-card.finding-vuln{border-left:2px solid var(--red)}
  .finding-header{display:flex;align-items:center;gap:5px;margin-bottom:2px}
  .finding-title{font-weight:600;font-size:.7rem;color:var(--text-bright);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .finding-count{font-family:var(--mono);font-size:.58rem;color:var(--amber);background:rgba(245,158,11,0.15);border-radius:3px;padding:1px 4px;font-weight:700;flex-shrink:0}
  .finding-detail{font-size:.66rem;color:var(--text-dim);line-height:1.3;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}
  .finding-refs{margin-bottom:3px;display:flex;flex-wrap:wrap;gap:2px}
  .finding-refs code{font-size:.56rem;background:rgba(99,102,241,0.12);color:#818cf8;padding:1px 4px;border-radius:2px}
  .finding-meta{display:flex;gap:3px;align-items:center;flex-wrap:wrap}
  .finding-meta code{font-size:.58rem}

  /* ── Launch pad ── */
  .launch-bar{background:var(--surface);border:1px solid rgba(34,211,238,0.12);border-radius:7px;padding:10px;margin-bottom:8px}
  .launch-bar .panel-title::before{content:"\\25b6 "}
  .mod-chips{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px}
  .mod-chip{appearance:none;font-family:var(--mono);font-size:.6rem;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:3px 6px;cursor:pointer;color:var(--text);transition:all .15s}
  .mod-chip:hover{border-color:var(--cyan);color:var(--text-bright)}
  .mod-chip.selected{border-color:var(--cyan);background:rgba(34,211,238,0.1);color:var(--cyan);font-weight:600}
  .launch-input-row{display:flex;gap:5px;margin-bottom:6px}
  .launch-input-row input{flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text-bright);font-family:var(--mono);font-size:.7rem;outline:none}
  .launch-input-row input:focus{border-color:var(--cyan)}
  #lp-launch{background:var(--cyan);color:var(--bg);border:none;border-radius:4px;padding:6px 14px;font-family:var(--mono);font-size:.68rem;font-weight:700;cursor:pointer;transition:opacity .15s;flex-shrink:0}
  #lp-launch:hover{opacity:.85}#lp-launch:disabled{opacity:.35;cursor:not-allowed}
  .mode-chips{display:flex;gap:3px;margin-bottom:6px}
  .mode-chip{appearance:none;font-family:var(--mono);font-size:.6rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:3px 8px;cursor:pointer;color:var(--text);transition:all .15s}
  .mode-chip:hover{border-color:var(--cyan)}
  .mode-chip.selected{border-color:var(--cyan);background:rgba(34,211,238,0.08);color:var(--cyan)}
  .preset-row{display:flex;flex-wrap:wrap;gap:3px}
  .preset-btn{appearance:none;background:rgba(107,127,148,0.06);border:1px solid rgba(107,127,148,0.12);border-radius:99px;padding:3px 7px;font-family:var(--mono);font-size:.58rem;color:var(--text-dim);cursor:pointer;transition:all .15s}
  .preset-btn:hover{border-color:rgba(34,211,238,0.25);color:var(--text-bright)}
  .launch-status{font-family:var(--mono);font-size:.62rem;color:var(--text-dim);margin-top:4px}
  .launch-log-area{margin-top:10px}
  .launch-log{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;max-height:260px;overflow-y:auto;font-size:.7rem;line-height:1.4;color:var(--text);font-family:var(--mono);white-space:pre-wrap}

  /* ── Shared ── */
  .status-badge{font-family:var(--mono);font-size:.62rem;padding:2px 6px;border-radius:3px;display:inline-block;font-weight:600}
  .s-approved,.s-reviewed{background:rgba(52,211,153,0.15);color:var(--green)}
  .s-pending-review,.s-agent-applied{background:rgba(96,165,250,0.15);color:var(--blue)}
  .s-changes-requested{background:rgba(245,158,11,0.15);color:var(--amber)}
  .s-rejected,.s-rolled-back,.s-agent-failed,.s-capture-failed{background:rgba(239,68,68,0.12);color:var(--red)}
  .sev{font-family:var(--mono);font-size:.62rem;padding:1px 5px;border-radius:3px;font-weight:600}
  .sev-critical,.sev-blocking{background:rgba(239,68,68,0.2);color:var(--red)}
  .sev-high,.sev-major{background:rgba(245,158,11,0.2);color:var(--amber)}
  .sev-medium,.sev-moderate{background:rgba(96,165,250,0.15);color:var(--blue)}
  .sev-low,.sev-minor,.sev-info{background:rgba(107,127,148,0.15);color:var(--text-dim)}
  code{font-family:var(--mono);font-size:.7rem;color:var(--cyan);background:rgba(34,211,238,0.08);padding:1px 5px;border-radius:3px}

  /* ── Fix All ── */
  .fix-all-wrap{margin-top:8px;border-top:1px solid var(--border);padding-top:8px}
  .fix-all-bar{display:flex;align-items:center;gap:8px}
  .fix-all-btn{appearance:none;background:linear-gradient(135deg,rgba(52,211,153,0.15),rgba(34,211,238,0.1));border:1px solid rgba(52,211,153,0.3);color:var(--green);border-radius:6px;padding:6px 14px;font-family:var(--mono);font-size:.66rem;font-weight:700;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:6px;letter-spacing:.03em}
  .fix-all-btn:hover{background:linear-gradient(135deg,rgba(52,211,153,0.25),rgba(34,211,238,0.18));box-shadow:0 0 12px rgba(52,211,153,0.15)}
  .fix-all-btn:disabled{opacity:.35;cursor:not-allowed;box-shadow:none}
  .fix-all-btn .fa-icon{font-size:.8rem}
  .fix-all-info{font-family:var(--mono);font-size:.58rem;color:var(--text-dim);flex:1}
  .fix-all-progress{margin-top:8px;display:none}
  .fix-all-progress.active{display:block}
  .fa-pipeline{display:grid;gap:4px;margin-bottom:8px}
  .fa-step{display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:5px;font-family:var(--mono);font-size:.62rem}
  .fa-step-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .fa-step-dot.pending{background:var(--text-dim);opacity:.4}
  .fa-step-dot.running{background:var(--amber);animation:pulse 1s infinite}
  .fa-step-dot.done{background:var(--green)}
  .fa-step-dot.failed{background:var(--red)}
  .fa-step-track{color:var(--text-bright);font-weight:600;min-width:60px}
  .fa-step-info{color:var(--text-dim);flex:1}
  .fa-step-result{font-weight:600}
  .fa-stats{font-family:var(--mono);font-size:.56rem;color:var(--text-dim);margin-top:4px;padding:6px 8px;background:var(--bg);border-radius:4px;display:flex;gap:12px;flex-wrap:wrap}
  .fa-stat{display:flex;align-items:center;gap:4px}
  .fa-stat-val{font-weight:700}
  .fa-stat-val.good{color:var(--green)}
  .fa-stat-val.warn{color:var(--amber)}
  .fa-stat-val.bad{color:var(--red)}
  .fa-stat-val.dim{color:var(--text-dim)}

  .applied-file{background:rgba(52,211,153,0.12);color:var(--green)}
  .empty{color:var(--text-dim);font-style:italic;text-align:center;padding:14px;font-size:.8rem}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:6px 8px;font-size:.66rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);font-family:var(--mono)}
  td{padding:6px 8px;font-size:.76rem;border-bottom:1px solid rgba(30,45,61,0.5);vertical-align:middle}
  tr:hover td{background:rgba(34,211,238,0.03)}
  .active-model td{background:rgba(52,211,153,0.06)}.active-model code{color:var(--green)}
  .model-btn{background:transparent;border:1px solid var(--border);color:var(--cyan);border-radius:3px;padding:2px 7px;font-family:var(--mono);font-size:.66rem;cursor:pointer;transition:all .15s}
  .model-btn:hover{border-color:var(--cyan);background:rgba(34,211,238,0.1)}
  .model-btn.active{background:rgba(52,211,153,0.15);border-color:var(--green);color:var(--green);cursor:default}
  .model-btn.pull-btn{border-color:var(--amber);color:var(--amber)}
  .model-btn:disabled{opacity:.4;cursor:wait}
  .server-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:middle}
  .server-dot.online{background:var(--green);box-shadow:0 0 5px var(--green)}.server-dot.offline{background:var(--red)}
  .nav-link{font-family:var(--mono);font-size:.66rem;color:var(--purple);background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.2);border-radius:5px;padding:4px 8px;text-decoration:none;transition:all .15s;display:inline-flex;align-items:center;gap:4px}
  .nav-link:hover{background:rgba(167,139,250,0.18)}
  .nav-dot{font-size:.45rem}.nav-dot.online{color:var(--green)}.nav-dot.offline{color:var(--red)}
  .implement-btn{background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.3);color:var(--green);border-radius:5px;padding:4px 10px;font-family:var(--mono);font-size:.66rem;cursor:pointer;font-weight:600;transition:all .15s}
  .implement-btn:hover{background:rgba(52,211,153,0.2)}
  .implement-btn:disabled{opacity:.4;cursor:wait}
  .suppress-btn{background:rgba(107,127,148,0.08);border:1px solid var(--border);color:var(--text-dim);border-radius:5px;padding:4px 10px;font-family:var(--mono);font-size:.66rem;cursor:pointer;transition:all .15s}
  .suppress-btn:hover{color:var(--text);background:rgba(107,127,148,0.15)}
  .finding-status{font-family:var(--mono);font-size:.64rem;padding:2px 6px;border-radius:3px}
  .finding-status.implementing{background:rgba(245,158,11,0.15);color:var(--amber)}
  .finding-status.done{background:rgba(52,211,153,0.15);color:var(--green)}
  .finding-status.error{background:rgba(239,68,68,0.15);color:var(--red)}
  .footer{text-align:center;padding:10px;color:var(--text-dim);font-family:var(--mono);font-size:.56rem;border-top:1px solid var(--border);margin-top:12px}
  @media(max-width:960px){.score-bar{flex-wrap:wrap}.sb-cell{min-width:25%}}

  /* ── Mission Control ── */
  .mission-ctrl{background:var(--surface);border:1px solid rgba(34,211,238,0.12);border-radius:10px;padding:14px;margin-bottom:10px;position:relative;overflow:hidden}
  .mission-ctrl::before{content:'';position:absolute;inset:-1px;border-radius:11px;background:linear-gradient(135deg,rgba(34,211,238,0.08),transparent 60%);pointer-events:none;z-index:0}
  .mission-ctrl>*{position:relative;z-index:1}
  .mission-ctrl .panel-title{margin-bottom:10px}

  /* ── Command Bar ── */
  .cmd-bar{display:flex;align-items:center;background:var(--bg);border:1.5px solid var(--border);border-radius:8px;padding:2px;margin-bottom:12px;transition:border-color .2s,box-shadow .2s}
  .cmd-bar:focus-within{border-color:var(--cyan);box-shadow:0 0 16px rgba(34,211,238,0.08)}
  .cmd-tag{display:flex;align-items:center;gap:5px;background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.2);border-radius:6px;padding:6px 10px;margin:2px;font-family:var(--mono);font-size:.72rem;font-weight:600;color:var(--cyan);cursor:pointer;white-space:nowrap;transition:all .15s;user-select:none;position:relative}
  .cmd-tag:hover{background:rgba(34,211,238,0.18)}
  .cmd-tag .cmd-icon{font-size:.85rem}
  .cmd-tag .cmd-caret{font-size:.5rem;margin-left:2px;opacity:.6}
  .cmd-dropdown{position:absolute;top:calc(100% + 4px);left:0;background:var(--surface);border:1px solid var(--border-hi);border-radius:7px;padding:4px;min-width:160px;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,0.4);display:none}
  .cmd-dropdown.open{display:block}
  .cmd-dropdown-item{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:5px;cursor:pointer;font-family:var(--mono);font-size:.68rem;color:var(--text);transition:all .1s}
  .cmd-dropdown-item:hover{background:rgba(34,211,238,0.08);color:var(--text-bright)}
  .cmd-dropdown-item.dd-active{color:var(--cyan);font-weight:600}
  .cmd-dropdown-item .dd-icon{font-size:.9rem}
  .cmd-dropdown-item .dd-status{font-size:.5rem;margin-left:auto}
  .cmd-sep{color:var(--border);font-size:.8rem;margin:0 2px;user-select:none}
  .cmd-input{flex:1;background:transparent;border:none;padding:8px 10px;color:var(--text-bright);font-family:var(--mono);font-size:.78rem;outline:none;min-width:0}
  .cmd-input::placeholder{color:var(--text-dim);font-style:italic}
  .cmd-mode{display:flex;align-items:center;border-left:1px solid var(--border);margin:4px 0;padding-left:2px;flex-shrink:0}
  .cmd-mode-btn{appearance:none;background:transparent;border:none;font-family:var(--mono);font-size:.62rem;padding:6px 8px;cursor:pointer;color:var(--text-dim);transition:all .15s;border-radius:4px;text-transform:uppercase;letter-spacing:.04em;display:flex;align-items:center;gap:3px}
  .cmd-mode-btn:hover{color:var(--text-bright)}
  .cmd-mode-btn.active{color:var(--cyan);background:rgba(34,211,238,0.08);font-weight:600}
  .cmd-mode-icon{font-size:.7rem}
  .cmd-launch{background:var(--cyan);color:var(--bg);border:none;border-radius:6px;padding:8px 18px;font-family:var(--mono);font-size:.72rem;font-weight:700;cursor:pointer;margin:2px;transition:all .15s;letter-spacing:.05em;flex-shrink:0}
  .cmd-launch:hover{opacity:.85;box-shadow:0 0 16px rgba(34,211,238,0.25)}
  .cmd-launch:disabled{opacity:.25;cursor:not-allowed;box-shadow:none}

  /* ── MC two-column layout ── */
  .mc-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
  @media(max-width:700px){.mc-cols{grid-template-columns:1fr}}
  .section-label{font-family:var(--mono);font-size:.56rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;display:flex;align-items:center;gap:8px}
  .section-label::after{content:'';flex:1;height:1px;background:var(--border)}

  /* ── Target Grid ── */
  .target-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(85px,1fr));gap:5px}
  .target-card{background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:8px 6px;cursor:pointer;transition:all .2s;text-align:center;position:relative}
  .target-card:hover{border-color:var(--border-hi);transform:translateY(-1px)}
  .target-card.selected{border-color:var(--cyan);background:rgba(34,211,238,0.06);box-shadow:0 0 14px rgba(34,211,238,0.1)}
  .target-card.selected::after{content:'';position:absolute;bottom:-1px;left:20%;right:20%;height:2px;background:var(--cyan);border-radius:1px}
  .tc-icon{font-size:1.1rem;display:block;margin-bottom:2px}
  .tc-name{font-family:var(--mono);font-size:.62rem;font-weight:700;color:var(--text-bright);display:block;margin-bottom:2px}
  .tc-status{font-family:var(--mono);font-size:.54rem;font-weight:600;display:block;margin-bottom:3px}
  .tc-bar{height:2px;background:var(--bg);border-radius:1px;overflow:hidden;margin-bottom:2px}
  .tc-bar-fill{height:100%;border-radius:1px;transition:width .3s}
  .tc-meta{font-family:var(--mono);font-size:.48rem;color:var(--text-dim);display:block}

  /* ── Quick Ops ── */
  .quickops{display:grid;gap:5px}
  .qo-card{background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:8px 10px 8px 12px;cursor:pointer;transition:all .2s;position:relative;overflow:hidden}
  .qo-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:7px 0 0 7px}
  .qo-card.qo-urgent::before{background:var(--red)}
  .qo-card.qo-warn::before{background:var(--amber)}
  .qo-card.qo-info::before{background:var(--cyan)}
  .qo-card:hover{border-color:var(--border-hi);transform:translateY(-1px);box-shadow:0 2px 8px rgba(0,0,0,0.2)}
  .qo-card:hover::after{content:'click to load \\2197';position:absolute;top:6px;right:8px;font-family:var(--mono);font-size:.48rem;color:var(--text-dim);letter-spacing:.03em;text-transform:uppercase}
  .qo-icon{font-size:.8rem;margin-right:6px;float:left}
  .qo-title{font-size:.66rem;font-weight:500;color:var(--text-bright);line-height:1.3;margin-bottom:2px}
  .qo-title b{color:var(--text-bright)}
  .qo-sub{font-family:var(--mono);font-size:.52rem;color:var(--text-dim);clear:both}

  /* ── Engine Strip ── */
  .engine-strip{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--border)}
  .engine-label{font-family:var(--mono);font-size:.54rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-right:4px;flex-shrink:0}
  .engine-pill{appearance:none;background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:4px 8px;font-family:var(--mono);font-size:.58rem;color:var(--text);cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:4px;position:relative}
  .engine-pill:hover{border-color:var(--border-hi);color:var(--text-bright);background:var(--surface2)}
  .engine-pill.ep-active{border-color:var(--green);background:rgba(52,211,153,0.08);color:var(--green);font-weight:600}
  .engine-pill.ep-active .ep-label::before{content:'\u25b8 ';font-size:.5rem}
  .engine-pill.ep-selected{border-color:var(--cyan);background:rgba(34,211,238,0.08);color:var(--cyan);box-shadow:0 0 8px rgba(34,211,238,0.1)}
  .engine-confirm{display:none;align-items:center;gap:6px;margin-left:auto;padding-left:10px;flex-shrink:0}
  .engine-confirm.visible{display:flex}
  .engine-confirm-label{font-family:var(--mono);font-size:.56rem;color:var(--text-dim)}
  .engine-confirm-btn{appearance:none;font-family:var(--mono);font-size:.58rem;font-weight:600;border-radius:4px;padding:3px 10px;cursor:pointer;transition:all .15s;border:1px solid}
  .engine-confirm-btn.ec-activate{background:rgba(52,211,153,0.12);border-color:var(--green);color:var(--green)}
  .engine-confirm-btn.ec-activate:hover{background:rgba(52,211,153,0.25)}
  .engine-confirm-btn.ec-pull{background:rgba(245,158,11,0.1);border-color:var(--amber);color:var(--amber)}
  .engine-confirm-btn.ec-pull:hover{background:rgba(245,158,11,0.2)}
  .engine-confirm-btn.ec-cancel{background:transparent;border-color:var(--border);color:var(--text-dim)}
  .engine-confirm-btn.ec-cancel:hover{color:var(--text)}
  .ep-status{width:5px;height:5px;border-radius:50%;flex-shrink:0}
  .ep-status.installed{background:var(--green)}
  .ep-status.not-installed{background:var(--text-dim);opacity:.5}
  .ep-status.pulling{background:var(--amber);animation:pulse 1s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  .ep-label{white-space:nowrap}
  .ep-dots{display:flex;gap:1px;margin-left:2px}
  .ep-dot{width:3px;height:8px;border-radius:1px;background:var(--border)}
  .ep-dot.filled{background:currentColor;opacity:.7}
  .engine-pill.ep-active .ep-dot.filled{background:var(--green);opacity:1}
</style>
</head>
<body>

<div class="header">
  <h1>KAAYKO <span>API Automation</span></h1>
  <div class="header-right">
    <a href="http://localhost:4400" class="nav-link" id="nav-frontend">\u2194 Frontend <span class="nav-dot" id="frontend-dot">\u25cf</span></a>
    <span class="hdr-badge"><span id="server-dot" class="server-dot offline"></span><span id="server-label">offline</span></span>
    <span class="hdr-badge">model <b>${esc(summary.runtime.model)}</b></span>
  </div>
</div>

<div class="dash">

  <!-- Score Bar -->
  <div class="score-bar">
    <div class="sb-cell"><span class="sb-val" style="color:var(--cyan)">${summary.totals.runs}</span><span class="sb-label">missions</span>${timeLabel ? `<span class="sb-sub">last ${esc(timeLabel)}</span>` : ""}</div>
    <div class="sb-cell"><span class="sb-val" style="color:var(--green)">${summary.totals.approved}</span><span class="sb-label">approved</span><span class="sb-sub">${summary.totals.runs ? Math.round(summary.totals.approved / summary.totals.runs * 100) : 0}% rate</span></div>
    <div class="sb-cell"><span class="sb-val" style="color:${findingGroups.length ? "var(--amber)" : "var(--text-dim)"}">${findingGroups.length}</span><span class="sb-label">unique findings</span><span class="sb-sub">${allFindings.length} total</span></div>
    <div class="sb-cell"><span class="sb-val" style="color:${vulnFindings.length ? "var(--red)" : "var(--green)"}">${vulnFindings.length}</span><span class="sb-label">vulnerabilities</span>${summary.totals.suppressed ? `<span class="sb-sub">${summary.totals.suppressed} suppressed</span>` : ""}</div>
    <div class="sb-cell"><span class="sb-val" style="color:var(--text-dim)">${scannedModules.length}/${modules.length}</span><span class="sb-label">modules scanned</span></div>
  </div>

  ${actions.length ? `
  <!-- Mission Control -->
  <div class="mission-ctrl" id="launchpad">
    <div class="panel-title">Mission Control</div>
    ${cmdBarHtml}
    <div class="mc-cols">
      <div>
        <div class="section-label">Target</div>
        <div class="target-grid">${targetCards}</div>
      </div>
      <div>
        <div class="section-label">Quick Missions</div>
        <div class="quickops">${quickMissionsHtml}</div>
      </div>
    </div>
    ${engineStripHtml}
    <div id="lp-status" class="launch-status"></div>
    <div id="lp-log-area" class="launch-log-area" style="display:none">
      <pre id="lp-log" class="launch-log"></pre>
    </div>
  </div>` : `
  <!-- Mission Control (no actions yet) -->
  <div class="mission-ctrl" id="launchpad">
    <div class="panel-title">Mission Control</div>
    ${cmdBarHtml}
    <div class="mc-cols">
      <div>
        <div class="section-label">Target</div>
        <div class="target-grid">${targetCards}</div>
      </div>
      <div>
        <div class="section-label">Quick Missions</div>
        <div class="quickops">${quickMissionsHtml}</div>
      </div>
    </div>
    ${engineStripHtml}
    <div id="lp-status" class="launch-status"></div>
    <div id="lp-log-area" class="launch-log-area" style="display:none">
      <pre id="lp-log" class="launch-log"></pre>
    </div>
  </div>`}

  <div class="grid-main">
    <!-- Left column -->
    <div class="stack">

      <!-- Activity Timeline -->
      <div class="panel">
        <div class="panel-title">Activity${summary.recent_runs.length ? ` <span style="font-weight:400;color:var(--text-dim)">${summary.recent_runs.length} runs</span>` : ""}</div>
        ${timelineHtml ? `<div class="timeline">${timelineHtml}</div>` : `<p class="empty">No missions yet. Launch one above.</p>`}
      </div>
    </div>

    <!-- Right column: Findings -->
    <div class="stack">
      <div class="panel">
        <div class="panel-title">Findings (${findingGroups.length} unique)
          <button class="model-btn" onclick="loadFindings()" id="findings-refresh-btn" style="font-size:.62rem;padding:2px 6px">\u21bb live</button>
        </div>
        <div class="findings-scroll">
        ${findingsHtml || `<p class="empty">No open findings.</p>`}
        <div id="findings-container"></div>
        </div>
        ${vulnFindings.length > 0 ? `
        <div class="fix-all-wrap">
          <div class="fix-all-bar">
            <button class="fix-all-btn" id="fix-all-btn" onclick="fixAll()" disabled>
              <span class="fa-icon">\u26a1</span> FIX ALL
            </button>
            <span class="fix-all-info" id="fix-all-info">Triage \u2192 verify \u2192 fix (${vulnFindings.length} vulns across ${scannedModules.filter(m=>m.vulns>0).length} modules)</span>
          </div>
          <div class="fix-all-progress" id="fix-all-progress">
            <div class="fa-stats" id="fix-all-stats"></div>
            <div class="fa-pipeline" id="fix-all-pipeline"></div>
          </div>
        </div>` : ""}
      </div>
    </div>
  </div>

</div>

<div class="footer">KAAYKO API AUTOMATION \u00b7 ${esc(summary.generated_at)} \u00b7 <button class="model-btn" onclick="location.reload()" style="font-size:.62rem;padding:2px 8px">\u21bb</button></div>

<script>
if(location.protocol==='file:'){fetch('http://localhost:7799/api/health',{signal:AbortSignal.timeout(2000)}).then(r=>{if(r.ok)location.replace('http://localhost:7799/')}).catch(()=>{})}
const BASE=(location.protocol==='file:'||location.origin==='null')?'http://localhost:7799':location.origin;let serverOnline=false;let activePollToken=null;

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function postHeaders(){return {'Content-Type':'application/json','X-CSRF-Token':window.__CSRF_TOKEN||''}}
function timeAgo(iso){if(!iso)return'';const ms=Date.now()-new Date(iso).getTime();if(ms<0)return'now';const m=Math.floor(ms/60000);if(m<1)return'now';if(m<60)return m+'m';const h=Math.floor(m/60);if(h<24)return h+'h';const d=Math.floor(h/24);return d+'d'}
function refreshTimestamps(){document.querySelectorAll('.tl-time[data-ts]').forEach(el=>{const a=timeAgo(el.dataset.ts);if(a)el.textContent=a})}

function selectTarget(area,icon,name){document.getElementById('lp-area').value=area;const ci=document.getElementById('cmd-icon');if(ci)ci.textContent=icon||'';const cl=document.getElementById('cmd-area-label');if(cl)cl.textContent=name||area;document.querySelectorAll('.target-card').forEach(c=>c.classList.toggle('selected',c.dataset.area===area));document.querySelectorAll('.cmd-dropdown-item').forEach(d=>d.classList.toggle('dd-active',d.dataset.area===area))}
function toggleDropdown(e){e.stopPropagation();const dd=document.getElementById('cmd-dropdown');if(dd)dd.classList.toggle('open')}
function closeDropdown(){const dd=document.getElementById('cmd-dropdown');if(dd)dd.classList.remove('open')}
document.addEventListener('click',closeDropdown);
function setLaunchMode(mode){document.getElementById('lp-mode').value=mode;document.querySelectorAll('.cmd-mode-btn').forEach(c=>c.classList.toggle('active',c.dataset.mode===mode))}
function fillMission(area,mode,goal){const card=document.querySelector('.target-card[data-area="'+area+'"]');if(card)selectTarget(area,card.dataset.icon,card.dataset.name);setLaunchMode(mode||'audit');const gi=document.getElementById('lp-goal');if(gi){gi.value=goal||'';gi.focus()}const lp=document.getElementById('launchpad');if(lp)lp.scrollIntoView({behavior:'smooth'})}

// Engine select/confirm pattern
let selectedEngine=null;
function selectEngine(pill){const id=pill.dataset.model;if(selectedEngine===id){cancelEngineSelect();return}selectedEngine=id;document.querySelectorAll('.engine-pill').forEach(p=>p.classList.remove('ep-selected'));pill.classList.add('ep-selected');const bar=document.getElementById('engine-confirm');const lbl=document.getElementById('ec-label');const btn=document.getElementById('ec-activate');const installed=pill.dataset.installed==='true';lbl.textContent=id;if(installed){btn.textContent='Activate';btn.className='engine-confirm-btn ec-activate'}else{btn.textContent='Pull';btn.className='engine-confirm-btn ec-pull'}bar.classList.add('visible')}
function cancelEngineSelect(){selectedEngine=null;document.querySelectorAll('.engine-pill').forEach(p=>p.classList.remove('ep-selected'));document.getElementById('engine-confirm').classList.remove('visible')}
function confirmEngine(){if(!selectedEngine)return;const pill=document.querySelector('.engine-pill[data-model="'+selectedEngine+'"]');if(!pill)return;const installed=pill.dataset.installed==='true';if(installed){switchModel(selectedEngine);cancelEngineSelect()}else{pullModel(selectedEngine,pill);cancelEngineSelect()}}

async function checkServer(){const wasOnline=serverOnline;try{const c=new AbortController();const t=setTimeout(()=>c.abort(),2000);const r=await fetch(BASE+'/api/health',{signal:c.signal,mode:'cors'});clearTimeout(t);if(r.ok){const d=await r.json();serverOnline=true;const dot=document.getElementById('server-dot'),lbl=document.getElementById('server-label');if(dot&&d.busy){dot.className='server-dot online';dot.style.background='var(--amber)';dot.style.boxShadow='0 0 6px var(--amber)';lbl.textContent='busy: '+d.activeMission.area;lbl.style.color='var(--amber)'}else if(dot){dot.className='server-dot online';dot.style.background='';dot.style.boxShadow='';lbl.textContent='online';lbl.style.color=''}if(!wasOnline&&serverOnline)refreshModels()}}catch{serverOnline=false}const d=document.getElementById('server-dot'),l=document.getElementById('server-label');if(!serverOnline&&d){d.className='server-dot offline';d.style.background='';d.style.boxShadow='';l.textContent='offline';l.style.color=''}const b=document.getElementById('lp-launch');if(b)b.disabled=!serverOnline;const fab=document.getElementById('fix-all-btn');if(fab&&!fab.dataset.running)fab.disabled=!serverOnline}

async function launchMission(){if(!serverOnline)return;const a=document.getElementById('lp-area').value,g=document.getElementById('lp-goal').value.trim(),m=document.getElementById('lp-mode').value,s=document.getElementById('lp-status');if(!g){s.textContent='Write a goal first';s.style.color='var(--red)';return}const b=document.getElementById('lp-launch');b.disabled=true;s.textContent='Launching...';s.style.color='var(--amber)';try{const r=await fetch(BASE+'/api/launch',{method:'POST',headers:postHeaders(),body:JSON.stringify({area:a,goal:g,mode:m,goalMode:m==='dry-run'?'edit':m})});const d=await r.json();if(r.status===409){s.textContent=d.error||'Already running';s.style.color='var(--amber)';b.disabled=false;return}if(d.ok){s.textContent='Running (PID '+d.pid+')';s.style.color='var(--green)';activePollToken=d.logFile;document.getElementById('lp-log-area').style.display='block';pollLog()}else{s.textContent=d.error||'Failed';s.style.color='var(--red)';b.disabled=false}}catch(e){s.textContent=e.message;s.style.color='var(--red)';b.disabled=false}}

async function pollLog(){if(!activePollToken)return;try{const r=await fetch(BASE+'/api/log/'+activePollToken);if(r.ok){const t=await r.text();const el=document.getElementById('lp-log');el.textContent=t;el.scrollTop=el.scrollHeight;if(t.includes('[exit ')){document.getElementById('lp-status').textContent='Complete';document.getElementById('lp-status').style.color='var(--green)';document.getElementById('lp-launch').disabled=false;activePollToken=null;return}}}catch{}setTimeout(pollLog,1500)}

async function switchModel(id){if(!serverOnline)return;try{const r=await fetch(BASE+'/api/model',{method:'POST',headers:postHeaders(),body:JSON.stringify({model:id})});const d=await r.json();if(d.ok)await refreshModels()}catch(e){alert('Error: '+e.message)}}

async function pullModel(id,btn){if(!serverOnline)return;btn.disabled=true;const lbl=btn.querySelector('.ep-label')||btn;const origText=lbl.textContent;lbl.textContent='pulling\u2026';const st=btn.querySelector('.ep-status');if(st)st.className='ep-status pulling';try{const r=await fetch(BASE+'/api/pull',{method:'POST',headers:postHeaders(),body:JSON.stringify({model:id})});const d=await r.json();if(d.ok){lbl.textContent='started\u2026';pollPull(id,btn,lbl,origText)}else{lbl.textContent=d.error||'failed';if(st)st.className='ep-status not-installed';setTimeout(()=>{lbl.textContent=origText;btn.disabled=false},3000)}}catch{lbl.textContent='error';if(st)st.className='ep-status not-installed';setTimeout(()=>{lbl.textContent=origText;btn.disabled=false},3000)}}

async function pollPull(id,btn,lbl,origText){let tries=0;const poll=async()=>{tries++;try{const r=await fetch(BASE+'/api/models');const d=await r.json();if(d.ok){const m=d.models.find(x=>x.id===id);if(m&&m.installed){lbl.textContent=origText;const st=btn.querySelector('.ep-status');if(st)st.className='ep-status installed';btn.dataset.installed='true';btn.disabled=false;setTimeout(()=>refreshModels(),500);return}}}catch{}if(tries<60)setTimeout(poll,5000);else{lbl.textContent=origText;const st=btn.querySelector('.ep-status');if(st)st.className='ep-status not-installed';btn.disabled=false}};setTimeout(poll,3000)}

async function refreshModels(){if(!serverOnline)return;try{const r=await fetch(BASE+'/api/models');const d=await r.json();if(d.ok&&d.models){d.models.forEach(m=>{const p=document.querySelector('.engine-pill[data-model="'+m.id+'"]');if(!p)return;const s=p.querySelector('.ep-status');if(s)s.className='ep-status '+(m.installed?'installed':'not-installed');p.dataset.installed=String(!!m.installed);if(m.active){document.querySelectorAll('.engine-pill').forEach(x=>x.classList.remove('ep-active'));p.classList.add('ep-active')}})}}catch{}}

window._findingsData=[];
async function loadFindings(){if(!serverOnline)return;const container=document.getElementById('findings-container');const btn=document.getElementById('findings-refresh-btn');if(btn){btn.disabled=true;btn.textContent='\\u21bb ...'}container.innerHTML='<p class="empty">Loading...</p>';try{const r=await fetch(BASE+'/api/findings');const d=await r.json();if(!d.ok){container.innerHTML='<p class="empty">Error: '+(d.error||'?')+'</p>';return}const findings=d.findings||[];window._findingsData=findings;if(!findings.length){container.innerHTML='<p class="empty">No open findings.</p>';return}
// Deduplicate for display
const groups=[];const seen=new Map();
findings.forEach(f=>{const k=f.title;if(seen.has(k)){const g=groups[seen.get(k)];g.count++;if(!g.tracks.includes(f.track))g.tracks.push(f.track)}else{seen.set(k,groups.length);groups.push({...f,count:1,tracks:[f.track],idx:seen.get(k)})}});
container.innerHTML=groups.map((f,i)=>{const sev='sev-'+(f.severity||'info');const countBadge=f.count>1?'<span class="finding-count">'+f.count+'\\u00d7</span>':'';const trackBadges=f.tracks.map(t=>'<code>'+esc(t)+'</code>').join(' ');return '<div class="finding-card'+(f.severity==='critical'||f.severity==='high'?' finding-vuln':'')+'" id="finding-'+i+'"><div class="finding-header"><span class="sev '+esc(sev)+'">'+esc(f.severity||'info')+'</span><span class="finding-title">'+esc(f.title)+'</span>'+countBadge+'<span id="finding-status-'+i+'" class="finding-status"></span></div><div class="finding-detail">'+esc((f.detail||'').slice(0,200))+'</div><div class="finding-meta">'+trackBadges+' <button class="implement-btn" onclick="implementFinding('+i+',this)">\\u26a1 Fix</button> <button class="suppress-btn" onclick="suppressFinding('+i+',this)">\\u2715</button></div></div>'}).join('')}catch(e){container.innerHTML='<p class="empty">'+esc(e.message)+'</p>'}finally{if(btn){btn.disabled=false;btn.textContent='\\u21bb live'}}}

async function implementFinding(idx,btn){if(!serverOnline)return;const findings=window._findingsData;if(!findings[idx])return;const f=findings[idx];btn.disabled=true;btn.textContent='\\u26a1 ...';const status=document.getElementById('finding-status-'+idx);if(status){status.textContent='launching...';status.className='finding-status implementing'}try{const r=await fetch(BASE+'/api/implement',{method:'POST',headers:postHeaders(),body:JSON.stringify({track:f.track,title:f.title,detail:f.detail,severity:f.severity,line_refs:f.line_refs||[],file_paths:f.file_paths||[]})});const d=await r.json();if(d.ok){if(status){status.textContent='\\u26a1 running (PID '+d.pid+')';status.className='finding-status implementing'}btn.textContent='\\u26a1';pollImplement(idx,btn,d.pid)}else{if(d.error&&d.error.includes('already running')){if(status){status.textContent=d.error;status.className='finding-status implementing'}btn.textContent='\\u231b';btn.disabled=false}else{if(status){status.textContent=d.error||'failed';status.className='finding-status error'}btn.textContent='retry';btn.disabled=false}}}catch(e){if(status){status.textContent=e.message;status.className='finding-status error'}btn.textContent='retry';btn.disabled=false}}
async function pollImplement(idx,btn,pid){const status=document.getElementById('finding-status-'+idx);try{const r=await fetch(BASE+'/api/health');if(!r.ok)throw new Error('offline');const d=await r.json();if(d.busy){const elapsed=d.activeMission.elapsed||'';if(status){status.textContent='\\u26a1 running'+(elapsed?' ('+elapsed+'s)':'')+' PID '+pid;status.className='finding-status implementing'}setTimeout(()=>pollImplement(idx,btn,pid),4000);return}if(status){status.textContent='\\u2713 complete';status.className='finding-status done'}btn.textContent='\\u2713';btn.disabled=true}catch(e){setTimeout(()=>pollImplement(idx,btn,pid),5000)}}

async function suppressFinding(idx,btn){const f=window._findingsData[idx];if(!f)return;if(!confirm('Suppress "'+f.title+'"?\\n\\nThis will add it to suppressions.json so it is hidden on future sweeps.'))return;btn.disabled=true;btn.textContent='\\u23f3';try{const r=await fetch(BASE+'/api/suppress',{method:'POST',headers:postHeaders(),body:JSON.stringify({fingerprint:f.fingerprint,title:f.title,severity:f.severity,track:f.track,reason:'Suppressed via dashboard'})});const d=await r.json();if(d.ok){btn.textContent='\\u2713';const card=document.getElementById('finding-'+idx);if(card){card.style.opacity='0.3';card.title='Suppressed and saved to suppressions.json'}}else{btn.textContent='\\u26a0';btn.disabled=false;console.error('suppress failed:',d.error)}}catch(e){btn.textContent='\\u26a0';btn.disabled=false;console.error('suppress error:',e.message)}}

// ── Fix All ──
async function fixAll(){if(!serverOnline)return;const btn=document.getElementById('fix-all-btn');const info=document.getElementById('fix-all-info');const progress=document.getElementById('fix-all-progress');const pipeline=document.getElementById('fix-all-pipeline');const statsEl=document.getElementById('fix-all-stats');if(!btn)return;
if(!confirm('Run Fix All pipeline?\\n\\nThis will:\\n1. Triage all findings (filter false positives & hallucinations)\\n2. Verify against actual code\\n3. Fix verified issues by severity\\n\\nContinue?'))return;
btn.disabled=true;info.textContent='Starting pipeline...';info.style.color='var(--amber)';
try{const r=await fetch(BASE+'/api/fix-all',{method:'POST',headers:postHeaders()});const d=await r.json();if(r.status===409){info.textContent=d.error||'Already running';info.style.color='var(--amber)';btn.disabled=false;return}
if(!d.ok){info.textContent=d.message||d.error||'Nothing to fix';info.style.color='var(--text-dim)';btn.disabled=false;return}
// Show pipeline stats
const p=d.pipeline;statsEl.innerHTML='<span class="fa-stat"><span class="fa-stat-val dim">'+p.total_raw+'</span> raw</span><span class="fa-stat"><span class="fa-stat-val dim">'+p.unique+'</span> unique</span><span class="fa-stat"><span class="fa-stat-val good">'+p.verified+'</span> verified</span><span class="fa-stat"><span class="fa-stat-val bad">'+p.hallucinations+'</span> hallucinated</span><span class="fa-stat"><span class="fa-stat-val warn">'+p.suppressed+'</span> suppressed</span><span class="fa-stat"><span class="fa-stat-val good">'+p.fixable+'</span> fixable</span>';
// Show step cards
pipeline.innerHTML=d.plan.map((s,i)=>'<div class="fa-step" id="fa-step-'+i+'"><span class="fa-step-dot pending" id="fa-dot-'+i+'"></span><span class="fa-step-track">'+esc(s.track)+'</span><span class="fa-step-info">'+s.findingCount+' finding'+(s.findingCount>1?'s':'')+' ('+esc(s.severity)+')</span><span class="fa-step-result" id="fa-result-'+i+'"></span></div>').join('');
progress.classList.add('active');
info.textContent='Running... PID '+d.pid;info.style.color='var(--green)';
// Poll progress
pollFixAll(d.fixAllId,d.plan.length)}catch(e){info.textContent=e.message;info.style.color='var(--red)';btn.disabled=false}}

async function pollFixAll(id,total){try{const r=await fetch(BASE+'/api/fix-all/status');const d=await r.json();if(!d.ok)return;const prog=d.progress||{};const results=prog.results||[];
// Update dots
for(let i=0;i<total;i++){const dot=document.getElementById('fa-dot-'+i);const res=document.getElementById('fa-result-'+i);if(!dot)continue;if(i<results.length){dot.className='fa-step-dot '+(results[i].success?'done':'failed');if(res)res.textContent=results[i].success?'\\u2713':'\\u2717';if(res)res.style.color=results[i].success?'var(--green)':'var(--red)'}else if(prog.current&&i===results.length){dot.className='fa-step-dot running'}else{dot.className='fa-step-dot pending'}}
const info=document.getElementById('fix-all-info');if(d.status==='complete'){const ok=results.filter(r=>r.success).length;const fail=results.filter(r=>!r.success).length;if(info){info.textContent='Complete: '+ok+' succeeded, '+fail+' failed';info.style.color=fail?'var(--amber)':'var(--green)'}document.getElementById('fix-all-btn').disabled=false;return}
if(info){info.textContent='Fixing '+(prog.current||'...')+' ('+(prog.completed||0)+'/'+total+')';info.style.color='var(--amber)'}}catch{}
setTimeout(()=>pollFixAll(id,total),3000)}

function toggleDetail(id){const r=document.getElementById(id);if(!r)return;r.style.display=r.style.display==='none'?'block':'none'}

// Wire events
document.querySelectorAll('.target-card').forEach(c=>c.addEventListener('click',()=>selectTarget(c.dataset.area,c.dataset.icon,c.dataset.name)));
document.querySelectorAll('.cmd-mode-btn').forEach(b=>b.addEventListener('click',()=>setLaunchMode(b.dataset.mode)));
document.querySelectorAll('.qo-card').forEach(c=>c.addEventListener('click',()=>fillMission(c.dataset.area,c.dataset.mode,c.dataset.goal)));
document.querySelectorAll('.engine-pill').forEach(p=>p.addEventListener('click',()=>selectEngine(p)));
document.querySelectorAll('.cmd-dropdown-item').forEach(d=>d.addEventListener('click',(e)=>{e.stopPropagation();selectTarget(d.dataset.area,d.dataset.icon,d.dataset.name);closeDropdown()}));

selectTarget('${esc(selectedModule.area)}','${selectedModule.icon}','${esc(selectedModule.name)}');setLaunchMode('${esc(defaultLaunchMode)}');
refreshTimestamps();setInterval(refreshTimestamps,60000);
checkServer();setInterval(checkServer,12000);
async function checkSibling(){try{const r=await fetch('http://localhost:4400/api/health',{signal:AbortSignal.timeout(2000),mode:'cors'});const d=document.getElementById('frontend-dot');if(d)d.className='nav-dot '+(r.ok?'online':'offline')}catch{const d=document.getElementById('frontend-dot');if(d)d.className='nav-dot offline'}}
checkSibling();setInterval(checkSibling,15000);
setTimeout(async()=>{if(serverOnline){refreshModels();loadFindings()}},2000);
</script>
</body>
</html>`;
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = { generateDashboard, buildDashboardMarkdown, buildDashboardHtml, buildModelRoster };
