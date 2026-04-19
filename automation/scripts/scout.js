"use strict";

/**
 * scout.js — Autonomous codebase scout for kaayko-api.
 *
 * The scout finds its own work. It:
 * 1. Picks the stalest track (longest since last audit)
 * 2. Runs a lightweight audit to discover issues
 * 3. Optionally ideates new features/improvements
 * 4. Enqueues findings as prioritized goals for the queue processor
 *
 * You approve or reject from the dashboard — it never deploys without consent.
 *
 * Usage:
 *   kaayko-api scout                  # single sweep of stalest track
 *   kaayko-api scout --continuous     # run continuously every N hours
 *   kaayko-api scout --track kortex   # scout a specific track
 *   kaayko-api scout --ideate         # also generate feature ideas
 */

const path = require("path");
const fs = require("fs");

const SCRIPT_DIR = __dirname;
const AUTOMATION_ROOT = path.resolve(SCRIPT_DIR, "..");

// ── Scout Configuration ─────────────────────────────────────────

const SCOUT_DEFAULTS = {
  intervalHours: 4,          // how often to sweep in continuous mode
  maxQueueDepth: 10,         // don't enqueue more if queue already has 10+ pending
  stalenessDaysThreshold: 3, // track is "stale" if not audited in 3+ days
  ideateEnabled: false,      // feature ideation off by default
  auditGoals: [
    "Security audit: check for unvalidated inputs, missing auth, injection risks, and exposed secrets",
    "Code quality: find dead code, duplicated logic, missing error handling, and inconsistent patterns",
    "API contract: verify request/response schemas match documentation, check for undocumented endpoints"
  ]
};

// ── Core: Single Sweep ──────────────────────────────────────────

/**
 * Run a single scout sweep. Picks the stalest track and enqueues an audit.
 *
 * @param {object} options
 * @param {string} [options.track] - specific track to scout (overrides staleness)
 * @param {boolean} [options.ideate] - also generate feature ideas
 * @param {boolean} [options.dryRun] - don't actually enqueue, just report what would be done
 * @param {object} helpers - loop-helpers module
 * @param {object} findingIntel - finding-intelligence module
 * @param {object} pipelineQueue - pipeline-queue module
 * @returns {{track: string, goals: Array, enqueued: number, skipped: string|null}}
 */
function sweep(options, helpers, findingIntel, pipelineQueue) {
  const config = helpers.loadJson(path.join(AUTOMATION_ROOT, "config", "api-loop.json"));
  const allTracks = Object.keys(config.tracks || {});

  // Check queue depth — don't flood it
  const overview = pipelineQueue.getQueueOverview();
  if (overview.counts.pending >= SCOUT_DEFAULTS.maxQueueDepth) {
    return {
      track: null,
      goals: [],
      enqueued: 0,
      skipped: `Queue already has ${overview.counts.pending} pending items (max ${SCOUT_DEFAULTS.maxQueueDepth})`
    };
  }

  // Pick target track
  let targetTrack = options.track;
  if (!targetTrack) {
    const manifests = helpers.listRunManifests();
    const staleness = findingIntel.computeStaleness(manifests, allTracks);
    const stalest = staleness[0];
    if (!stalest || stalest.daysSinceAudit < SCOUT_DEFAULTS.stalenessDaysThreshold) {
      return {
        track: stalest?.track || null,
        goals: [],
        enqueued: 0,
        skipped: stalest
          ? `Stalest track "${stalest.track}" was audited ${stalest.daysSinceAudit}d ago (threshold: ${SCOUT_DEFAULTS.stalenessDaysThreshold}d)`
          : "No tracks found"
      };
    }
    targetTrack = stalest.track;
  }

  // Build goals
  const goals = [];

  // Always add a security audit
  goals.push({
    track: targetTrack,
    goal: SCOUT_DEFAULTS.auditGoals[0],
    goalMode: "audit",
    priority: "normal",
    source: "scout"
  });

  // Add code quality audit if track is very stale (>7 days)
  const manifests = helpers.listRunManifests();
  const staleness = findingIntel.computeStaleness(manifests, allTracks);
  const trackStaleness = staleness.find((s) => s.track === targetTrack);
  if (trackStaleness && trackStaleness.daysSinceAudit > 7) {
    goals.push({
      track: targetTrack,
      goal: SCOUT_DEFAULTS.auditGoals[1],
      goalMode: "audit",
      priority: "low",
      source: "scout"
    });
  }

  // Feature ideation (if enabled)
  if (options.ideate) {
    goals.push({
      track: targetTrack,
      goal: `Feature ideation: Given the ${targetTrack} API track, identify 1-2 specific features that would improve reliability, security, or developer experience. Name the exact file, function, and proposed change.`,
      goalMode: "audit",
      priority: "background",
      source: "scout-ideate"
    });
  }

  // Enqueue
  let enqueued = 0;
  if (!options.dryRun) {
    for (const g of goals) {
      pipelineQueue.enqueue(g);
      enqueued++;
    }
  }

  return {
    track: targetTrack,
    goals,
    enqueued,
    skipped: null,
    staleness: trackStaleness?.daysSinceAudit || null
  };
}

// ── Continuous Mode ─────────────────────────────────────────────

/**
 * Run scout continuously.
 *
 * @param {object} options
 * @param {number} [options.intervalHours=4]
 * @param {boolean} [options.ideate]
 * @param {object} helpers
 * @param {object} findingIntel
 * @param {object} pipelineQueue
 * @returns {{ stop: Function }} control handle
 */
function startContinuous(options, helpers, findingIntel, pipelineQueue) {
  const intervalMs = (options.intervalHours || SCOUT_DEFAULTS.intervalHours) * 60 * 60 * 1000;
  let timer = null;
  let running = true;

  const run = () => {
    if (!running) return;
    const result = sweep(options, helpers, findingIntel, pipelineQueue);

    const ts = new Date().toISOString().slice(0, 19);
    if (result.skipped) {
      console.log(`  [scout ${ts}] Skipped: ${result.skipped}`);
    } else {
      console.log(`  [scout ${ts}] Swept ${result.track}: ${result.enqueued} goals enqueued`);
    }

    // Log to file
    const logPath = path.join(AUTOMATION_ROOT, "logs", "scout.log");
    const logLine = `${ts} | track=${result.track || "none"} | enqueued=${result.enqueued} | skipped=${result.skipped || "no"}\n`;
    try { fs.appendFileSync(logPath, logLine); } catch { /* ignore */ }

    timer = setTimeout(run, intervalMs);
  };

  // Run immediately, then on interval
  run();

  return {
    stop: () => {
      running = false;
      if (timer) clearTimeout(timer);
    }
  };
}

// ── Scout Report ────────────────────────────────────────────────

/**
 * Generate a scout status report for the dashboard.
 */
function getScoutReport(helpers, findingIntel) {
  const config = helpers.loadJson(path.join(AUTOMATION_ROOT, "config", "api-loop.json"));
  const allTracks = Object.keys(config.tracks || {});
  const manifests = helpers.listRunManifests();
  const staleness = findingIntel.computeStaleness(manifests, allTracks);

  // Read scout log
  const logPath = path.join(AUTOMATION_ROOT, "logs", "scout.log");
  let recentLogs = [];
  try {
    const logContent = fs.readFileSync(logPath, "utf8");
    recentLogs = logContent.trim().split("\n").slice(-10);
  } catch { /* no log yet */ }

  return {
    trackStaleness: staleness,
    nextTarget: staleness[0]?.daysSinceAudit >= SCOUT_DEFAULTS.stalenessDaysThreshold
      ? staleness[0]
      : null,
    config: SCOUT_DEFAULTS,
    recentLogs
  };
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = {
  sweep,
  startContinuous,
  getScoutReport,
  SCOUT_DEFAULTS
};
