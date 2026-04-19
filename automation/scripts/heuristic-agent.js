"use strict";

const path = require("path");

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function countLines(text, index) {
  return String(text || "").slice(0, Math.max(0, index)).split("\n").length;
}

function looksLowSignalText(text, options = {}) {
  const minChars = options.minChars || 24;
  const minWords = options.minWords || 5;
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return true;
  if (value.length < minChars) return true;

  const lower = value.toLowerCase();
  if (/^(none|n\/a|unknown|not sure|unclear|no issues(?: found)?\.?)$/.test(lower)) {
    return true;
  }

  const words = lower.match(/[a-z0-9]+/g) || [];
  if (words.length < minWords) return true;

  const uniqueRatio = words.length ? (new Set(words)).size / words.length : 0;
  if (words.length >= 8 && uniqueRatio < 0.35) return true;
  if (/([a-z0-9])\1{5,}/i.test(value)) return true;
  if (/lorem ipsum|asdf|qwer|jibber/i.test(lower)) return true;
  return false;
}

function cleanList(values, options = {}) {
  const maxItems = options.maxItems || 6;
  return uniqueStrings(
    (values || [])
      .map((value) => String(value || "").replace(/\s+/g, " ").trim())
      .filter((value) => !looksLowSignalText(value, { minChars: options.minChars || 18, minWords: options.minWords || 3 }))
  ).slice(0, maxItems);
}

function detectFileRole(filePath) {
  const lower = String(filePath || "").toLowerCase();
  if (lower.includes(".test.") || lower.includes("__tests__/")) return "test";
  if (lower.includes("/middleware/")) return "middleware";
  if (lower.includes("/services/")) return "service";
  if (lower.includes("/config/")) return "config";
  if (lower.includes("/api/")) return "route";
  return "support";
}

function classifyAuth(middleware) {
  const joined = (middleware || []).join(" ").toLowerCase();
  if (/admin/.test(joined)) return "admin";
  if (/kreator|creator/.test(joined)) return "kreator";
  if (/auth|verify|token|guard|protect|tenant|session|require/.test(joined)) return "bearer";
  return "none";
}

function hasValidationSignals(text) {
  return /express-validator|joi|zod|yup|validate[A-Z_(]|schema|sanitize|check\(/i.test(String(text || ""));
}

function hasSecuritySignals(text) {
  return /helmet|cors|rate.?limit|csrf|x-frame-options|content-security-policy/i.test(String(text || ""));
}

function findLineForPattern(text, pattern) {
  const match = pattern.exec(String(text || ""));
  pattern.lastIndex = 0;
  return match ? countLines(text, match.index) : null;
}

function extractRouteDefinitions(file) {
  const content = file.full_content || file.content || "";
  const routeSource = content
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  const routes = [];
  const routePattern = /\b(?:router|app)\.(get|post|put|patch|delete|all)\s*\(\s*["'`]([^"'`]+)["'`]\s*,([\s\S]{0,260}?)\)\s*;/gi;

  for (const match of routeSource.matchAll(routePattern)) {
    const middlewareSegment = String(match[3] || "").split(/async\s*\(\s*req\b|function\s*\(\s*req\b|\(\s*req\b|=>|\{/i)[0];
    const middlewareTokens = uniqueStrings(
      middlewareSegment
        .match(/\b[a-zA-Z_$][\w$]*\b/g) || []
    ).filter((token) => !["async", "function", "req", "res", "next", "return"].includes(token));

    routes.push({
      method: String(match[1] || "").toUpperCase(),
      path: String(match[2] || "").trim(),
      middleware: middlewareTokens,
      auth: classifyAuth(middlewareTokens),
      line: countLines(routeSource, match.index)
    });
  }

  return routes;
}

function resolveRelativeImport(rawImport, file, selectedPathByRelative) {
  if (!rawImport || !rawImport.startsWith(".")) return null;

  const relativePath = file.relative_path || String(file.path || "").split(":").slice(1).join(":");
  if (!relativePath) return null;

  const baseDir = path.posix.dirname(relativePath.replace(/\\/g, "/"));
  const targetBase = path.posix.normalize(path.posix.join(baseDir, rawImport));
  const candidates = [
    targetBase,
    `${targetBase}.js`,
    `${targetBase}.ts`,
    `${targetBase}.json`,
    path.posix.join(targetBase, "index.js"),
    path.posix.join(targetBase, "index.ts")
  ];

  for (const candidate of candidates) {
    if (selectedPathByRelative.has(candidate)) {
      return selectedPathByRelative.get(candidate);
    }
  }

  return `${file.repo || "api"}:${targetBase}`;
}

function extractDependencyMap(file, selectedPathByRelative) {
  const content = file.full_content || file.content || "";
  const imports = [];
  const requirePattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  const importPattern = /from\s+["']([^"']+)["']/g;

  let match;
  while ((match = requirePattern.exec(content)) !== null) {
    const resolved = resolveRelativeImport(match[1], file, selectedPathByRelative);
    if (resolved) imports.push(resolved);
  }

  while ((match = importPattern.exec(content)) !== null) {
    const resolved = resolveRelativeImport(match[1], file, selectedPathByRelative);
    if (resolved) imports.push(resolved);
  }

  const exportMatches = [];
  const exportPattern = /(?:module\.exports\s*=\s*{([^}]+)}|exports\.([a-zA-Z_$][\w$]*)\s*=|function\s+([a-zA-Z_$][\w$]*)\s*\()/g;
  while ((match = exportPattern.exec(content)) !== null) {
    if (match[1]) {
      match[1].split(",").forEach((part) => {
        const token = String(part || "").split(":")[0].trim();
        if (/^[a-zA-Z_$][\w$]*$/.test(token)) exportMatches.push(token);
      });
    }
    if (match[2]) exportMatches.push(match[2]);
    if (match[3]) exportMatches.push(match[3]);
  }

  return {
    file: file.path,
    imports: uniqueStrings(imports),
    exports: uniqueStrings(exportMatches).slice(0, 12),
    used_by: []
  };
}

function createSelectedPathIndex(selectedFiles) {
  const map = new Map();
  (selectedFiles || []).forEach((file) => {
    const relativePath = (file.relative_path || String(file.path || "").split(":").slice(1).join(":")).replace(/\\/g, "/");
    if (relativePath) {
      map.set(relativePath, file.path);
    }
  });
  return map;
}

function analyzeSelectedFiles(selectedFiles) {
  const selectedPathByRelative = createSelectedPathIndex(selectedFiles);
  const analyses = (selectedFiles || []).map((file) => {
    const content = file.full_content || file.content || "";
    const routes = extractRouteDefinitions(file);
    let role = detectFileRole(file.path);
    if (role === "route" && routes.length === 0 && !/(router|routes)\./i.test(file.path)) {
      role = "support";
    }
    const dependency = extractDependencyMap(file, selectedPathByRelative);

    return {
      file,
      role,
      routes,
      dependency,
      usesInput: /req\.(body|query|params)\b/.test(content),
      hasValidation: hasValidationSignals(content),
      hasSecurityMiddleware: hasSecuritySignals(content),
      hasTests: /describe\(|it\(|test\(|expect\(/.test(content),
      errorLeakLine: findLineForPattern(content, /(err|error)\.stack|res\.(send|json)\s*\(\s*(err|error)\b|res\.status\(\s*500\s*\)\.(send|json)\s*\(\s*(err|error)\b/gi),
      truncated: Boolean(file.truncated),
      lineCount: Number(file.line_count || 0)
    };
  });

  const dependencyByFile = new Map(analyses.map((entry) => [entry.file.path, entry.dependency]));
  analyses.forEach((entry) => {
    entry.dependency.imports.forEach((imported) => {
      if (dependencyByFile.has(imported)) {
        dependencyByFile.get(imported).used_by.push(entry.file.path);
      }
    });
  });

  return analyses;
}

function buildDuplicatePatterns(analyses) {
  const repeatedMiddleware = new Map();

  analyses.forEach((entry) => {
    entry.routes.forEach((route) => {
      if (!route.middleware.length) return;
      const signature = route.middleware.join(" -> ");
      if (!repeatedMiddleware.has(signature)) {
        repeatedMiddleware.set(signature, { files: new Set(), endpoints: [] });
      }
      const record = repeatedMiddleware.get(signature);
      record.files.add(entry.file.path);
      record.endpoints.push(`${route.method} ${route.path}`);
    });
  });

  return Array.from(repeatedMiddleware.entries())
    .filter(([, record]) => record.files.size >= 2 || record.endpoints.length >= 3)
    .map(([pattern, record]) => ({
      pattern: `Repeated middleware chain: ${pattern}`,
      files: Array.from(record.files),
      severity: record.files.size >= 3 ? "medium" : "low",
      recommendation: `Consider extracting the shared middleware stack into a named helper or shared router composition. Seen on ${record.endpoints.slice(0, 4).join(", ")}.`
    }))
    .slice(0, 4);
}

function buildFindings(analyses, goalMode) {
  const findings = [];

  analyses.forEach((entry) => {
    entry.routes.forEach((route) => {
      const routeLabel = `${route.method} ${route.path}`;
      const lineRef = [{ file: entry.file.path, start_line: route.line, end_line: route.line }];
      const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(route.method);

      if (mutating && route.auth === "none") {
        findings.push({
          severity: "high",
          title: `Write route lacks obvious auth guard: ${routeLabel}`,
          detail: `The inspected route in ${entry.file.path} appears to mutate state but no auth-like middleware name was detected before the handler. Confirm that bearer, admin, tenant, or creator protection is applied before this write path.`,
          category: "auth",
          file_paths: [entry.file.path],
          line_refs: lineRef
        });
      }

      if (mutating && !entry.hasValidation) {
        findings.push({
          severity: "medium",
          title: `Write route lacks visible request validation: ${routeLabel}`,
          detail: `The inspected route in ${entry.file.path} appears to accept request input, but no validation middleware or schema signal was found in the file. Add explicit body/query/params validation so malformed requests fail before business logic executes.`,
          category: "contract",
          file_paths: [entry.file.path],
          line_refs: lineRef
        });
      }
    });

    if (entry.errorLeakLine) {
      findings.push({
        severity: "high",
        title: `Potential raw error leakage in ${entry.file.path}`,
        detail: `A direct error object, status 500 error payload, or stack trace pattern was detected in ${entry.file.path}. Replace raw error serialization with a sanitized response shape and keep stack details in server logs only.`,
        category: "error-handling",
        file_paths: [entry.file.path],
        line_refs: [{ file: entry.file.path, start_line: entry.errorLeakLine, end_line: entry.errorLeakLine }]
      });
    }

    if (entry.role === "route" && entry.lineCount >= 350 && entry.routes.length >= 4) {
      findings.push({
        severity: goalMode === "scout" ? "medium" : "low",
        title: `Large route module is carrying multiple concerns: ${entry.file.path}`,
        detail: `${entry.file.path} is ${entry.lineCount} lines long and exposes ${entry.routes.length} detected routes. Splitting route handlers, validation, and shared service calls into smaller modules would make future audits and fixes more reliable.`,
        category: "maintainability",
        file_paths: [entry.file.path],
        line_refs: [{ file: entry.file.path, start_line: 1, end_line: Math.min(entry.lineCount, 12) }]
      });
    }
  });

  const routeFiles = analyses.filter((entry) => entry.role === "route");
  const testFiles = analyses.filter((entry) => entry.role === "test");
  if (routeFiles.length && !testFiles.length) {
    findings.push({
      severity: goalMode === "scout" ? "medium" : "low",
      title: "Inspected route surface has no adjacent automated tests",
      detail: `The selected file set includes ${routeFiles.length} route modules but no test files. Add at least one smoke or contract test around the highest-risk endpoints so auth and validation regressions are caught early.`,
      category: "maintainability",
      file_paths: routeFiles.slice(0, 3).map((entry) => entry.file.path),
      line_refs: []
    });
  }

  const deduped = [];
  const seen = new Set();
  findings.forEach((finding) => {
    const key = `${finding.title}|${finding.file_paths.join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(finding);
  });

  return deduped.slice(0, goalMode === "audit" ? 8 : 6);
}

function buildEndpointInventory(analyses) {
  return analyses
    .flatMap((entry) => entry.routes.map((route) => ({
      method: route.method,
      path: route.path,
      file: entry.file.path,
      auth: route.auth,
      middleware: route.middleware,
      description: route.middleware.length
        ? `Route uses middleware: ${route.middleware.join(", ")}`
        : "Route handler detected without named middleware in the inspected slice."
    })))
    .slice(0, 30);
}

function buildAuthAudit(analyses) {
  return analyses
    .filter((entry) => entry.routes.length)
    .map((entry) => {
      const authKinds = uniqueStrings(entry.routes.map((route) => route.auth));
      const gaps = [];
      const unprotectedWrites = entry.routes.filter((route) => ["POST", "PUT", "PATCH", "DELETE"].includes(route.method) && route.auth === "none");
      if (unprotectedWrites.length) {
        gaps.push(`Unprotected write routes detected: ${unprotectedWrites.map((route) => `${route.method} ${route.path}`).join(", ")}`);
      }
      if (!entry.hasValidation && entry.routes.some((route) => ["POST", "PUT", "PATCH", "DELETE"].includes(route.method))) {
        gaps.push("No validation middleware or schema signal was found for write routes in the inspected file.");
      }

      return {
        file: entry.file.path,
        pattern: authKinds.length
          ? `Observed auth styles: ${authKinds.join(", ")}`
          : "No named auth middleware detected on inspected routes.",
        gaps,
        risk_level: unprotectedWrites.length ? "high" : (gaps.length ? "medium" : "low")
      };
    });
}

function buildInsights(analyses, findings, duplicatePatterns, goalMode) {
  const routeCount = analyses.reduce((sum, entry) => sum + entry.routes.length, 0);
  const routeFiles = analyses.filter((entry) => entry.role === "route").length;
  const unprotectedWrites = findings.filter((finding) => finding.category === "auth").length;
  const validationGaps = findings.filter((finding) => finding.category === "contract").length;
  const largeFiles = findings.filter((finding) => /Large route module/.test(finding.title)).length;

  const insights = [
    `Inspected ${analyses.length} files and detected ${routeCount} route definitions across ${routeFiles} route modules.`,
    unprotectedWrites
      ? `${unprotectedWrites} write-path auth gaps were detected from visible middleware chains.`
      : "No obvious unprotected write routes were detected in the inspected slice.",
    validationGaps
      ? `${validationGaps} route handlers appear to accept input without a visible validation layer.`
      : "Validation signals were present in the inspected write-path modules.",
    duplicatePatterns.length
      ? `${duplicatePatterns.length} repeated middleware or composition patterns look centralizable.`
      : "No strong repeated middleware signatures were detected across the selected files.",
    largeFiles
      ? `${largeFiles} route modules are large enough to justify extraction work before the next feature pass.`
      : "The selected modules are mostly small enough to audit without immediate structural breakup."
  ];

  if (goalMode === "scout") {
    insights.push("Scout mode favors opportunities that improve reliability, security, and future delivery speed without requiring broad rewrites.");
  }

  return cleanList(insights, { maxItems: 6, minChars: 30, minWords: 5 });
}

function buildFollowups(analyses, findings) {
  const followups = [];
  if (analyses.some((entry) => entry.truncated)) {
    followups.push("Re-run the audit on the truncated files directly so the full handler and middleware chain can be reviewed without clipping.");
  }
  if (findings.some((finding) => finding.category === "auth")) {
    followups.push("Trace each flagged write route back to its mount point in functions/index.js or the parent router to confirm auth enforcement in the live chain.");
  }
  if (findings.some((finding) => finding.category === "contract")) {
    followups.push("Add explicit schema validation for request body, params, and query on the write routes flagged above.");
  }
  if (findings.some((finding) => finding.category === "maintainability")) {
    followups.push("Add one smoke or contract test around the busiest route module before refactoring shared logic.");
  }
  return cleanList(followups, { maxItems: 5, minChars: 28, minWords: 4 });
}

function buildScoutOpportunities(analyses, duplicatePatterns, findings) {
  const opportunities = [];
  const largestRouteFile = analyses
    .filter((entry) => entry.role === "route" && entry.routes.length >= 3)
    .sort((left, right) => right.lineCount - left.lineCount)[0];

  if (largestRouteFile && largestRouteFile.lineCount >= 320) {
    opportunities.push({
      title: `Split ${largestRouteFile.file.path} into smaller route modules`,
      impact: "high",
      effort: "medium",
      rationale: `${largestRouteFile.file.path} is ${largestRouteFile.lineCount} lines and contains ${largestRouteFile.routes.length} detected routes. Breaking out validation, handlers, and shared service calls would reduce audit noise and make fixes safer.`,
      file_paths: [largestRouteFile.file.path],
      proposed_changes: [
        "Extract route-local validation and shared error helpers into adjacent modules.",
        "Keep route registration thin and push business logic into services."
      ]
    });
  }

  if (duplicatePatterns.length) {
    const pattern = duplicatePatterns[0];
    opportunities.push({
      title: "Centralize repeated middleware composition",
      impact: "medium",
      effort: "small",
      rationale: `${pattern.pattern} appears across ${pattern.files.length} files. A shared middleware composer would reduce copy-paste drift and keep auth/validation chains consistent.`,
      file_paths: pattern.files,
      proposed_changes: [
        "Create a named shared middleware array or helper.",
        "Replace duplicated route-local stacks with the shared composition."
      ]
    });
  }

  const validationFinding = findings.find((finding) => finding.category === "contract");
  if (validationFinding) {
    opportunities.push({
      title: "Add shared request validation for write endpoints",
      impact: "high",
      effort: "small",
      rationale: validationFinding.detail,
      file_paths: validationFinding.file_paths,
      proposed_changes: [
        "Define reusable schema or validator middleware for the affected write routes.",
        "Fail malformed payloads before service logic or Firestore writes."
      ]
    });
  }

  const routeFiles = analyses.filter((entry) => entry.role === "route");
  const hasTests = analyses.some((entry) => entry.role === "test");
  if (routeFiles.length && !hasTests) {
    opportunities.push({
      title: "Add a smoke-test harness for critical API routes",
      impact: "medium",
      effort: "medium",
      rationale: `The inspected slice includes ${routeFiles.length} route files but no test files. Minimal auth and contract smoke tests would make future automated fixes safer.`,
      file_paths: routeFiles.slice(0, 3).map((entry) => entry.file.path),
      proposed_changes: [
        "Cover one read path and one write path per high-risk module.",
        "Assert auth failures, validation failures, and happy-path response shape."
      ]
    });
  }

  return opportunities.slice(0, 3);
}

function buildSummary(args, analyses, findings, duplicatePatterns, goalMode, reason) {
  const routeCount = analyses.reduce((sum, entry) => sum + entry.routes.length, 0);
  const topFindings = findings.slice(0, 3).map((finding) => finding.title.toLowerCase());
  const routeFiles = analyses.filter((entry) => entry.role === "route").length;
  const supportClause = reason ? ` The model path was unavailable or low-signal, so this report was generated from deterministic code heuristics instead.` : "";

  if (goalMode === "scout") {
    return `Scout analysis for "${args.goal}" inspected ${analyses.length} files, including ${routeFiles} route modules and ${routeCount} detected endpoints.${supportClause} The most actionable themes were ${topFindings.length ? topFindings.join("; ") : "modularization, validation, and test coverage opportunities"}, with emphasis on changes that improve reliability and future delivery speed without broad rewrites.`;
  }

  if (goalMode === "edit") {
    return `Edit analysis for "${args.goal}" inspected ${analyses.length} files and found ${findings.length} concrete issues worth fixing before any automated patch is attempted.${supportClause} The strongest evidence points to ${topFindings.length ? topFindings.join("; ") : "auth coverage, validation depth, and error handling consistency"}, so the automation should prioritize exact-file fixes instead of speculative rewrites.`;
  }

  return `Audit analysis for "${args.goal}" inspected ${analyses.length} files across routes, middleware, and shared services, and identified ${findings.length} concrete findings across ${routeCount} detected endpoints.${supportClause} The most important concerns were ${topFindings.length ? topFindings.join("; ") : "auth coverage, request validation, and route maintainability"}, with duplicated middleware patterns called out where the inspected slice supports that conclusion.`;
}

function buildHeuristicInventoryResponse(inventory, goalMode) {
  const limit = goalMode === "audit" ? 14 : goalMode === "scout" ? 12 : 6;
  const selected = [];
  const seen = new Set();
  const addIfPresent = (predicate, maxCount = 1) => {
    inventory.filter(predicate).slice(0, maxCount).forEach((item) => {
      if (seen.has(item.path) || selected.length >= limit) return;
      seen.add(item.path);
      selected.push(item.path);
    });
  };

  addIfPresent((item) => /functions\/index\.js$/i.test(item.path), 1);
  addIfPresent((item) => item.path.toLowerCase().includes("/middleware/"), goalMode === "edit" ? 1 : 2);
  addIfPresent((item) => item.path.toLowerCase().includes("/api/"), goalMode === "edit" ? 3 : 5);
  addIfPresent((item) => item.path.toLowerCase().includes("/services/"), goalMode === "edit" ? 1 : 2);
  addIfPresent((item) => item.path.toLowerCase().includes(".test.") || item.path.toLowerCase().includes("__tests__/"), 1);

  inventory.forEach((item) => {
    if (selected.length >= limit || seen.has(item.path)) return;
    seen.add(item.path);
    selected.push(item.path);
  });

  return {
    selected_files: selected,
    reasoning: [
      `Heuristic fallback selected ${selected.length} files by prioritizing route surfaces, middleware, and shared services relevant to ${goalMode} mode.`,
      "The selection favors broad API coverage and concrete evidence over narrow speculative context."
    ]
  };
}

function buildHeuristicAnalysis(manifest, args, selectedFiles, goalMode, options = {}) {
  const analyses = analyzeSelectedFiles(selectedFiles);
  const duplicatePatterns = buildDuplicatePatterns(analyses);
  const findings = buildFindings(analyses, goalMode);
  const endpointInventory = buildEndpointInventory(analyses);
  const authAudit = buildAuthAudit(analyses);
  const dependencyMap = analyses.map((entry) => entry.dependency);
  const insights = buildInsights(analyses, findings, duplicatePatterns, goalMode);
  const followups = buildFollowups(analyses, findings);
  const opportunities = goalMode === "scout" ? buildScoutOpportunities(analyses, duplicatePatterns, findings) : [];

  return {
    summary: buildSummary(args, analyses, findings, duplicatePatterns, goalMode, options.reason),
    insights,
    findings,
    followups,
    endpoint_inventory: endpointInventory,
    auth_audit: authAudit,
    duplicated_patterns: duplicatePatterns,
    dependency_map: dependencyMap,
    opportunities,
    safe_edits: [],
    heuristic_metadata: {
      generated_at: new Date().toISOString(),
      reason: options.reason || "heuristic fallback requested",
      run_id: manifest.run_id
    }
  };
}

function assessAnalysisQuality(analysis, selectedFiles, goalMode) {
  const reasons = [];
  const findings = Array.isArray(analysis.findings) ? analysis.findings : [];
  const selectedPaths = new Set((selectedFiles || []).map((file) => file.path));
  const meaningfulFindings = findings.filter((finding) => {
    const hasEvidence = (finding.file_paths && finding.file_paths.length) || (finding.line_refs && finding.line_refs.length);
    return hasEvidence &&
      !looksLowSignalText(finding.title, { minChars: 18, minWords: 3 }) &&
      !looksLowSignalText(finding.detail, { minChars: 60, minWords: 10 });
  });
  const meaningfulSafeEdits = Array.isArray(analysis.safe_edits)
    ? analysis.safe_edits.filter((edit) => {
        if (!edit || typeof edit !== "object") return false;
        const editPath = String(edit.path || "").trim();
        if (!editPath || (selectedPaths.size && !selectedPaths.has(editPath))) return false;
        if (looksLowSignalText(edit.summary, { minChars: 18, minWords: 3 })) return false;

        if (String(edit.kind || "patch").trim() === "patch") {
          const search = String(edit.search || "");
          const replace = String(edit.replace || "");
          return search.trim().length >= 12 && replace.trim().length >= 12 && search !== replace;
        }

        const content = String(edit.content || "");
        return content.trim().length >= 40;
      })
    : [];

  if (looksLowSignalText(analysis.summary, { minChars: 70, minWords: 10 })) {
    reasons.push("summary is missing, too short, or low-signal");
  }

  const minFindings = goalMode === "audit" ? 3 : goalMode === "scout" ? 2 : 1;
  if (meaningfulFindings.length < minFindings && !(goalMode === "edit" && meaningfulSafeEdits.length)) {
    reasons.push(`expected at least ${minFindings} meaningful findings for ${goalMode} mode`);
  }

  if (goalMode !== "edit" && cleanList(analysis.insights, { maxItems: 10 }).length === 0) {
    reasons.push("insights are missing or low-signal");
  }

  if (goalMode === "edit" && Array.isArray(analysis.safe_edits) && analysis.safe_edits.length && meaningfulSafeEdits.length === 0) {
    reasons.push("safe edits are present but low-signal or structurally weak");
  }

  if (goalMode === "audit" && (!Array.isArray(analysis.endpoint_inventory) || analysis.endpoint_inventory.length === 0)) {
    reasons.push("endpoint inventory is empty");
  }

  if (goalMode === "scout" && (!Array.isArray(analysis.opportunities) || analysis.opportunities.length === 0) && meaningfulFindings.length < 2) {
    reasons.push("scout opportunities are missing");
  }

  if (selectedFiles.length && findings.some((finding) => (finding.file_paths || []).every((filePath) => !selectedFiles.some((file) => file.path === filePath)))) {
    reasons.push("findings reference files outside the inspected set");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    meaningful_findings: meaningfulFindings.length,
    meaningful_safe_edits: meaningfulSafeEdits.length
  };
}

module.exports = {
  buildHeuristicInventoryResponse,
  buildHeuristicAnalysis,
  assessAnalysisQuality,
  looksLowSignalText
};
