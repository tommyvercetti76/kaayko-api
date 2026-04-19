"use strict";

const path = require("path");
const {
  fingerprintFinding,
  deduplicateFindings,
  scoreFindings,
  hasActionableDetail,
  computeStaleness,
  SEVERITY_WEIGHTS,
  VERIFICATION_CONFIDENCE
} = require("../scripts/finding-intelligence");

// ── fingerprintFinding ──────────────────────────────────────────

describe("fingerprintFinding", () => {
  test("same title+severity+track → same fingerprint", () => {
    const a = { title: "Missing error handler", severity: "high", track: "weather" };
    const b = { title: "Missing error handler", severity: "high", track: "weather", detail: "totally different detail" };
    expect(fingerprintFinding(a)).toBe(fingerprintFinding(b));
  });

  test("different severity → different fingerprint", () => {
    const a = { title: "Missing error handler", severity: "high", track: "weather" };
    const b = { title: "Missing error handler", severity: "low", track: "weather" };
    expect(fingerprintFinding(a)).not.toBe(fingerprintFinding(b));
  });

  test("different track → different fingerprint", () => {
    const a = { title: "Missing error handler", severity: "high", track: "weather" };
    const b = { title: "Missing error handler", severity: "high", track: "commerce" };
    expect(fingerprintFinding(a)).not.toBe(fingerprintFinding(b));
  });

  test("case insensitive", () => {
    const a = { title: "MISSING Error Handler", severity: "HIGH", track: "Weather" };
    const b = { title: "missing error handler", severity: "high", track: "weather" };
    expect(fingerprintFinding(a)).toBe(fingerprintFinding(b));
  });

  test("handles missing fields gracefully", () => {
    expect(() => fingerprintFinding({})).not.toThrow();
    expect(fingerprintFinding({})).toBeTruthy();
  });
});

// ── deduplicateFindings ─────────────────────────────────────────

describe("deduplicateFindings", () => {
  test("merges duplicate findings by fingerprint", () => {
    const findings = [
      { title: "Unused variable", severity: "low", track: "weather", run_id: "run-1", detail: "short" },
      { title: "Unused variable", severity: "low", track: "weather", run_id: "run-2", detail: "much longer detail here" },
      { title: "Unused variable", severity: "low", track: "weather", run_id: "run-3", detail: "mid" }
    ];
    const deduped = deduplicateFindings(findings);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].recurrence).toBe(3);
    expect(deduped[0].run_ids).toHaveLength(3);
    // Keeps longest detail
    expect(deduped[0].detail).toBe("much longer detail here");
  });

  test("keeps distinct findings separate", () => {
    const findings = [
      { title: "Bug A", severity: "high", track: "weather" },
      { title: "Bug B", severity: "high", track: "weather" },
      { title: "Bug A", severity: "high", track: "commerce" }
    ];
    const deduped = deduplicateFindings(findings);
    expect(deduped).toHaveLength(3);
  });

  test("handles empty input", () => {
    expect(deduplicateFindings([])).toEqual([]);
  });

  test("tracks models_seen across runs", () => {
    const findings = [
      { title: "X", severity: "low", track: "t", model: "deepseek" },
      { title: "X", severity: "low", track: "t", model: "qwen" }
    ];
    const deduped = deduplicateFindings(findings);
    expect(deduped[0].models_seen).toContain("deepseek");
    expect(deduped[0].models_seen).toContain("qwen");
  });
});

// ── scoreFindings ───────────────────────────────────────────────

describe("scoreFindings", () => {
  const repoRoot = path.resolve(__dirname, "../../");

  test("higher severity → higher score", () => {
    const findings = [
      { title: "Generic low issue", severity: "low", track: "t", recurrence: 1 },
      { title: "Generic critical issue", severity: "critical", track: "t", recurrence: 1 }
    ];
    const scored = scoreFindings(findings, repoRoot);
    const lowScore = scored.find((f) => f.severity === "low").priority_score;
    const critScore = scored.find((f) => f.severity === "critical").priority_score;
    expect(critScore).toBeGreaterThan(lowScore);
  });

  test("results sorted by score descending", () => {
    const findings = [
      { title: "Low", severity: "low", track: "t", recurrence: 1 },
      { title: "High", severity: "high", track: "t", recurrence: 1 },
      { title: "Medium", severity: "medium", track: "t", recurrence: 1 }
    ];
    const scored = scoreFindings(findings, repoRoot);
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1].priority_score).toBeGreaterThanOrEqual(scored[i].priority_score);
    }
  });

  test("higher recurrence → higher score", () => {
    const findings = [
      { title: "Seen once", severity: "medium", track: "t", recurrence: 1 },
      { title: "Seen many times", severity: "medium", track: "t", recurrence: 10 }
    ];
    const scored = scoreFindings(findings, repoRoot);
    const once = scored.find((f) => f.title === "Seen once").priority_score;
    const many = scored.find((f) => f.title === "Seen many times").priority_score;
    expect(many).toBeGreaterThan(once);
  });
});

// ── hasActionableDetail ─────────────────────────────────────────

describe("hasActionableDetail", () => {
  test("finding with file ref and suggestion keyword is actionable", () => {
    expect(hasActionableDetail({ detail: "should fix the handler in routes.js" })).toBe(true);
  });

  test("finding with substantial detail but no file ref is not actionable", () => {
    expect(hasActionableDetail({ detail: "should add error handling everywhere" })).toBe(false);
  });

  test("finding with no detail and no edits is not actionable", () => {
    expect(hasActionableDetail({})).toBe(false);
    expect(hasActionableDetail({ detail: "short" })).toBe(false);
  });
});

// ── SEVERITY_WEIGHTS ────────────────────────────────────────────

describe("SEVERITY_WEIGHTS", () => {
  test("critical > high > medium > low > info", () => {
    expect(SEVERITY_WEIGHTS.critical).toBeGreaterThan(SEVERITY_WEIGHTS.high);
    expect(SEVERITY_WEIGHTS.high).toBeGreaterThan(SEVERITY_WEIGHTS.medium);
    expect(SEVERITY_WEIGHTS.medium).toBeGreaterThan(SEVERITY_WEIGHTS.low);
    expect(SEVERITY_WEIGHTS.low).toBeGreaterThan(SEVERITY_WEIGHTS.info);
  });
});
