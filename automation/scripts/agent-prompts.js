/**
 * agent-prompts.js — Prompt building for API agent inventory and analysis.
 *
 * Adapted for kaayko-api: prompts reference Express routes, Firebase Cloud Functions,
 * middleware chains, Firestore patterns, and Node.js backend patterns.
 */

/**
 * Build the inventory selection prompt sent to the model.
 */
function buildAgentInventoryPrompt(manifest, args, inventory, coachingBundle, goalMode, helpers) {
  const { buildAgentCoachingPromptSection } = helpers;
  const inventoryLines = inventory
    .map((item) => `- ${item.path} | ${item.line_count} lines | ${item.size_bytes} bytes | score ${item.score}`)
    .join("\n");

  const maxFilesRange = goalMode === "audit" ? "10 and 18" : goalMode === "scout" ? "8 and 12" : "4 and 8";
  const selectionGuidance = goalMode === "audit"
    ? [
        "- Select between " + maxFilesRange + " files.",
        "- INCLUDE middleware files — they are essential for auth and security audits.",
        "- INCLUDE service files — they contain shared business logic and tenant isolation.",
        "- INCLUDE route files — they define endpoint contracts and request handling.",
        "- Include the entry point (index.js) for route mounting context.",
        "- Include scheduled functions if the goal mentions cron, forecast, or cache warming.",
        "- Prefer broad coverage over narrow depth since this is an audit.",
        "- Use exact `repo:path` strings from the inventory."
      ]
    : goalMode === "scout"
      ? [
          "- Select between " + maxFilesRange + " files.",
          "- Prefer files that expose future leverage: busy route files, shared middleware, services, tests, and config.",
          "- Include enough breadth to spot reliability, security, and DX opportunities across the track.",
          "- Include at least one route file, one middleware or service file, and one supporting file when available.",
          "- Bias toward modules where a concrete opportunity can be named with exact files and functions.",
          "- Use exact `repo:path` strings from the inventory."
        ]
    : [
        "- Select between " + maxFilesRange + " files.",
        "- Prefer source files over test files or generated files.",
        "- Prefer files where a small, behavior-preserving cleanup is plausible.",
        "- Bias toward files that sit on critical API paths documented in the coaching section.",
        "- Use exact `repo:path` strings from the inventory."
      ];

  return [
    "You are selecting files for a local coding agent run on a Node.js Firebase Cloud Functions API.",
    `Run ID: ${manifest.run_id}`,
    `Track: ${manifest.track}`,
    `Area: ${args.area}`,
    `Goal: ${args.goal}`,
    `Mode: ${goalMode}`,
    "",
    buildAgentCoachingPromptSection(coachingBundle),
    "",
    goalMode === "audit"
      ? "Choose the files most relevant to thoroughly auditing this goal. Cover routes, middleware, services, and config that relate to the goal."
      : goalMode === "scout"
        ? "Choose the files most relevant to scouting concrete improvement opportunities. Cover route surfaces, middleware, services, and at least one file that speaks to testing or developer workflow."
      : "Choose the files most relevant to achieving this goal. Use the coaching context above to prioritize files on critical API paths.",
    "Return JSON only with this shape:",
    '{"selected_files":["repo:path"],"reasoning":["short reason"]}',
    "",
    "Rules:",
    ...selectionGuidance,
    "",
    "Inventory:",
    inventoryLines
  ].join("\n");
}

/**
 * Build the analysis prompt for EDIT mode (propose safe rewrites).
 */
function buildEditAnalysisPrompt(manifest, args, selectedFiles, coachingBundle, helpers) {
  const { buildAgentCoachingPromptSection } = helpers;
  const fileBlocks = buildFileBlocks(selectedFiles);

  return [
    "You are a careful local coding agent reviewing Node.js Firebase Cloud Functions API files for duplication reduction and safe improvements.",
    `Run ID: ${manifest.run_id}`,
    `Track: ${manifest.track}`,
    `Area: ${args.area}`,
    `Goal: ${args.goal}`,
    "",
    buildAgentCoachingPromptSection(coachingBundle),
    "",
    "Analyze the selected files. Propose only low-risk, behavior-preserving edits.",
    "You should surface both safe cleanup suggestions and any real API risks you see around:",
    "- Auth middleware chain integrity",
    "- Tenant isolation (smart links, billing, kreator scoping)",
    "- Firestore access patterns (correct collection paths, security rules alignment)",
    "- Route contracts (request/response shapes that the frontend depends on)",
    "- Error handling consistency (no raw stack traces leaked to clients)",
    "- Rate limiting and CORS configuration",
    "",
    "Return JSON only using this exact shape:",
    '{"summary":"...","insights":["..."],"findings":[{"severity":"low|medium|high","title":"...","detail":"...","category":"duplication|maintainability|security|auth|billing|tenant|contract|error-handling","file_paths":["repo:path"],"line_refs":[{"file":"repo:path","start_line":10,"end_line":15}]}],"followups":["..."],"safe_edits":[{"path":"repo:path","kind":"patch","summary":"...","confidence":0.0,"search":"exact lines to find","replace":"exact replacement text"}]}',
    "",
    "Rules:",
    "- `safe_edits` uses search/replace patches, NOT full file rewrites.",
    "- `search` must be an EXACT substring copied verbatim from the file content above (including all whitespace, indentation, and newlines). Copy-paste it character-for-character.",
    "- `replace` is the exact text to substitute in place of `search`.",
    "- Each patch should be a focused, minimal change — prefer 3-15 lines of context in `search`.",
    "- `safe_edits` may contain at most 4 entries.",
    "- Only patch files from the provided file list.",
    "- Keep changes localized and behavior-preserving.",
    "- CRITICAL: `replace` must ONLY use functions, variables, and modules already defined or imported in the file. NEVER call functions that don't exist. NEVER extract helpers that aren't already defined. If you want to consolidate duplicated code, either (a) inline the improvement directly at each call site, or (b) propose the helper function definition as a SEPARATE patch first, then reference it.",
    "- Set `confidence` between 0.0 and 1.0 — the verification layer decides whether to apply.",
    "- `findings` should include `line_refs` with start/end line numbers when you can identify them.",
    "- NEVER remove or weaken auth middleware, rate limiting, or tenant isolation checks.",
    "- NEVER change Stripe webhook handler logic, payment intent creation, or billing routes.",
    "- Preserve Express route contracts — do not change response shapes clients depend on.",
    "- Preserve middleware execution order — reordering can silently bypass security.",
    "- When you call out a risk, attach the most relevant `file_paths` from the provided file list.",
    "",
    fileBlocks
  ].join("\n");
}

/**
 * Build the analysis prompt for AUDIT mode (read-only deep analysis).
 */
function buildAuditAnalysisPrompt(manifest, args, selectedFiles, coachingBundle, helpers) {
  const { buildAgentCoachingPromptSection } = helpers;
  const fileBlocks = buildFileBlocks(selectedFiles);

  return [
    "You are a thorough API code auditor performing a deep analysis of Node.js Firebase Cloud Functions files.",
    `Run ID: ${manifest.run_id}`,
    `Track: ${manifest.track}`,
    `Area: ${args.area}`,
    `Goal: ${args.goal}`,
    "",
    buildAgentCoachingPromptSection(coachingBundle),
    "",
    "Perform a comprehensive audit of ALL provided files. This is a READ-ONLY analysis — do NOT propose edits.",
    "Your job is to enumerate, categorize, and assess — not to rewrite code.",
    "",
    "For each file, analyze:",
    "1. What endpoints/routes does it define? What middleware chain protects them?",
    "2. Auth patterns: Firebase token verification, admin claim checks, tenant scoping.",
    "3. Error handling: does it leak stack traces? Are error shapes consistent?",
    "4. Firestore access: correct collection paths, proper scoping, no cross-tenant leaks.",
    "5. Duplicated patterns: repeated validation logic, similar error handlers, copy-paste routes.",
    "6. Security: rate limiting, input validation, CORS, header security.",
    "7. Dependencies between files: what imports what, shared state, initialization order.",
    "",
    "Return JSON only using this exact shape:",
    JSON.stringify({
      summary: "2-3 paragraph executive summary of audit findings",
      endpoint_inventory: [
        { method: "GET|POST|PUT|DELETE", path: "/api/...", file: "repo:path", auth: "none|bearer|admin|kreator", middleware: ["list"], description: "what it does" }
      ],
      auth_audit: [
        { file: "repo:path", pattern: "description of auth pattern used", gaps: ["any auth gaps found"], risk_level: "high|medium|low" }
      ],
      duplicated_patterns: [
        { pattern: "description of repeated pattern", files: ["repo:path"], severity: "high|medium|low", recommendation: "how to consolidate" }
      ],
      findings: [
        { severity: "low|medium|high", title: "...", detail: "Detailed explanation with specific function names or line patterns", category: "security|auth|tenant|contract|error-handling|duplication|maintainability|architecture", file_paths: ["repo:path"] }
      ],
      dependency_map: [
        { file: "repo:path", imports: ["repo:path"], exports: ["functionName"], used_by: ["repo:path"] }
      ],
      insights: ["..."],
      followups: ["..."]
    }, null, 2),
    "",
    "Rules:",
    "- Do NOT include a `safe_edits` field. This is audit-only.",
    "- Be SPECIFIC: name exact functions, middleware names, route paths. Vague findings are useless.",
    "- Every finding must reference at least one file from the provided list.",
    "- If a file is truncated, note what you can see and flag that the full file may contain more.",
    "- For auth_audit: check EVERY route handler for proper auth middleware. Flag unprotected mutations.",
    "- For endpoint_inventory: list EVERY endpoint with its HTTP method and auth requirement.",
    "- For duplicated_patterns: compare across files, not just within one file.",
    "- Produce at least 5 findings. Shallow audits are failures.",
    "",
    fileBlocks
  ].join("\n");
}

/**
 * Build the analysis prompt for SCOUT mode (opportunity discovery).
 */
function buildScoutAnalysisPrompt(manifest, args, selectedFiles, coachingBundle, helpers) {
  const { buildAgentCoachingPromptSection } = helpers;
  const fileBlocks = buildFileBlocks(selectedFiles);

  return [
    "You are a senior backend scout reviewing Node.js Firebase Cloud Functions API files for high-leverage improvement opportunities.",
    `Run ID: ${manifest.run_id}`,
    `Track: ${manifest.track}`,
    `Area: ${args.area}`,
    `Goal: ${args.goal}`,
    "",
    buildAgentCoachingPromptSection(coachingBundle),
    "",
    "Scout for opportunities that are specific, evidence-based, and worth doing soon.",
    "Focus on opportunities that improve at least one of these:",
    "- Reliability and production safety",
    "- Security and auth correctness",
    "- API contract clarity",
    "- Developer experience and future delivery speed",
    "",
    "Return JSON only using this exact shape:",
    JSON.stringify({
      summary: "1-2 paragraph summary of the most valuable opportunities",
      opportunities: [
        {
          title: "specific opportunity",
          impact: "high|medium|low",
          effort: "small|medium|large",
          rationale: "specific evidence tied to the provided files",
          file_paths: ["repo:path"],
          proposed_changes: ["concrete next step"]
        }
      ],
      endpoint_inventory: [
        { method: "GET|POST|PUT|DELETE", path: "/api/...", file: "repo:path", auth: "none|bearer|admin|kreator", middleware: ["list"], description: "what it does" }
      ],
      auth_audit: [
        { file: "repo:path", pattern: "description of auth pattern used", gaps: ["auth or validation gaps"], risk_level: "high|medium|low" }
      ],
      duplicated_patterns: [
        { pattern: "description", files: ["repo:path"], severity: "high|medium|low", recommendation: "what to centralize" }
      ],
      findings: [
        { severity: "low|medium|high", title: "...", detail: "Detailed evidence with exact routes, functions, or middleware", category: "security|auth|reliability|contract|duplication|maintainability|developer-experience", file_paths: ["repo:path"] }
      ],
      dependency_map: [
        { file: "repo:path", imports: ["repo:path"], exports: ["functionName"], used_by: ["repo:path"] }
      ],
      insights: ["..."],
      followups: ["..."]
    }, null, 2),
    "",
    "Rules:",
    "- Every opportunity must cite the exact file paths from the provided set.",
    "- Every opportunity must explain why it matters now, not in theory.",
    "- Prefer 2-4 strong opportunities over a long weak list.",
    "- `findings` must be evidence-based and specific. Vague advice is useless.",
    "- Do not invent files, routes, or middleware names that are not present in the provided content.",
    "- If a file is truncated, call that out and keep the conclusion appropriately scoped.",
    "",
    fileBlocks
  ].join("\n");
}

/**
 * Build the right analysis prompt based on goal mode.
 */
function buildAgentAnalysisPrompt(manifest, args, selectedFiles, coachingBundle, goalMode, helpers) {
  if (goalMode === "audit") {
    return buildAuditAnalysisPrompt(manifest, args, selectedFiles, coachingBundle, helpers);
  }
  if (goalMode === "scout") {
    return buildScoutAnalysisPrompt(manifest, args, selectedFiles, coachingBundle, helpers);
  }
  return buildEditAnalysisPrompt(manifest, args, selectedFiles, coachingBundle, helpers);
}

/**
 * Format selected files into content blocks for the prompt.
 */
function buildFileBlocks(selectedFiles) {
  return selectedFiles
    .map((file) => {
      return [
        `FILE: ${file.path}`,
        `LINES: ${file.line_count}`,
        `CHARS: ${file.char_count}`,
        `TRUNCATED: ${file.truncated ? `yes (showing ${file.content.length} of ${file.char_count} chars)` : "no"}`,
        "--- BEGIN CONTENT ---",
        file.content,
        "--- END CONTENT ---"
      ].join("\n");
    })
    .join("\n\n");
}

function formatLineRefs(lineRefs) {
  return (lineRefs || [])
    .map((ref) => {
      const start = Number(ref.start_line || 0);
      const end = Number(ref.end_line || start);
      if (!ref.file || !start) return "";
      return `${ref.file}:${start}${end && end !== start ? `-${end}` : ""}`;
    })
    .filter(Boolean)
    .join(", ");
}

function previewPatchText(text) {
  const firstLine = String(text || "").trim().split("\n")[0] || "";
  if (!firstLine) return "";
  return firstLine.length > 110 ? `${firstLine.slice(0, 107)}...` : firstLine;
}

/**
 * Build the analysis markdown report.
 */
function buildAgentAnalysisMarkdown(manifest, args, analysis, selectedFiles, appliedEdits, rejectedEdits, goalMode, helpers) {
  const { resolveRunCoachingContext } = helpers;
  const coaching = resolveRunCoachingContext(manifest);
  const analysisSource = analysis.analysis_metadata && analysis.analysis_metadata.source === "heuristic"
    ? `Heuristic fallback${analysis.analysis_metadata.reason ? ` (${analysis.analysis_metadata.reason})` : ""}`
    : "Model response";
  const findings = analysis.findings.length
    ? analysis.findings.map((finding) => {
        const files = (finding.file_paths || []).join(", ");
        const lineRefs = formatLineRefs(finding.line_refs);
        const evidence = [];
        if (finding.category) evidence.push(`category=${finding.category}`);
        if (files) evidence.push(`files=${files}`);
        if (lineRefs) evidence.push(`lines=${lineRefs}`);
        return `- [${finding.severity}] ${finding.title}: ${finding.detail}${evidence.length ? ` Evidence: ${evidence.join(" | ")}` : ""}`;
      }).join("\n")
    : "- No model findings were recorded.";
  const insights = analysis.insights.length ? analysis.insights.map((item) => `- ${item}`).join("\n") : "- None.";
  const followups = analysis.followups.length ? analysis.followups.map((item) => `- ${item}`).join("\n") : "- None.";
  const inspected = selectedFiles.map((file) => `- ${file.path} (${file.line_count} lines${file.truncated ? ", truncated" : ""})`).join("\n");

  let editSection = "";
  if (goalMode === "edit") {
    const proposedEdits = (analysis.safe_edits || []).length
      ? (analysis.safe_edits || []).map((edit) => {
          const anchor = edit.kind === "patch" ? previewPatchText(edit.search) : previewPatchText(edit.content);
          return `- ${edit.path}: ${edit.summary || "Proposed safe edit."} [${edit.kind}, confidence ${edit.confidence || 0}]${anchor ? ` anchor="${anchor}"` : ""}`;
        }).join("\n")
      : "- No safe edit proposals were generated from the inspected evidence.";
    const edits = appliedEdits.length
      ? appliedEdits.map((edit) => `- ${edit.path}: ${edit.summary || "Applied safe rewrite."} (confidence ${edit.confidence || 0})`).join("\n")
      : "- No safe rewrites were applied.";
    const rejected = rejectedEdits.length
      ? rejectedEdits.map((edit) => `- ${edit.path}: ${edit.reason}`).join("\n")
      : "- No edit proposals were rejected.";
    editSection = `
## Proposed Safe Edits

${proposedEdits}

## Applied Safe Edits

${edits}

## Rejected Safe Edits

${rejected}
`;
  }

  let auditSection = "";
  if (goalMode === "audit" || goalMode === "scout") {
    const endpoints = (analysis.endpoint_inventory || []).length
      ? (analysis.endpoint_inventory || []).map((e) => `- **${e.method} ${e.path}** (${e.file}): ${e.description} [auth: ${e.auth}]`).join("\n")
      : "- None inventoried.";
    const authAudit = (analysis.auth_audit || []).length
      ? (analysis.auth_audit || []).map((a) => {
          const gaps = (a.gaps || []).length ? a.gaps.join("; ") : "none";
          return `- ${a.file}: ${a.pattern} [risk: ${a.risk_level}] gaps=[${gaps}]`;
        }).join("\n")
      : "- Not analyzed.";
    const duplicated = (analysis.duplicated_patterns || []).length
      ? (analysis.duplicated_patterns || []).map((d) => `- ${d.pattern} in ${d.files.join(", ")} [${d.severity}] → ${d.recommendation}`).join("\n")
      : "- None identified.";
    const deps = (analysis.dependency_map || []).length
      ? (analysis.dependency_map || []).map((d) => `- ${d.file}: imports=[${(d.imports || []).join(", ")}] exports=[${(d.exports || []).join(", ")}]`).join("\n")
      : "- Not mapped.";
    auditSection = `
## Endpoint Inventory

${endpoints}

## Auth Audit

${authAudit}

## Duplicated Patterns

${duplicated}

## Dependency Map

${deps}
`;
  }

  let scoutSection = "";
  if (goalMode === "scout") {
    const opportunities = (analysis.opportunities || []).length
      ? (analysis.opportunities || []).map((opportunity) => {
          const files = (opportunity.file_paths || []).join(", ") || "None";
          const changes = (opportunity.proposed_changes || []).join("; ") || "No concrete next step recorded.";
          return `- **${opportunity.title}** [impact: ${opportunity.impact}, effort: ${opportunity.effort}] files=[${files}] ${opportunity.rationale} Next: ${changes}`;
        }).join("\n")
      : "- No scout opportunities were recorded.";
    scoutSection = `
## Scout Opportunities

${opportunities}
`;
  }

  return `# Agent Analysis

- Run ID: \`${manifest.run_id}\`
- Track: \`${manifest.track}\`
- Area: \`${args.area}\`
- Goal: ${args.goal}
- Mode: ${goalMode}
- Analysis source: ${analysisSource}
- Guided products: ${coaching.guided_products.length ? coaching.guided_products.join(", ") : "None"}
- Primary focus: ${coaching.focused_products.length ? coaching.focused_products.join(", ") : "None"}

## Summary

${analysis.summary || "No summary returned by the local model."}

## Inspected Files

${inspected}

## Findings

${findings}
${auditSection}${scoutSection}${editSection}
## Insights

${insights}

## Follow-ups

${followups}
`;
}

module.exports = {
  buildAgentInventoryPrompt,
  buildAgentAnalysisPrompt,
  buildEditAnalysisPrompt,
  buildAuditAnalysisPrompt,
  buildScoutAnalysisPrompt,
  buildAgentAnalysisMarkdown,
  buildFileBlocks
};
