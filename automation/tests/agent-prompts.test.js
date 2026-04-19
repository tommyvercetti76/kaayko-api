"use strict";

const agentPrompts = require("../scripts/agent-prompts");

describe("buildAgentAnalysisMarkdown", () => {
  test("renders evidence-rich edit reports with proposed safe edits and fallback source", () => {
    const markdown = agentPrompts.buildAgentAnalysisMarkdown(
      { run_id: "run-42", track: "kortex" },
      { area: "shared", goal: "Tighten auth handling" },
      {
        summary: "Edit analysis found one concrete auth gap and a small safe cleanup path.",
        insights: ["The selected route surface is small enough for exact-file cleanup."],
        findings: [
          {
            severity: "high",
            title: "Write route lacks obvious auth guard",
            detail: "POST /widgets appears to mutate state without a visible auth middleware in the inspected file.",
            category: "auth",
            file_paths: ["api:functions/api/widgets/routes.js"],
            line_refs: [{ file: "api:functions/api/widgets/routes.js", start_line: 4, end_line: 4 }]
          }
        ],
        followups: ["Trace the parent router mount before applying any auth-sensitive patch."],
        safe_edits: [
          {
            path: "api:functions/api/widgets/routes.js",
            kind: "patch",
            summary: "Tighten duplicated error response text in one handler.",
            confidence: 0.82,
            search: "return res.status(500).json(error);",
            replace: "return res.status(500).json({ error: \"Internal server error\" });"
          }
        ],
        analysis_metadata: {
          source: "heuristic",
          reason: "CLI unavailable",
          generated_at: "2026-04-18T00:00:00.000Z",
          run_id: "run-42"
        }
      },
      [
        {
          path: "api:functions/api/widgets/routes.js",
          line_count: 20,
          truncated: false
        }
      ],
      [],
      [],
      "edit",
      {
        resolveRunCoachingContext: () => ({
          guided_products: ["kortex"],
          focused_products: ["kortex"]
        })
      }
    );

    expect(markdown).toContain("Analysis source: Heuristic fallback (CLI unavailable)");
    expect(markdown).toContain("## Proposed Safe Edits");
    expect(markdown).toContain("category=auth");
    expect(markdown).toContain("lines=api:functions/api/widgets/routes.js:4");
    expect(markdown).toContain("anchor=\"return res.status(500).json(error);\"");
  });
});
