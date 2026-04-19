"use strict";

/**
 * pipeline-queue.js — Run queue engine with GPU-aware scheduling.
 *
 * Architecture:
 * - Maintains a priority queue of pending goals
 * - GPU inference is serialized (1 at a time, correct for M1 Pro Max)
 * - CPU phases (collect, load, verify, report) can overlap with GPU of another run
 * - Auto-drains: when a run finishes, starts the next one immediately
 *
 * Queue storage: automation/queue/{pending,processing,done,failed}/
 * Each item is a JSON file: { id, track, goal, goalMode, priority, createdAt, ... }
 *
 * Integration:
 * - `kaayko-api enqueue --area X --goal "Y"` adds to queue
 * - `kaayko-api worker` starts the queue processor
 * - Dashboard polls /api/queue for live status
 * - Scout auto-enqueues via this module
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const EventEmitter = require("events");

// ── Constants ───────────────────────────────────────────────────

const SCRIPT_DIR = __dirname;
const AUTOMATION_ROOT = path.resolve(SCRIPT_DIR, "..");
const QUEUE_ROOT = path.join(AUTOMATION_ROOT, "queue");
const QUEUE_DIRS = {
  pending: path.join(QUEUE_ROOT, "pending"),
  processing: path.join(QUEUE_ROOT, "processing"),
  done: path.join(QUEUE_ROOT, "done"),
  failed: path.join(QUEUE_ROOT, "failed")
};
const LOGS_DIR = path.join(AUTOMATION_ROOT, "logs");

// Priority levels (lower number = higher priority)
const PRIORITIES = {
  critical: 1,   // Security findings, critical bugs
  high: 2,       // Important edits, high-severity findings
  normal: 3,     // Standard audits and edits
  low: 4,        // Scout suggestions, nice-to-haves
  background: 5  // Automated periodic scans
};

function normalizeGoalText(goal) {
  return String(goal || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function makeQueueFingerprint(track, goal, goalMode = "audit") {
  const normalized = [
    String(track || "shared").toLowerCase().trim(),
    normalizeGoalText(goal),
    String(goalMode || "audit").toLowerCase().trim()
  ].join("|");

  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

function getItemFingerprint(item) {
  if (!item) return "";
  return item.fingerprint || makeQueueFingerprint(item.track, item.goal, item.goalMode);
}

function getItemTimestamp(item) {
  return item?.completedAt || item?.failedAt || item?.startedAt || item?.createdAt || null;
}

function findDuplicateItem(items, params, options = {}) {
  const fingerprint = params.fingerprint || makeQueueFingerprint(params.track, params.goal, params.goalMode);
  const cooldownMs = Number(options.cooldownMs || 0);
  const nowMs = Number(options.nowMs || Date.now());

  return items.find((item) => {
    if (getItemFingerprint(item) !== fingerprint) return false;
    if (cooldownMs <= 0) return true;

    const timestamp = getItemTimestamp(item);
    if (!timestamp) return true;

    const itemTime = new Date(timestamp).getTime();
    if (!Number.isFinite(itemTime)) return true;

    return nowMs - itemTime <= cooldownMs;
  }) || null;
}

// ── Queue Storage ───────────────────────────────────────────────

function ensureQueueDirs() {
  for (const dir of Object.values(QUEUE_DIRS)) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Create a new queue item.
 *
 * @param {object} params
 * @param {string} params.track - module track (weather, kortex, etc.)
 * @param {string} params.goal - the goal text
 * @param {string} [params.goalMode="audit"] - audit | edit | scout
 * @param {string} [params.priority="normal"]
 * @param {string} [params.source="manual"] - who enqueued: manual, scout, implement, dashboard
 * @param {object} [params.metadata] - extra data (finding reference, etc.)
 * @returns {object} the created queue item
 */
function enqueue(params) {
  ensureQueueDirs();

  const track = params.track || "shared";
  const goal = params.goal;
  const goalMode = params.goalMode || "audit";
  const fingerprint = makeQueueFingerprint(track, goal, goalMode);
  const allowDuplicate = params.allowDuplicate === true;
  const cooldownHours = Math.max(0, Number(params.cooldownHours || 0));

  if (!allowDuplicate) {
    const activeDuplicate = findDuplicateItem(
      [...listItems("pending"), ...listItems("processing")],
      { track, goal, goalMode, fingerprint }
    );

    if (activeDuplicate) {
      return {
        ...activeDuplicate,
        fingerprint: getItemFingerprint(activeDuplicate),
        duplicate: true,
        enqueued: false,
        duplicateState: activeDuplicate.status || "pending"
      };
    }

    if (cooldownHours > 0) {
      const recentDuplicate = findDuplicateItem(
        [...listItems("done"), ...listItems("failed")],
        { track, goal, goalMode, fingerprint },
        { cooldownMs: cooldownHours * 60 * 60 * 1000 }
      );

      if (recentDuplicate) {
        return {
          ...recentDuplicate,
          fingerprint: getItemFingerprint(recentDuplicate),
          duplicate: true,
          enqueued: false,
          duplicateState: recentDuplicate.status || "recent"
        };
      }
    }
  }

  const id = `q-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const item = {
    id,
    fingerprint,
    track,
    goal,
    goalMode,
    priority: PRIORITIES[params.priority] || PRIORITIES.normal,
    priorityLabel: params.priority || "normal",
    source: params.source || "manual",
    metadata: params.metadata || {},
    createdAt: new Date().toISOString(),
    status: "pending"
  };

  const filePath = path.join(QUEUE_DIRS.pending, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(item, null, 2));
  return { ...item, duplicate: false, enqueued: true };
}

/**
 * List all items in a queue state.
 * @param {"pending"|"processing"|"done"|"failed"} state
 * @returns {Array<object>}
 */
function listItems(state) {
  const dir = QUEUE_DIRS[state];
  if (!dir || !fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Move an item between queue states.
 */
function moveItem(itemId, fromState, toState, updates = {}) {
  const fromPath = path.join(QUEUE_DIRS[fromState], `${itemId}.json`);
  const toPath = path.join(QUEUE_DIRS[toState], `${itemId}.json`);

  if (!fs.existsSync(fromPath)) return null;

  const item = JSON.parse(fs.readFileSync(fromPath, "utf8"));
  Object.assign(item, updates, { status: toState });

  fs.writeFileSync(toPath, JSON.stringify(item, null, 2));
  fs.unlinkSync(fromPath);
  return item;
}

const DEQUEUE_LOCK_PATH = path.join(QUEUE_ROOT, ".dequeue.lock");
const DEQUEUE_LOCK_STALE_MS = 30_000; // 30s — if lock is older than this, it's from a dead process

/**
 * Acquire an advisory dequeue lock using mkdir (atomic on POSIX).
 * Returns true if acquired, false if already held.
 */
function acquireDequeuelock() {
  try {
    // Check for stale lock
    if (fs.existsSync(DEQUEUE_LOCK_PATH)) {
      const stat = fs.statSync(DEQUEUE_LOCK_PATH);
      if (Date.now() - stat.mtimeMs > DEQUEUE_LOCK_STALE_MS) {
        fs.rmSync(DEQUEUE_LOCK_PATH, { force: true });
      } else {
        return false;
      }
    }
    fs.mkdirSync(DEQUEUE_LOCK_PATH); // atomic on POSIX — throws if exists
    return true;
  } catch {
    return false;
  }
}

function releaseDequeuelock() {
  try { fs.rmdirSync(DEQUEUE_LOCK_PATH); } catch { /* ignore */ }
}

/**
 * Get next item to process (highest priority, oldest first).
 * Uses an advisory lock to prevent double-dequeue under concurrent workers.
 */
function dequeue() {
  if (!acquireDequeuelock()) return null; // another caller holds the lock
  try {
    const pending = listItems("pending");
    if (!pending.length) return null;

    // Sort by priority (lower = higher), then by creation time
    pending.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    const item = pending[0];
    // Move to processing while lock is held — prevents any concurrent dequeue from picking it
    moveItem(item.id, "pending", "processing", { startedAt: new Date().toISOString() });
    return item;
  } finally {
    releaseDequeuelock();
  }
}

// ── Queue Processor ─────────────────────────────────────────────

/**
 * QueueProcessor — event-driven queue worker.
 *
 * Events:
 *   "start" → { item }
 *   "complete" → { item, duration, exitCode }
 *   "error" → { item, error }
 *   "drain" → {} (queue is empty)
 *   "idle" → {} (processor is waiting)
 */
class QueueProcessor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.running = false;
    this.currentItem = null;
    this.currentProcess = null;
    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures || 3;
    this.consecutiveFailures = 0;
    this._pollTimer = null;
    this._stopping = false;
  }

  /**
   * Start processing the queue.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this._stopping = false;
    this._processNext();
  }

  /**
   * Stop processing (waits for current item to finish).
   */
  stop() {
    this._stopping = true;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    if (!this.currentItem) {
      this.running = false;
      this.emit("stopped");
    }
    // If a task is running, it will stop after completion
  }

  /**
   * Process the next item in the queue.
   */
  async _processNext() {
    if (this._stopping) {
      this.running = false;
      this.emit("stopped");
      return;
    }

    const item = dequeue();
    if (!item) {
      this.emit("idle");
      // Poll for new items
      this._pollTimer = setTimeout(() => this._processNext(), this.pollIntervalMs);
      return;
    }

    this.currentItem = item;
    this.consecutiveFailures = 0;

    // Item is already in processing state (dequeue() moved it atomically)
    this.emit("start", { item });

    const startTime = Date.now();
    const logFile = `${item.id}.log`;
    const logPath = path.join(LOGS_DIR, logFile);

    try {
      const exitCode = await this._executeItem(item, logPath);
      const duration = Date.now() - startTime;

      if (exitCode === 0) {
        moveItem(item.id, "processing", "done", {
          completedAt: new Date().toISOString(),
          durationMs: duration,
          exitCode,
          logFile
        });
        this.emit("complete", { item, duration, exitCode });
        this.consecutiveFailures = 0;
      } else {
        moveItem(item.id, "processing", "failed", {
          failedAt: new Date().toISOString(),
          durationMs: duration,
          exitCode,
          logFile,
          error: `Agent exited with code ${exitCode}`
        });
        this.emit("error", { item, error: `Exit code ${exitCode}` });
        this.consecutiveFailures++;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      moveItem(item.id, "processing", "failed", {
        failedAt: new Date().toISOString(),
        durationMs: duration,
        logFile,
        error: error.message
      });
      this.emit("error", { item, error: error.message });
      this.consecutiveFailures++;
    }

    this.currentItem = null;
    this.currentProcess = null;

    // Circuit breaker: if too many consecutive failures, pause
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.emit("circuit-break", {
        failures: this.consecutiveFailures,
        pauseMs: 60000
      });
      await new Promise((r) => setTimeout(r, 60000));
      this.consecutiveFailures = 0;
    }

    // Immediately process next (no delay between successful runs)
    setImmediate(() => this._processNext());
  }

  /**
   * Execute a single queue item by spawning the agent.
   * @returns {Promise<number>} exit code
   */
  _executeItem(item, logPath) {
    return new Promise((resolve, reject) => {
      const args = [
        path.join(SCRIPT_DIR, "portfolio-loop.js"),
        "agent",
        "--area", item.track,
        "--goal", item.goal
      ];

      if (item.goalMode) {
        args.push("--goal-mode", item.goalMode);
      }
      if (item.goalMode === "edit") {
        args.push("--apply", "safe");
      }

      const child = spawn(process.execPath, args, {
        cwd: path.resolve(AUTOMATION_ROOT, ".."),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      this.currentProcess = child;

      const logStream = fs.createWriteStream(logPath, { flags: "a" });
      logStream.write(`[queue] Starting ${item.id} at ${new Date().toISOString()}\n`);
      logStream.write(`[queue] Track: ${item.track}, Goal: ${item.goal}, Mode: ${item.goalMode}\n\n`);

      child.stdout.pipe(logStream);
      child.stderr.pipe(logStream);

      child.on("exit", (code) => {
        logStream.write(`\n[exit ${code}]\n`);
        logStream.end();
        resolve(code ?? 1);
      });

      child.on("error", (err) => {
        logStream.write(`\n[error] ${err.message}\n`);
        logStream.end();
        reject(err);
      });
    });
  }

  /**
   * Get current processor status.
   */
  getStatus() {
    return {
      running: this.running,
      currentItem: this.currentItem,
      consecutiveFailures: this.consecutiveFailures,
      pending: listItems("pending").length,
      processing: listItems("processing").length,
      done: listItems("done").length,
      failed: listItems("failed").length
    };
  }
}

// ── Queue Stats ─────────────────────────────────────────────────

/**
 * Get full queue overview for dashboard.
 */
function getQueueOverview() {
  ensureQueueDirs();
  const pending = listItems("pending");
  const processing = listItems("processing");
  const done = listItems("done");
  const failed = listItems("failed");

  return {
    counts: {
      pending: pending.length,
      processing: processing.length,
      done: done.length,
      failed: failed.length,
      total: pending.length + processing.length + done.length + failed.length
    },
    pending: pending.sort((a, b) => a.priority - b.priority),
    processing,
    recentDone: done
      .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0))
      .slice(0, 5),
    recentFailed: failed
      .sort((a, b) => new Date(b.failedAt || 0) - new Date(a.failedAt || 0))
      .slice(0, 5),
    throughput: computeThroughput(done)
  };
}

/**
 * Compute runs/hour throughput from completed items.
 */
function computeThroughput(doneItems) {
  if (doneItems.length < 2) return null;

  const sorted = doneItems
    .filter((d) => d.completedAt)
    .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));

  if (sorted.length < 2) return null;

  const firstTime = new Date(sorted[0].completedAt).getTime();
  const lastTime = new Date(sorted[sorted.length - 1].completedAt).getTime();
  const durationHours = (lastTime - firstTime) / (1000 * 60 * 60);

  if (durationHours < 0.01) return null;

  return {
    runsPerHour: Math.round((sorted.length / durationHours) * 10) / 10,
    avgDurationSec: Math.round(
      sorted.reduce((sum, d) => sum + (d.durationMs || 0), 0) / sorted.length / 1000
    ),
    window: `${sorted.length} runs over ${durationHours.toFixed(1)}h`
  };
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = {
  enqueue,
  dequeue,
  listItems,
  moveItem,
  getQueueOverview,
  QueueProcessor,
  makeQueueFingerprint,
  findDuplicateItem,
  normalizeGoalText,
  PRIORITIES,
  QUEUE_DIRS,
  ensureQueueDirs
};
