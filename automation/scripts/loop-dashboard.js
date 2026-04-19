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

  // ── Deduplicate findings by title ──
  const allFindings = summary.open_findings || [];
  const vulnFindings = summary.vulnerability_findings || [];
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
    return `<div class="finding-card${isVuln ? " finding-vuln" : ""}" id="fg-${i}">
      <div class="finding-header">
        <span class="sev ${esc(sevClass)}">${esc(f.severity || "info")}</span>
        <span class="finding-title">${esc(f.title)}</span>
        ${countBadge}
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
    return `<button class="mod-chip${selected ? " selected" : ""}" type="button" data-area="${esc(m.area)}" aria-pressed="${selected ? "true" : "false"}">${m.icon} ${esc(m.name)}</button>`;
  }).join("");

  const modeButtons = launchModes.map((mode) => {
    const selected = mode.id === defaultLaunchMode;
    return `<button class="mode-chip${selected ? " selected" : ""}" type="button" data-mode="${esc(mode.id)}" aria-pressed="${selected ? "true" : "false"}">${esc(mode.label)}</button>`;
  }).join("");

  const presetButtons = missionPresets.map((preset) => {
    return `<button class="preset-btn" type="button" data-goal="${esc(preset.goal)}" data-mode="${esc(preset.mode)}">${esc(preset.label)}</button>`;
  }).join("");

  // ── Action items HTML ──
  const actionsHtml = actions.slice(0, 4).map((a) => {
    return `<div class="action-item" data-area="${esc(a.area || "")}" data-action="${esc(a.action || "")}">
      <span class="action-icon">${a.icon}</span>
      <span class="action-text">${a.text}</span>
      <button class="action-go" onclick="quickLaunch('${esc(a.area || "")}','${esc(a.action || "audit")}')">Go \u2192</button>
    </div>`;
  }).join("");

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
  .header{border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
  .header h1{font-family:var(--mono);font-size:1rem;font-weight:700;color:var(--cyan);letter-spacing:.06em}
  .header h1 span{color:var(--text-dim);font-weight:400;font-size:.85rem}
  .header-right{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .hdr-badge{font-family:var(--mono);font-size:.68rem;background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:4px 8px;color:var(--text-dim)}
  .hdr-badge b{color:var(--green)}
  .dash{max-width:1200px;margin:0 auto;padding:18px 20px 40px}
  .grid-main{display:grid;grid-template-columns:1fr 340px;gap:16px}
  @media(max-width:960px){.grid-main{grid-template-columns:1fr}}
  .stack{display:grid;gap:14px}
  .panel{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;overflow:hidden}
  .panel-title{font-family:var(--mono);font-size:.72rem;font-weight:600;color:var(--cyan);letter-spacing:.06em;text-transform:uppercase;margin-bottom:12px;padding-bottom:7px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
  details.panel{padding:0}
  details.panel>summary{cursor:pointer;list-style:none;padding:16px;user-select:none}
  details.panel>summary::-webkit-details-marker{display:none}
  details.panel>summary .panel-title{margin-bottom:0;padding-bottom:0;border-bottom:none}
  details.panel>summary::after{content:"\\25bc";float:right;color:var(--text-dim);font-size:.6rem;transition:transform .2s}
  details.panel:not([open])>summary::after{transform:rotate(-90deg)}
  details.panel[open]>*:not(summary){padding:0 16px 16px}
  details.panel[open]>summary{border-bottom:1px solid var(--border);margin-bottom:10px}

  /* ── Score Bar (top) ── */
  .score-bar{display:flex;align-items:stretch;gap:1px;background:var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px}
  .sb-cell{background:var(--surface);padding:14px 0;flex:1;text-align:center;min-width:0}
  .sb-cell:first-child{border-radius:10px 0 0 10px}.sb-cell:last-child{border-radius:0 10px 10px 0}
  .sb-val{font-family:var(--mono);font-size:1.5rem;font-weight:700;display:block;line-height:1.1}
  .sb-label{font-size:.62rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em;margin-top:3px;display:block}
  .sb-sub{font-family:var(--mono);font-size:.6rem;color:var(--text-dim);margin-top:2px;display:block}

  /* ── Actions ── */
  .action-list{display:grid;gap:6px}
  .action-item{display:flex;align-items:center;gap:10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;cursor:pointer;transition:border-color .2s}
  .action-item:hover{border-color:var(--border-hi)}
  .action-icon{font-size:1.1rem;flex-shrink:0}
  .action-text{flex:1;font-size:.8rem;line-height:1.4;color:var(--text)}
  .action-text b{color:var(--text-bright)}
  .action-go{appearance:none;background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.2);color:var(--cyan);border-radius:5px;padding:4px 10px;font-family:var(--mono);font-size:.68rem;cursor:pointer;font-weight:600;flex-shrink:0;transition:all .15s}
  .action-go:hover{background:rgba(34,211,238,0.2)}

  /* ── Module Health ── */
  .health-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
  .hc{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer;transition:border-color .15s}
  .hc:hover{border-color:var(--border-hi)}
  .hc-top{display:flex;align-items:center;gap:6px;margin-bottom:6px}
  .hc-icon{font-size:.9rem}
  .hc-name{font-family:var(--mono);font-size:.72rem;font-weight:600;color:var(--text-bright);flex:1}
  .hc-status{font-family:var(--mono);font-size:.64rem;font-weight:600}
  .hc-bar{height:4px;background:var(--bg);border-radius:2px;overflow:hidden;margin-bottom:4px}
  .hc-bar-fill{height:100%;border-radius:2px;transition:width .3s}
  .hc-meta{font-family:var(--mono);font-size:.58rem;color:var(--text-dim)}

  /* ── Timeline ── */
  .timeline{display:grid;gap:0}
  .tl-entry{display:flex;gap:12px;padding:8px 6px;cursor:pointer;transition:background .12s;border-radius:6px}
  .tl-entry:hover{background:rgba(34,211,238,0.03)}
  .tl-gutter{width:16px;display:flex;flex-direction:column;align-items:center;padding-top:6px;position:relative}
  .tl-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;z-index:1}
  .tl-line-v{flex:1;width:1px;background:var(--border);margin-top:4px}
  .tl-entry:last-child .tl-line-v{display:none}
  .s-dot-approved,.s-dot-reviewed{background:var(--green)}.s-dot-pending-review,.s-dot-agent-applied{background:var(--blue)}
  .s-dot-rejected,.s-dot-rolled-back,.s-dot-agent-failed,.s-dot-capture-failed{background:var(--red)}
  .s-dot-changes-requested{background:var(--amber)}
  .tl-body{flex:1;min-width:0}
  .tl-row-1{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .tl-time{font-family:var(--mono);font-size:.66rem;color:var(--text-dim);min-width:56px}
  .tl-track{font-family:var(--mono);font-size:.74rem;font-weight:700;color:var(--text-bright)}
  .tl-mode{font-family:var(--mono);font-size:.58rem;padding:1px 6px;border-radius:3px;font-weight:600}
  .tl-audit{background:rgba(96,165,250,0.15);color:var(--blue)}
  .tl-edit{background:rgba(52,211,153,0.12);color:var(--green)}
  .tl-dry{background:rgba(167,139,250,0.12);color:var(--purple)}
  .tl-batch{font-family:var(--mono);font-size:.6rem;color:var(--text-dim);background:var(--surface2);border-radius:3px;padding:1px 5px}
  .tl-summary{font-size:.76rem;color:var(--text-dim);margin-top:3px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .tl-metrics{font-family:var(--mono);font-size:.64rem;color:var(--text-dim);margin-top:3px}
  .tl-expand{margin-top:8px}
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
  .finding-card{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:6px;transition:border-color .15s}
  .finding-card:hover{border-color:var(--border-hi)}
  .finding-card.finding-vuln{border-left:3px solid var(--red)}
  .finding-header{display:flex;align-items:center;gap:6px;margin-bottom:4px}
  .finding-title{font-weight:600;font-size:.78rem;color:var(--text-bright);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .finding-count{font-family:var(--mono);font-size:.64rem;color:var(--amber);background:rgba(245,158,11,0.15);border-radius:3px;padding:1px 5px;font-weight:700;flex-shrink:0}
  .finding-detail{font-size:.74rem;color:var(--text-dim);line-height:1.4;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .finding-refs{margin-bottom:4px;display:flex;flex-wrap:wrap;gap:3px}
  .finding-refs code{font-size:.62rem;background:rgba(99,102,241,0.12);color:#818cf8;padding:1px 5px;border-radius:3px}
  .finding-meta{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
  .finding-meta code{font-size:.64rem}

  /* ── Launch pad ── */
  .launch-bar{background:var(--surface);border:1px solid rgba(34,211,238,0.12);border-radius:10px;padding:14px;margin-bottom:14px}
  .launch-bar .panel-title::before{content:"\\25b6 "}
  .mod-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
  .mod-chip{appearance:none;font-family:var(--mono);font-size:.66rem;background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:4px 8px;cursor:pointer;color:var(--text);transition:all .15s}
  .mod-chip:hover{border-color:var(--cyan);color:var(--text-bright)}
  .mod-chip.selected{border-color:var(--cyan);background:rgba(34,211,238,0.1);color:var(--cyan);font-weight:600}
  .launch-input-row{display:flex;gap:6px;margin-bottom:8px}
  .launch-input-row input{flex:1;background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:8px 10px;color:var(--text-bright);font-family:var(--mono);font-size:.76rem;outline:none}
  .launch-input-row input:focus{border-color:var(--cyan)}
  #lp-launch{background:var(--cyan);color:var(--bg);border:none;border-radius:5px;padding:8px 16px;font-family:var(--mono);font-size:.74rem;font-weight:700;cursor:pointer;transition:opacity .15s;flex-shrink:0}
  #lp-launch:hover{opacity:.85}#lp-launch:disabled{opacity:.35;cursor:not-allowed}
  .mode-chips{display:flex;gap:4px;margin-bottom:8px}
  .mode-chip{appearance:none;font-family:var(--mono);font-size:.66rem;background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:4px 10px;cursor:pointer;color:var(--text);transition:all .15s}
  .mode-chip:hover{border-color:var(--cyan)}
  .mode-chip.selected{border-color:var(--cyan);background:rgba(34,211,238,0.08);color:var(--cyan)}
  .preset-row{display:flex;flex-wrap:wrap;gap:4px}
  .preset-btn{appearance:none;background:rgba(107,127,148,0.06);border:1px solid rgba(107,127,148,0.12);border-radius:99px;padding:4px 9px;font-family:var(--mono);font-size:.64rem;color:var(--text-dim);cursor:pointer;transition:all .15s}
  .preset-btn:hover{border-color:rgba(34,211,238,0.25);color:var(--text-bright)}
  .launch-status{font-family:var(--mono);font-size:.68rem;color:var(--text-dim);margin-top:6px}
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
  .footer{text-align:center;padding:20px;color:var(--text-dim);font-family:var(--mono);font-size:.62rem;border-top:1px solid var(--border);margin-top:20px}
  @media(max-width:960px){.score-bar{flex-wrap:wrap}.sb-cell{min-width:25%}}
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
  <!-- Recommended Actions -->
  <div class="panel" style="margin-bottom:14px">
    <div class="panel-title">Recommended Actions</div>
    <div class="action-list">${actionsHtml}</div>
  </div>` : ""}

  <div class="grid-main">
    <!-- Left column -->
    <div class="stack">

      <!-- Module Health -->
      <div class="panel">
        <div class="panel-title">Module Health</div>
        <div class="health-grid">${healthCards}</div>
      </div>

      <!-- Activity Timeline -->
      <div class="panel">
        <div class="panel-title">Activity${summary.recent_runs.length ? ` <span style="font-weight:400;color:var(--text-dim)">${summary.recent_runs.length} runs</span>` : ""}</div>
        ${timelineHtml ? `<div class="timeline">${timelineHtml}</div>` : `<p class="empty">No missions yet. Launch one below.</p>`}
      </div>

      <!-- Launch Pad -->
      <div class="launch-bar" id="launchpad">
        <div class="panel-title">Launch Mission</div>
        <div class="mod-chips">${moduleOptions}</div>
        <input id="lp-area" type="hidden" value="${esc(selectedModule.area)}">
        <div class="launch-input-row">
          <input id="lp-goal" type="text" placeholder="What should the agent do?"/>
          <button id="lp-launch" onclick="launchMission()" disabled>LAUNCH</button>
        </div>
        <div class="mode-chips">${modeButtons}</div>
        <input id="lp-mode" type="hidden" value="${defaultLaunchMode}">
        <div class="preset-row">${presetButtons}</div>
        <div id="lp-status" class="launch-status"></div>
        <div id="lp-log-area" class="launch-log-area" style="display:none">
          <pre id="lp-log" class="launch-log"></pre>
        </div>
      </div>
    </div>

    <!-- Right column: Findings -->
    <div class="stack">
      <div class="panel">
        <div class="panel-title">Findings (${findingGroups.length} unique)
          <button class="model-btn" onclick="loadFindings()" id="findings-refresh-btn" style="font-size:.62rem;padding:2px 6px">\u21bb live</button>
        </div>
        ${findingsHtml || `<p class="empty">No open findings.</p>`}
        <div id="findings-container"></div>
      </div>

      <!-- Models (collapsed) -->
      <details class="panel"><summary><span class="panel-title">Models <button class="model-btn" onclick="event.stopPropagation();refreshModels()" style="font-size:.62rem;padding:2px 6px;margin-left:8px" id="model-refresh-btn">\u21bb</button></span></summary>
        <div id="model-roster-container"><table id="model-table"><thead><tr><th></th><th>Model</th><th>Best For</th><th>Size</th><th>Status</th><th></th></tr></thead><tbody>${modelRows}</tbody></table></div>
      </details>
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

function syncSelectedModule(area){document.getElementById('lp-area').value=area;document.querySelectorAll('.mod-chip').forEach(c=>{c.classList.toggle('selected',c.dataset.area===area);c.setAttribute('aria-pressed',c.dataset.area===area?'true':'false')})}
function setLaunchMode(mode){document.getElementById('lp-mode').value=mode;document.querySelectorAll('.mode-chip').forEach(c=>{c.classList.toggle('selected',c.dataset.mode===mode);c.setAttribute('aria-pressed',c.dataset.mode===mode?'true':'false')})}
function quickLaunch(area,action){syncSelectedModule(area);const lp=document.getElementById('launchpad');if(lp)lp.scrollIntoView({behavior:'smooth'});const gi=document.getElementById('lp-goal');if(gi)gi.focus();if(action==='edit')setLaunchMode('edit');else setLaunchMode('audit')}

async function checkServer(){try{const c=new AbortController();const t=setTimeout(()=>c.abort(),2000);const r=await fetch(BASE+'/api/health',{signal:c.signal,mode:'cors'});clearTimeout(t);if(r.ok){const d=await r.json();serverOnline=true;const dot=document.getElementById('server-dot'),lbl=document.getElementById('server-label');if(dot&&d.busy){dot.className='server-dot online';dot.style.background='var(--amber)';dot.style.boxShadow='0 0 6px var(--amber)';lbl.textContent='busy: '+d.activeMission.area;lbl.style.color='var(--amber)'}else if(dot){dot.className='server-dot online';dot.style.background='';dot.style.boxShadow='';lbl.textContent='online';lbl.style.color=''}}}catch{serverOnline=false}const d=document.getElementById('server-dot'),l=document.getElementById('server-label');if(!serverOnline&&d){d.className='server-dot offline';d.style.background='';d.style.boxShadow='';l.textContent='offline';l.style.color=''}const b=document.getElementById('lp-launch');if(b)b.disabled=!serverOnline}

async function launchMission(){if(!serverOnline)return;const a=document.getElementById('lp-area').value,g=document.getElementById('lp-goal').value.trim(),m=document.getElementById('lp-mode').value,s=document.getElementById('lp-status');if(!g){s.textContent='Write a goal first';s.style.color='var(--red)';return}const b=document.getElementById('lp-launch');b.disabled=true;s.textContent='Launching...';s.style.color='var(--amber)';try{const r=await fetch(BASE+'/api/launch',{method:'POST',headers:postHeaders(),body:JSON.stringify({area:a,goal:g,mode:m,goalMode:m==='dry-run'?'edit':m})});const d=await r.json();if(r.status===409){s.textContent=d.error||'Already running';s.style.color='var(--amber)';b.disabled=false;return}if(d.ok){s.textContent='Running (PID '+d.pid+')';s.style.color='var(--green)';activePollToken=d.logFile;document.getElementById('lp-log-area').style.display='block';pollLog()}else{s.textContent=d.error||'Failed';s.style.color='var(--red)';b.disabled=false}}catch(e){s.textContent=e.message;s.style.color='var(--red)';b.disabled=false}}

async function pollLog(){if(!activePollToken)return;try{const r=await fetch(BASE+'/api/log/'+activePollToken);if(r.ok){const t=await r.text();const el=document.getElementById('lp-log');el.textContent=t;el.scrollTop=el.scrollHeight;if(t.includes('[exit ')){document.getElementById('lp-status').textContent='Complete';document.getElementById('lp-status').style.color='var(--green)';document.getElementById('lp-launch').disabled=false;activePollToken=null;return}}}catch{}setTimeout(pollLog,1500)}

async function switchModel(id){if(!serverOnline)return;try{const r=await fetch(BASE+'/api/model',{method:'POST',headers:postHeaders(),body:JSON.stringify({model:id})});const d=await r.json();if(d.ok)await refreshModels()}catch(e){alert('Error: '+e.message)}}

async function pullModel(id,btn){if(!serverOnline)return;btn.disabled=true;btn.textContent='pulling...';try{const r=await fetch(BASE+'/api/pull',{method:'POST',headers:postHeaders(),body:JSON.stringify({model:id})});const d=await r.json();if(d.ok){btn.textContent='started...';pollPull(id,btn)}else{btn.textContent=d.error||'failed';setTimeout(()=>{btn.textContent='pull';btn.disabled=false},3000)}}catch{btn.textContent='error';setTimeout(()=>{btn.textContent='pull';btn.disabled=false},3000)}}

async function pollPull(id,btn){let tries=0;const poll=async()=>{tries++;try{const r=await fetch(BASE+'/api/models');const d=await r.json();if(d.ok){const m=d.models.find(x=>x.id===id);if(m&&m.installed){btn.textContent='\\u2713';setTimeout(()=>refreshModels(),500);return}}}catch{}if(tries<60)setTimeout(poll,5000);else{btn.textContent='timeout';setTimeout(()=>{btn.textContent='pull';btn.disabled=false},3000)}};setTimeout(poll,3000)}

async function refreshModels(){if(!serverOnline)return;const btn=document.getElementById('model-refresh-btn');if(btn){btn.disabled=true;btn.textContent='\\u21bb'}try{const r=await fetch(BASE+'/api/models');const d=await r.json();if(d.ok&&d.html){const tbl=document.getElementById('model-table');if(tbl){const tbody=tbl.querySelector('tbody');if(tbody)tbody.innerHTML=d.html}}}catch{}finally{if(btn){btn.disabled=false;btn.textContent='\\u21bb'}}}

window._findingsData=[];
async function loadFindings(){if(!serverOnline)return;const container=document.getElementById('findings-container');const btn=document.getElementById('findings-refresh-btn');if(btn){btn.disabled=true;btn.textContent='\\u21bb ...'}container.innerHTML='<p class="empty">Loading...</p>';try{const r=await fetch(BASE+'/api/findings');const d=await r.json();if(!d.ok){container.innerHTML='<p class="empty">Error: '+(d.error||'?')+'</p>';return}const findings=d.findings||[];window._findingsData=findings;if(!findings.length){container.innerHTML='<p class="empty">No open findings.</p>';return}
// Deduplicate for display
const groups=[];const seen=new Map();
findings.forEach(f=>{const k=f.title;if(seen.has(k)){const g=groups[seen.get(k)];g.count++;if(!g.tracks.includes(f.track))g.tracks.push(f.track)}else{seen.set(k,groups.length);groups.push({...f,count:1,tracks:[f.track],idx:seen.get(k)})}});
container.innerHTML=groups.map((f,i)=>{const sev='sev-'+(f.severity||'info');const countBadge=f.count>1?'<span class="finding-count">'+f.count+'\\u00d7</span>':'';const trackBadges=f.tracks.map(t=>'<code>'+esc(t)+'</code>').join(' ');return '<div class="finding-card'+(f.severity==='critical'||f.severity==='high'?' finding-vuln':'')+'" id="finding-'+i+'"><div class="finding-header"><span class="sev '+esc(sev)+'">'+esc(f.severity||'info')+'</span><span class="finding-title">'+esc(f.title)+'</span>'+countBadge+'<span id="finding-status-'+i+'" class="finding-status"></span></div><div class="finding-detail">'+esc((f.detail||'').slice(0,200))+'</div><div class="finding-meta">'+trackBadges+' <button class="implement-btn" onclick="implementFinding('+i+',this)">\\u26a1 Fix</button> <button class="suppress-btn" onclick="suppressFinding('+i+',this)">\\u2715</button></div></div>'}).join('')}catch(e){container.innerHTML='<p class="empty">'+esc(e.message)+'</p>'}finally{if(btn){btn.disabled=false;btn.textContent='\\u21bb live'}}}

async function implementFinding(idx,btn){if(!serverOnline)return;const findings=window._findingsData;if(!findings[idx])return;const f=findings[idx];btn.disabled=true;btn.textContent='\\u26a1 ...';const status=document.getElementById('finding-status-'+idx);if(status){status.textContent='running...';status.className='finding-status implementing'}try{const r=await fetch(BASE+'/api/implement',{method:'POST',headers:postHeaders(),body:JSON.stringify({track:f.track,title:f.title,detail:f.detail,severity:f.severity,line_refs:f.line_refs||[],file_paths:f.file_paths||[]})});const d=await r.json();if(d.ok){if(status){status.textContent='\\u2713 PID '+d.pid;status.className='finding-status done'}btn.textContent='\\u2713'}else{if(status){status.textContent=d.error||'failed';status.className='finding-status error'}btn.textContent='retry';btn.disabled=false}}catch(e){if(status){status.textContent=e.message;status.className='finding-status error'}btn.textContent='retry';btn.disabled=false}}

function suppressFinding(idx,btn){const f=window._findingsData[idx];if(!f)return;if(!confirm('Suppress "'+f.title+'"?'))return;btn.disabled=true;btn.textContent='\\u2713';const card=document.getElementById('finding-'+idx);if(card){card.style.opacity='0.3'}}

function toggleDetail(id){const r=document.getElementById(id);if(!r)return;r.style.display=r.style.display==='none'?'block':'none'}

// Wire events
document.querySelectorAll('.mod-chip').forEach(c=>c.addEventListener('click',()=>syncSelectedModule(c.dataset.area)));
document.querySelectorAll('.mode-chip').forEach(c=>c.addEventListener('click',()=>setLaunchMode(c.dataset.mode)));
document.querySelectorAll('.preset-btn').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.mode)setLaunchMode(b.dataset.mode);const gi=document.getElementById('lp-goal');if(gi){gi.value=b.dataset.goal||'';gi.focus()}}));
document.querySelectorAll('.hc').forEach(c=>c.addEventListener('click',()=>{syncSelectedModule(c.dataset.area);document.getElementById('launchpad').scrollIntoView({behavior:'smooth'})}));

syncSelectedModule('${esc(selectedModule.area)}');setLaunchMode('${esc(defaultLaunchMode)}');
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
