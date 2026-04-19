"use strict";

const path = require("path");
const h = require("../scripts/loop-helpers");

// ── String Utilities ────────────────────────────────────────────

describe("slugify", () => {
  test("converts to lowercase with hyphens", () => {
    expect(h.slugify("Hello World")).toBe("hello-world");
  });
  test("strips special characters", () => {
    expect(h.slugify("Fix: bug #123!")).toBe("fix-bug-123");
  });
  test("handles empty string", () => {
    expect(h.slugify("")).toBe("");
  });
});

describe("escapeHtml", () => {
  test("escapes angle brackets", () => {
    expect(h.escapeHtml("<script>")).toBe("&lt;script&gt;");
  });
  test("escapes ampersand and quotes", () => {
    expect(h.escapeHtml('a & "b"')).toContain("&amp;");
    expect(h.escapeHtml('a & "b"')).toContain("&quot;");
  });
});

describe("clampScore", () => {
  test("clamps to 0-100 range", () => {
    expect(h.clampScore(-5)).toBe(0);
    expect(h.clampScore(150)).toBe(100);
    expect(h.clampScore(50)).toBe(50);
  });
});

describe("roundNumber", () => {
  test("rounds number", () => {
    expect(h.roundNumber(3.14159, 1)).toBe(3.1);
    expect(h.roundNumber(3.14159)).toBe(3.1);
  });
});

describe("uniqueStrings", () => {
  test("removes duplicates", () => {
    expect(h.uniqueStrings(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });
  test("handles empty", () => {
    expect(h.uniqueStrings([])).toEqual([]);
  });
});

describe("summarizeOllamaFailure", () => {
  test("compresses connection failures", () => {
    expect(
      h.summarizeOllamaFailure("curl: (7) Failed to connect to 127.0.0.1 port 11434 after 0 ms")
    ).toContain("daemon not reachable");
  });

  test("compresses MLX crash output", () => {
    expect(
      h.summarizeOllamaFailure("NSRangeException libmlx mlx_random_key SIGABRT")
    ).toContain("MLX/Metal");
  });
});

// ── Metrics ─────────────────────────────────────────────────────

describe("isMeaningfulProductFile", () => {
  test("functions files are meaningful", () => {
    expect(h.isMeaningfulProductFile("api:functions/api/weather/index.js")).toBe(true);
  });
  test("ml-service files are meaningful", () => {
    expect(h.isMeaningfulProductFile("api:ml-service/main.py")).toBe(true);
  });
  test("automation files are not meaningful", () => {
    expect(h.isMeaningfulProductFile("api:automation/scripts/loop.js")).toBe(false);
  });
  test("config files are not meaningful", () => {
    expect(h.isMeaningfulProductFile("api:package.json")).toBe(false);
  });
});

describe("severityRank", () => {
  test("critical < high < medium < low < unknown", () => {
    expect(h.severityRank("critical")).toBeLessThan(h.severityRank("high"));
    expect(h.severityRank("high")).toBeLessThan(h.severityRank("medium"));
    expect(h.severityRank("medium")).toBeLessThan(h.severityRank("low"));
  });
  test("unknown severity returns highest rank", () => {
    expect(h.severityRank("nonsense")).toBe(4);
  });
});

describe("isVulnerabilityFinding", () => {
  test("critical severity is a vulnerability", () => {
    expect(h.isVulnerabilityFinding({ severity: "critical" })).toBe(true);
  });
  test("security category is a vulnerability", () => {
    expect(h.isVulnerabilityFinding({ severity: "medium", category: "security" })).toBe(true);
  });
  test("low maintainability is not a vulnerability", () => {
    expect(h.isVulnerabilityFinding({ severity: "low", category: "maintainability" })).toBe(false);
  });
});

describe("isSuggestionFinding", () => {
  test("low severity maintainability is a suggestion", () => {
    expect(h.isSuggestionFinding({ severity: "low", category: "maintainability" })).toBe(true);
  });
  test("critical is not a suggestion", () => {
    expect(h.isSuggestionFinding({ severity: "critical" })).toBe(false);
  });
});

describe("debtLevelFromMetrics", () => {
  test("failed gates → high debt", () => {
    expect(h.debtLevelFromMetrics(1, { total_churn: 100 })).toBe("high");
  });
  test("high churn → high debt", () => {
    expect(h.debtLevelFromMetrics(0, { total_churn: 800, changed_files_count: 5 })).toBe("high");
  });
  test("moderate → medium debt", () => {
    expect(h.debtLevelFromMetrics(0, { total_churn: 400, changed_files_count: 20 })).toBe("medium");
  });
  test("small changes → low debt", () => {
    expect(h.debtLevelFromMetrics(0, { total_churn: 50, changed_files_count: 3 })).toBe("low");
  });
});

describe("parseDiffStatSummary", () => {
  test("parses standard git diff stat", () => {
    const stat = " 3 files changed, 45 insertions(+), 12 deletions(-)";
    const result = h.parseDiffStatSummary(stat);
    expect(result.files_changed).toBe(3);
    expect(result.insertions).toBe(45);
    expect(result.deletions).toBe(12);
  });
  test("handles empty input", () => {
    const result = h.parseDiffStatSummary("");
    expect(result.files_changed).toBe(0);
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
  });
});

describe("parseNumStatSummary", () => {
  test("filters churn to allowed product files", () => {
    const stat = [
      "12\t3\tfunctions/api/weather/index.js",
      "4\t1\tautomation/scripts/loop.js",
      "7\t0\tfunctions/middleware/auth.js"
    ].join("\n");

    const result = h.parseNumStatSummary(stat, [
      "functions/api/weather/index.js",
      "functions/middleware/auth.js"
    ]);

    expect(result.files_changed).toBe(2);
    expect(result.insertions).toBe(19);
    expect(result.deletions).toBe(3);
  });
});

describe("computeRunMetrics", () => {
  test("computes from manifest with changed_files", () => {
    const manifest = {
      changed_files: [
        "api:functions/api/weather/index.js",
        "api:functions/package.json",
        "api:ml-service/main.py"
      ],
      git_snapshots: [{
        diff_stat: " 3 files changed, 20 insertions(+), 5 deletions(-)"
      }]
    };
    const metrics = h.computeRunMetrics(manifest);
    expect(metrics.changed_files_count).toBe(3);
    expect(metrics.meaningful_product_files_changed).toBe(3);
    expect(metrics.total_churn).toBe(25);
  });
  test("prefers product diff summary over repo-wide diff stat", () => {
    const manifest = {
      changed_files: [],
      git_snapshots: [{
        diff_stat: " 9 files changed, 607 insertions(+), 95 deletions(-)",
        product_diff_summary: { files_changed: 0, insertions: 0, deletions: 0 }
      }]
    };
    const metrics = h.computeRunMetrics(manifest);
    expect(metrics.changed_files_count).toBe(0);
    expect(metrics.insertions).toBe(0);
    expect(metrics.deletions).toBe(0);
    expect(metrics.total_churn).toBe(0);
  });
  test("handles empty manifest", () => {
    const metrics = h.computeRunMetrics({});
    expect(metrics.changed_files_count).toBe(0);
    expect(metrics.total_churn).toBe(0);
  });
});

// ── Validation ──────────────────────────────────────────────────

describe("validateReview", () => {
  const validReview = {
    decision: "approved",
    accuracy_score: 80,
    maintainability_score: 75,
    confidence_score: 90,
    summary: "Good work",
    findings: [],
    security_findings: [],
    debt_findings: [],
    ux_findings: [],
    required_followups: [],
    waivers: [],
    context_checks: {
      api_surfaces_checked: [],
      backend_routes_checked: [],
      tests_run: []
    },
    training_labels: { approved_for_training: false }
  };

  test("accepts valid review without throwing", () => {
    expect(() => h.validateReview(validReview)).not.toThrow();
  });

  test("rejects missing decision", () => {
    const bad = { ...validReview, decision: undefined };
    expect(() => h.validateReview(bad)).toThrow();
  });
});

// ── Log Pruning ─────────────────────────────────────────────────

describe("pruneOldLogs", () => {
  test("function exists and returns a number", () => {
    const result = h.pruneOldLogs(0); // 0 days = prune everything
    expect(typeof result).toBe("number");
  });
});
