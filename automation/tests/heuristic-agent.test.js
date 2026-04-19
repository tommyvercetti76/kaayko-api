"use strict";

const agentFiles = require("../scripts/agent-files");
const heuristicAgent = require("../scripts/heuristic-agent");

function makeFile(path, content) {
  return {
    path,
    repo: "api",
    relative_path: path.split(":").slice(1).join(":"),
    line_count: content.split("\n").length,
    truncated: false,
    content,
    full_content: content
  };
}

describe("detectGoalMode", () => {
  test("detects scout intent from ideation language", () => {
    expect(
      agentFiles.detectGoalMode("Feature ideation: identify reliability opportunities with exact files and proposed changes")
    ).toBe("scout");
  });
});

describe("heuristic agent fallback", () => {
  const routeFile = makeFile(
    "api:functions/api/widgets/routes.js",
    [
      "const router = require('express').Router();",
      "const { verifyAuth } = require('../../middleware/auth');",
      "",
      "router.post('/widgets', createWidget);",
      "router.get('/widgets/:id', verifyAuth, getWidget);",
      "",
      "function createWidget(req, res) {",
      "  return res.status(500).json(error);",
      "}",
      "",
      "module.exports = router;"
    ].join("\n")
  );

  const middlewareFile = makeFile(
    "api:functions/middleware/auth.js",
    [
      "function verifyAuth(req, res, next) {",
      "  return next();",
      "}",
      "",
      "module.exports = { verifyAuth };"
    ].join("\n")
  );

  test("builds meaningful audit output from static heuristics", () => {
    const analysis = heuristicAgent.buildHeuristicAnalysis(
      { run_id: "run-1" },
      { goal: "Audit auth and validation coverage", area: "shared" },
      [routeFile, middlewareFile],
      "audit",
      { reason: "model unavailable" }
    );

    expect(analysis.summary).toMatch(/heuristic/i);
    expect(analysis.endpoint_inventory.length).toBeGreaterThanOrEqual(2);
    expect(analysis.findings.some((finding) => finding.category === "auth")).toBe(true);
    expect(analysis.findings.some((finding) => finding.category === "contract")).toBe(true);
    expect(analysis.findings.some((finding) => finding.category === "error-handling")).toBe(true);

    const quality = heuristicAgent.assessAnalysisQuality(analysis, [routeFile, middlewareFile], "audit");
    expect(quality.ok).toBe(true);
  });

  test("builds scout opportunities with concrete file references", () => {
    const analysis = heuristicAgent.buildHeuristicAnalysis(
      { run_id: "run-2" },
      { goal: "Scout for reliability and developer experience opportunities", area: "shared" },
      [routeFile, middlewareFile],
      "scout",
      { reason: "model output was low-signal" }
    );

    expect(Array.isArray(analysis.opportunities)).toBe(true);
    expect(analysis.opportunities.length).toBeGreaterThan(0);
    expect(analysis.opportunities[0].file_paths.length).toBeGreaterThan(0);
  });

  test("builds meaningful edit output without drifting into low-signal text", () => {
    const analysis = heuristicAgent.buildHeuristicAnalysis(
      { run_id: "run-3" },
      { goal: "Prepare a safe edit plan for auth and error handling cleanup", area: "shared" },
      [routeFile, middlewareFile],
      "edit",
      { reason: "model unavailable" }
    );

    expect(analysis.summary).toMatch(/Edit analysis/i);
    expect(analysis.findings.length).toBeGreaterThan(0);

    const quality = heuristicAgent.assessAnalysisQuality(analysis, [routeFile, middlewareFile], "edit");
    expect(quality.ok).toBe(true);
  });

  test("rejects low-signal analyses", () => {
    const quality = heuristicAgent.assessAnalysisQuality(
      {
        summary: "Looks good.",
        findings: [
          {
            title: "Issue",
            detail: "Maybe something is wrong.",
            file_paths: [],
            line_refs: []
          }
        ],
        insights: ["None"],
        endpoint_inventory: []
      },
      [routeFile],
      "audit"
    );

    expect(quality.ok).toBe(false);
    expect(quality.reasons.length).toBeGreaterThan(0);
  });

  test("rejects flimsy edit output even when safe_edits are present", () => {
    const quality = heuristicAgent.assessAnalysisQuality(
      {
        summary: "This looks fine overall and can probably be improved a little bit.",
        findings: [],
        followups: ["Review the route manually."],
        safe_edits: [
          {
            path: routeFile.path,
            kind: "patch",
            summary: "Fix it",
            search: "req",
            replace: "res"
          }
        ]
      },
      [routeFile],
      "edit"
    );

    expect(quality.ok).toBe(false);
    expect(quality.reasons).toContain("safe edits are present but low-signal or structurally weak");
  });
});
