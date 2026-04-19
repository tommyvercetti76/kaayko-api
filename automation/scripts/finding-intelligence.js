"use strict";

/**
 * finding-intelligence.js — Deduplicate, verify, and prioritize agent findings.
 *
 * Problems this solves:
 * 1. Same finding rediscovered across 5 runs → shows 5 times in dashboard
 * 2. Model hallucinations (references non-existent functions) → shown as real
 * 3. No priority ranking → critical and info findings shown equally
 * 4. Findings without safe_edits → not actionable, just noise
 *
 * How it works:
 * - Content-hash each finding (normalized title+detail) for deduplication
 * - Cross-reference against actual code to verify (file exists? identifier exists?)
 * - Score = (severity_weight × confidence) + 0.5 × log2(recurrence + 1)
 * - Flag "needs detail" findings that lack actionable content
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

// ── Suppressions ────────────────────────────────────────────────

const SUPPRESSIONS_PATH = path.join(__dirname, "..", "config", "suppressions.json");

const SUPPRESSION_TTL_DAYS = 90;

/**
 * Load suppressions database (fingerprints + title patterns).
 * Entries with `created_at` older than SUPPRESSION_TTL_DAYS are expired and re-surfaced.
 * Returns { fingerprints: Map<string, object>, patterns: Array<{regex, scope, reason}> }
 */
function loadSuppressions() {
  try {
    const raw = JSON.parse(fs.readFileSync(SUPPRESSIONS_PATH, "utf8"));
    const now = Date.now();
    const ttlMs = SUPPRESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
    let expiredCount = 0;

    const fpMap = new Map();
    for (const entry of raw.fingerprints || []) {
      if (entry.created_at) {
        const age = now - new Date(entry.created_at).getTime();
        if (age > ttlMs) {
          expiredCount++;
          continue; // expired — let finding resurface for re-evaluation
        }
      }
      fpMap.set(entry.fingerprint, entry);
    }

    if (expiredCount > 0) {
      process.stderr.write(`[finding-intelligence] Re-surfacing ${expiredCount} expired suppression(s) (>${SUPPRESSION_TTL_DAYS}d old) for re-evaluation.\n`);
    }

    const patterns = (raw.title_patterns || []).map((p) => ({
      regex: new RegExp(p.pattern, "i"),
      scope: p.scope || null,
      reason: p.reason
    }));
    return { fingerprints: fpMap, patterns };
  } catch {
    return { fingerprints: new Map(), patterns: [] };
  }
}

/**
 * Check if a finding is suppressed.
 * @returns {{ suppressed: boolean, reason?: string }}
 */
function isSuppressed(finding, fingerprint, suppressions) {
  // Check exact fingerprint match
  if (suppressions.fingerprints.has(fingerprint)) {
    return { suppressed: true, reason: suppressions.fingerprints.get(fingerprint).reason };
  }
  // Check title pattern match
  const title = finding.title || "";
  const track = (finding.track || "").toLowerCase();
  for (const p of suppressions.patterns) {
    if (p.regex.test(title)) {
      if (!p.scope || p.scope.toLowerCase() === track) {
        return { suppressed: true, reason: p.reason };
      }
    }
  }
  return { suppressed: false };
}

// ── Constants ───────────────────────────────────────────────────

const SEVERITY_WEIGHTS = {
  critical: 10,
  high: 7,
  medium: 4,
  low: 2,
  info: 1
};

const VERIFICATION_CONFIDENCE = {
  verified: 1.0,      // references real code
  plausible: 0.7,     // can't verify but looks reasonable
  unverified: 0.4,    // no evidence found
  hallucination: 0.0  // references things that don't exist
};

// ── Core: Fingerprint a Finding ─────────────────────────────────

/**
 * Generate a content fingerprint for a finding.
 * Normalized: lowercase, strip whitespace, ignore run-specific details.
 */
function fingerprintFinding(finding) {
  const normalized = [
    (finding.title || "").toLowerCase().trim(),
    (finding.severity || "medium").toLowerCase(),
    // Don't include detail in fingerprint — too noisy.
    // Two findings with same title+severity about the same track = same finding.
    (finding.track || "").toLowerCase()
  ].join("|");

  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

// ── Core: Verify a Finding Against Code ─────────────────────────

/**
 * Check if a finding references real code artifacts.
 * Two-pass: (1) file existence, (2) identifier grep inside matched files.
 *
 * @param {object} finding - the finding object
 * @param {string} repoRoot - absolute path to repo
 * @returns {{confidence: string, evidence: string[]}}
 */
function verifyFinding(finding, repoRoot) {
  const evidence = [];
  const detail = (finding.detail || "") + " " + (finding.title || "");

  // Pass 1: file existence
  const fileRefs = detail.match(/(?:functions|api|src|middleware|services)\/[\w/./-]+\.(?:js|ts|json)/gi) || [];

  let fileHits = 0;
  let fileMisses = 0;
  const resolvedPaths = [];

  for (const ref of fileRefs) {
    const candidates = [
      path.join(repoRoot, ref),
      path.join(repoRoot, "functions", ref),
      path.join(repoRoot, "src", ref)
    ];
    const resolved = candidates.find((p) => fs.existsSync(p));
    if (resolved) {
      fileHits++;
      resolvedPaths.push(resolved);
      evidence.push(`file exists: ${ref}`);
    } else {
      fileMisses++;
      evidence.push(`file NOT found: ${ref}`);
    }
  }

  // All file refs are missing → hallucination
  if (fileMisses > 0 && fileHits === 0 && fileRefs.length > 0) {
    return { confidence: "hallucination", evidence };
  }

  // Pass 2: identifier grep inside matched files
  // Extract camelCase/snake_case identifiers referenced after "function", "method", backtick, or quotes
  const identifierRefs = [];
  const identRe = /\b(?:function|method|handler|endpoint|`|'|")(\w{3,})\b/g;
  let m;
  while ((m = identRe.exec(detail)) !== null) {
    identifierRefs.push(m[1]);
  }

  if (resolvedPaths.length > 0 && identifierRefs.length > 0) {
    let identHits = 0;
    let identMisses = 0;

    for (const ident of identifierRefs) {
      // Search for the identifier in any of the resolved files
      const result = spawnSync("grep", ["-rl", "--include=*.js", ident, ...resolvedPaths], {
        encoding: "utf8",
        timeout: 3000
      });
      if (result.status === 0 && result.stdout.trim()) {
        identHits++;
        evidence.push(`identifier found: ${ident}`);
      } else {
        identMisses++;
        evidence.push(`identifier NOT found: ${ident}`);
      }
    }

    // All identifiers missing in existing files → near-hallucination
    if (identMisses > 0 && identHits === 0) {
      return { confidence: "unverified", evidence };
    }
    if (identHits > 0) {
      return { confidence: "verified", evidence };
    }
  }

  if (fileHits > 0) {
    return { confidence: "verified", evidence };
  }

  // Generic finding with no code references — plausible but unverifiable
  const funcRefs = detail.match(/\b(?:function|method|handler|endpoint)\s+[`'"]?(\w+)[`'"]?/gi) || [];
  if (fileRefs.length === 0 && funcRefs.length === 0) {
    return { confidence: "plausible", evidence: ["No specific code references to verify"] };
  }
  return { confidence: "unverified", evidence };
}

// ── Core: Deduplicate Findings ──────────────────────────────────

/**
 * Deduplicate findings across all runs.
 * Same finding seen N times → 1 card with recurrence count.
 *
 * @param {Array} allFindings - raw findings from all runs
 * @returns {Array} deduplicated findings, each with `recurrence`, `run_ids`, `fingerprint`
 */
function deduplicateFindings(allFindings) {
  const groups = new Map();

  for (const finding of allFindings) {
    const fp = fingerprintFinding(finding);
    if (!groups.has(fp)) {
      groups.set(fp, {
        ...finding,
        fingerprint: fp,
        recurrence: 0,
        run_ids: [],
        first_seen: finding.run_id,
        models_seen: new Set()
      });
    }

    const group = groups.get(fp);
    group.recurrence++;
    if (finding.run_id) group.run_ids.push(finding.run_id);
    if (finding.model) group.models_seen.add(finding.model);

    // Keep the longest/most detailed version
    if ((finding.detail || "").length > (group.detail || "").length) {
      group.detail = finding.detail;
    }
  }

  return Array.from(groups.values()).map((g) => ({
    ...g,
    models_seen: Array.from(g.models_seen),
    run_ids: [...new Set(g.run_ids)]
  }));
}

// ── Core: Score and Rank Findings ───────────────────────────────

/**
 * Score findings by priority.
 * score = (severity_weight × confidence) + 0.5 × log2(recurrence + 1)
 *
 * Severity always dominates — a novel critical beats a recurring medium.
 * Recurrence adds signal as a bonus without hijacking rank.
 *
 * @param {Array} findings - deduplicated findings
 * @param {string} repoRoot - for verification
 * @returns {Array} scored and sorted findings (highest priority first)
 */
function scoreFindings(findings, repoRoot) {
  const suppressions = loadSuppressions();

  return findings
    .map((finding) => {
      const fp = finding.fingerprint || fingerprintFinding(finding);
      const suppression = isSuppressed(finding, fp, suppressions);
      if (suppression.suppressed) {
        return { ...finding, verification: "suppressed", suppression_reason: suppression.reason, priority_score: 0 };
      }

      const sevWeight = SEVERITY_WEIGHTS[finding.severity] || SEVERITY_WEIGHTS.medium;
      const verification = verifyFinding(finding, repoRoot);
      const confWeight = VERIFICATION_CONFIDENCE[verification.confidence] || 0.4;
      const frequencyBonus = 0.5 * Math.log2((finding.recurrence || 1) + 1);

      const score = (sevWeight * confWeight) + frequencyBonus;

      return {
        ...finding,
        verification: verification.confidence,
        verification_evidence: verification.evidence,
        priority_score: Math.round(score * 100) / 100,
        actionable: hasActionableDetail(finding)
      };
    })
    .filter((f) => f.verification !== "hallucination" && f.verification !== "suppressed")
    .sort((a, b) => b.priority_score - a.priority_score);
}

/**
 * Check if a finding has enough detail to generate an edit.
 */
function hasActionableDetail(finding) {
  const detail = finding.detail || "";
  // Actionable = mentions specific file + has concrete suggestion
  const hasFile = /\.(js|ts|json|yaml|yml|md)/.test(detail);
  const hasSuggestion = /should|must|add|remove|replace|change|fix|update|validate|check/i.test(detail);
  return hasFile && hasSuggestion;
}

// ── Aggregation Pipeline ────────────────────────────────────────

/**
 * Full intelligence pipeline: aggregate → deduplicate → verify → score → rank.
 *
 * @param {Array<{runDir: string, manifest: object}>} manifests - from listRunManifests()
 * @param {string} repoRoot - absolute path to repo
 * @returns {{
 *   findings: Array,
 *   stats: {total_raw: number, unique: number, verified: number, hallucinations: number, actionable: number}
 * }}
 */
function processFindings(manifests, repoRoot) {
  // 1. Aggregate all findings from all runs
  const allRaw = [];
  for (const { runDir, manifest } of manifests) {
    if (!manifest.agent) continue;
    const analysisPath = path.join(runDir, "artifacts", "agent", "analysis-response.json");
    if (!fs.existsSync(analysisPath)) continue;
    try {
      const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
      const findings = analysis.findings || analysis.suggestions || analysis.vulnerabilities || [];
      for (const f of findings) {
        allRaw.push({
          ...f,
          track: manifest.track || manifest.requested_area || "unknown",
          run_id: manifest.run_id,
          goal_mode: manifest.agent?.goal_mode || "edit",
          model: manifest.agent?.model || "unknown"
        });
      }
    } catch { /* skip corrupt */ }
  }

  // 2. Deduplicate
  const unique = deduplicateFindings(allRaw);

  // 3. Score and rank (includes verification)
  const scored = scoreFindings(unique, repoRoot);

  // 4. Stats
  const suppressions = loadSuppressions();
  const suppressedCount = unique.filter((f) => {
    const fp = fingerprintFinding(f);
    return isSuppressed(f, fp, suppressions).suppressed;
  }).length;

  const stats = {
    total_raw: allRaw.length,
    unique: unique.length,
    verified: scored.filter((f) => f.verification === "verified").length,
    hallucinations: unique.length - scored.length - suppressedCount,
    suppressed: suppressedCount,
    actionable: scored.filter((f) => f.actionable).length,
    by_severity: {
      critical: scored.filter((f) => f.severity === "critical").length,
      high: scored.filter((f) => f.severity === "high").length,
      medium: scored.filter((f) => f.severity === "medium").length,
      low: scored.filter((f) => f.severity === "low").length
    }
  };

  return { findings: scored, stats };
}

// ── Track Staleness ─────────────────────────────────────────────

/**
 * Compute per-track staleness (days since last audit).
 * Used by scout to decide which track to audit next.
 *
 * @param {Array<{manifest: object}>} manifests
 * @param {Array<string>} allTracks - all known track names
 * @returns {Array<{track: string, daysSinceAudit: number, lastRunId: string|null}>}
 */
function computeStaleness(manifests, allTracks) {
  const lastAudit = {};

  for (const { manifest } of manifests) {
    const track = manifest.track || manifest.requested_area;
    if (!track) continue;
    const ts = manifest.updated_at || manifest.created_at;
    if (!ts) continue;

    const time = new Date(ts).getTime();
    if (!lastAudit[track] || time > lastAudit[track].time) {
      lastAudit[track] = { time, runId: manifest.run_id };
    }
  }

  const now = Date.now();
  return allTracks.map((track) => {
    const last = lastAudit[track];
    return {
      track,
      daysSinceAudit: last ? Math.round((now - last.time) / (1000 * 60 * 60 * 24)) : 999,
      lastRunId: last?.runId || null
    };
  }).sort((a, b) => b.daysSinceAudit - a.daysSinceAudit);
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = {
  fingerprintFinding,
  verifyFinding,
  deduplicateFindings,
  scoreFindings,
  processFindings,
  computeStaleness,
  hasActionableDetail,
  loadSuppressions,
  isSuppressed,
  SEVERITY_WEIGHTS,
  VERIFICATION_CONFIDENCE
};
