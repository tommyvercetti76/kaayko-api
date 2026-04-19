/**
 * agent-verify.js — Verification loop for API agent edits.
 *
 * Adapted for kaayko-api:
 * - Syntax check: node --check for .js files
 * - Lint/test: runs npm run test:smoke in functions/ directory
 * - Validates module.exports and Express route patterns
 * - Auto-rollback on syntax failure
 * - Generates verification report for user review
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

/**
 * Apply safe edits from the model, with full preflight + postflight validation.
 */
function applyAndVerifyEdits(config, runDir, selectedFiles, safeEdits, backupsDir, options = {}) {
  const { resolvePrefixedPath, slugify, REPO_ROOT } = options.helpers || {};
  const selectedMap = new Map(selectedFiles.map((file) => [file.path, file]));
  const applied = [];
  const rejected = [];

  safeEdits.forEach((edit) => {
    const selectedFile = selectedMap.get(edit.path);

    if (!selectedFile) {
      rejected.push({ path: edit.path, reason: "File was not part of the selected context." });
      return;
    }

    if (![".js", ".mjs", ".cjs", ".ts"].includes(path.extname(selectedFile.absolute_path).toLowerCase())) {
      rejected.push({ path: edit.path, reason: "File type is not allowed for safe edits." });
      return;
    }

    const originalContent = fs.readFileSync(selectedFile.absolute_path, "utf8");

    // Route to patch or rewrite handler
    if (edit.kind === "patch") {
      const patchResult = applyPatchEdit(edit, selectedFile, originalContent, backupsDir, slugify, REPO_ROOT);
      if (patchResult.ok) {
        applied.push(patchResult.entry);
      } else {
        rejected.push({ path: edit.path, reason: patchResult.reason });
      }
      return;
    }

    // Legacy full-file rewrite path
    const normalizedContent = edit.content.endsWith("\n") ? edit.content : `${edit.content}\n`;

    if (normalizedContent === originalContent) {
      rejected.push({ path: edit.path, reason: "Suggested rewrite was identical to the current file." });
      return;
    }

    if (normalizedContent.length > originalContent.length * 2 + 4000) {
      rejected.push({ path: edit.path, reason: "Suggested rewrite changed file size too aggressively." });
      return;
    }

    const preflightIssue = validateRewriteCandidate(selectedFile.absolute_path, originalContent, normalizedContent);

    if (preflightIssue) {
      rejected.push({ path: edit.path, reason: preflightIssue });
      return;
    }

    const backupName = (slugify ? slugify(edit.path.replace(":", "-")) : edit.path.replace(/[^a-z0-9]/gi, "-")) || "backup";
    const backupPath = path.join(backupsDir, `${backupName}.bak`);

    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, originalContent);
    fs.writeFileSync(selectedFile.absolute_path, normalizedContent);

    // Post-apply syntax check
    const syntaxIssue = validateAppliedEdit(edit.path, selectedFile.absolute_path, REPO_ROOT);

    if (syntaxIssue) {
      fs.writeFileSync(selectedFile.absolute_path, originalContent);
      rejected.push({ path: edit.path, reason: syntaxIssue });
      return;
    }

    applied.push({
      path: edit.path,
      absolute_path: selectedFile.absolute_path,
      summary: edit.summary,
      confidence: edit.confidence,
      backup_path: backupPath
    });
  });

  const verification = runVerificationSuite(config, runDir, applied, options);

  return { applied, rejected, verification };
}

/**
 * Apply a search/replace patch edit to a file.
 * Returns { ok: true, entry } on success or { ok: false, reason } on failure.
 */
function applyPatchEdit(edit, selectedFile, originalContent, backupsDir, slugify, REPO_ROOT) {
  const search = edit.search;
  const replace = edit.replace;

  if (!search || typeof search !== "string") {
    return { ok: false, reason: "Patch has empty or invalid `search` string." };
  }

  // Count occurrences — must match exactly once
  const occurrences = countOccurrences(originalContent, search);
  if (occurrences === 0) {
    // Try with normalized whitespace as fallback
    const trimmedSearch = search.replace(/[ \t]+$/gm, "");
    const trimmedContent = originalContent.replace(/[ \t]+$/gm, "");
    const trimmedOccurrences = countOccurrences(trimmedContent, trimmedSearch);
    if (trimmedOccurrences === 0) {
      return { ok: false, reason: "Patch `search` text not found in file." };
    }
    if (trimmedOccurrences > 1) {
      return { ok: false, reason: `Patch \`search\` text matches ${trimmedOccurrences} locations (must be unique).` };
    }
    // Apply on trimmed content then restore
    const patchedContent = trimmedContent.replace(trimmedSearch, replace.replace(/[ \t]+$/gm, ""));
    return finalizePatch(edit, selectedFile, originalContent, patchedContent, backupsDir, slugify, REPO_ROOT);
  }
  if (occurrences > 1) {
    return { ok: false, reason: `Patch \`search\` text matches ${occurrences} locations (must be unique).` };
  }

  const patchedContent = originalContent.replace(search, replace);
  // Check for new function calls introduced by the patch that don't exist in the file
  const undefinedSymbol = detectUndefinedCalls(originalContent, search, replace);
  if (undefinedSymbol) {
    return { ok: false, reason: undefinedSymbol };
  }
  return finalizePatch(edit, selectedFile, originalContent, patchedContent, backupsDir, slugify, REPO_ROOT);
}

/**
 * Detect function calls in `replace` that don't appear anywhere in the original file or `search`.
 * Returns a rejection reason string, or null if OK.
 */
function detectUndefinedCalls(originalContent, search, replace) {
  // Extract all function-call identifiers from replace text
  const callPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  const replaceCalls = new Set();
  let m;
  while ((m = callPattern.exec(replace)) !== null) {
    replaceCalls.add(m[1]);
  }

  // Extract calls that already exist in the search text (they're being replaced, so OK)
  const searchCalls = new Set();
  callPattern.lastIndex = 0;
  while ((m = callPattern.exec(search)) !== null) {
    searchCalls.add(m[1]);
  }

  // JS keywords and built-ins that are always available
  const builtins = new Set([
    "if", "for", "while", "switch", "catch", "function", "return", "throw", "new", "typeof", "delete", "void",
    "require", "console", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "Promise",
    "Array", "Object", "String", "Number", "Boolean", "Date", "Math", "JSON", "Error",
    "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent",
    "Map", "Set", "RegExp", "Buffer", "process"
  ]);

  for (const call of replaceCalls) {
    if (searchCalls.has(call)) continue;
    if (builtins.has(call)) continue;
    // Check if this identifier exists anywhere in the original file
    if (originalContent.includes(call)) continue;
    return `Patch introduces call to \`${call}()\` which is not defined or imported in the file.`;
  }
  return null;
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function finalizePatch(edit, selectedFile, originalContent, patchedContent, backupsDir, slugify, REPO_ROOT) {
  if (patchedContent === originalContent) {
    return { ok: false, reason: "Patch produced no change." };
  }

  if (containsPlaceholder(patchedContent)) {
    return { ok: false, reason: "Patched content contains placeholder or unfinished text." };
  }

  // Validate the patched content preserves critical patterns
  const preflightIssue = validateRewriteCandidate(selectedFile.absolute_path, originalContent, patchedContent);
  if (preflightIssue) {
    return { ok: false, reason: preflightIssue };
  }

  const backupName = (slugify ? slugify(edit.path.replace(":", "-")) : edit.path.replace(/[^a-z0-9]/gi, "-")) || "backup";
  const backupPath = path.join(backupsDir, `${backupName}.bak`);

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, originalContent);
  fs.writeFileSync(selectedFile.absolute_path, patchedContent);

  const syntaxIssue = validateAppliedEdit(edit.path, selectedFile.absolute_path, REPO_ROOT);
  if (syntaxIssue) {
    fs.writeFileSync(selectedFile.absolute_path, originalContent);
    return { ok: false, reason: syntaxIssue };
  }

  return {
    ok: true,
    entry: {
      path: edit.path,
      absolute_path: selectedFile.absolute_path,
      summary: edit.summary,
      confidence: edit.confidence,
      backup_path: backupPath
    }
  };
}

/**
 * Post-apply syntax validation for a single file.
 */
function validateAppliedEdit(prefixedPath, absolutePath, repoRoot) {
  const extension = path.extname(absolutePath).toLowerCase();

  if (![".js", ".mjs", ".cjs"].includes(extension)) {
    return "";
  }

  const result = spawnSync("node", ["--check", absolutePath], {
    cwd: repoRoot || process.cwd(),
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    return `Syntax validation failed: ${String(result.stderr || result.stdout || "").trim()}`;
  }

  return "";
}

/**
 * Preflight validation: check a proposed rewrite doesn't destroy the file.
 * Adapted for Node.js API patterns (module.exports, Express router, require()).
 */
function validateRewriteCandidate(absolutePath, originalContent, nextContent) {
  if (containsPlaceholder(nextContent)) {
    return "Suggested rewrite contains placeholder or unfinished text.";
  }

  const originalLines = String(originalContent || "").split("\n").length;
  const nextLines = String(nextContent || "").split("\n").length;

  if (nextLines < Math.max(8, Math.floor(originalLines * 0.65))) {
    return "Suggested rewrite removes too much of the original file.";
  }

  // Check module.exports preservation
  const originalHasModuleExports = /module\.exports\s*=/.test(originalContent);
  if (originalHasModuleExports && !/module\.exports\s*=/.test(nextContent)) {
    return "Suggested rewrite removed `module.exports`.";
  }

  // Check exports.X preservation
  const originalNamedExports = extractNamedExports(originalContent);
  const nextNamedExports = new Set(extractNamedExports(nextContent));
  for (const exportName of originalNamedExports) {
    if (!nextNamedExports.has(exportName)) {
      return `Suggested rewrite removed required export \`${exportName}\`.`;
    }
  }

  // Check Express router preservation
  const originalHasRouter = /express\.Router\(\)/.test(originalContent) || /Router\(\)/.test(originalContent);
  if (originalHasRouter && !/Router\(\)/.test(nextContent)) {
    return "Suggested rewrite removed Express router initialization.";
  }

  // Check class preservation
  const requiredClasses = extractDeclaredClasses(originalContent);
  const nextClasses = new Set(extractDeclaredClasses(nextContent));
  for (const className of requiredClasses) {
    if (!nextClasses.has(className)) {
      return `Suggested rewrite removed required class \`${className}\`.`;
    }
  }

  // Check admin SDK init preservation
  if (/admin\.initializeApp\b/.test(originalContent) && !/admin\.initializeApp\b/.test(nextContent)) {
    return "Suggested rewrite removed Firebase Admin SDK initialization.";
  }

  // Check onRequest/onSchedule preservation
  if (/onRequest\b/.test(originalContent) && !/onRequest\b/.test(nextContent)) {
    return "Suggested rewrite removed Cloud Functions onRequest export.";
  }
  if (/onSchedule\b/.test(originalContent) && !/onSchedule\b/.test(nextContent)) {
    return "Suggested rewrite removed Cloud Functions onSchedule export.";
  }

  return "";
}

/**
 * Run the full verification suite after edits are applied.
 * For the API: syntax check + smoke tests in functions/.
 */
function runVerificationSuite(config, runDir, appliedEdits, options = {}) {
  const { REPO_ROOT } = options.helpers || {};
  const root = REPO_ROOT || process.cwd();
  const functionsDir = path.join(root, "functions");
  const results = {
    syntax_check: { passed: true, details: [] },
    lint_check: { passed: true, details: [], skipped: false },
    smoke_test: { passed: true, details: [], skipped: false },
    summary: "all_passed"
  };

  if (!appliedEdits.length) {
    results.summary = "no_edits";
    return results;
  }

  // 1. Syntax check every applied JS file
  appliedEdits.forEach((edit) => {
    const ext = path.extname(edit.absolute_path).toLowerCase();
    if ([".js", ".mjs", ".cjs"].includes(ext)) {
      const check = spawnSync("node", ["--check", edit.absolute_path], {
        cwd: root,
        encoding: "utf8",
        timeout: 10000,
        env: process.env
      });
      if (check.status !== 0) {
        results.syntax_check.passed = false;
        results.syntax_check.details.push({
          file: edit.path,
          error: String(check.stderr || check.stdout || "").trim()
        });
      }
    }
  });

  // 2. Run smoke tests in functions/ (non-blocking)
  if (fs.existsSync(functionsDir)) {
    const packageJsonPath = path.join(functionsDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        if (pkg.scripts && pkg.scripts["test:smoke"]) {
          const smoke = spawnSync("npm", ["run", "test:smoke"], {
            cwd: functionsDir,
            encoding: "utf8",
            timeout: 60000,
            env: process.env,
            shell: true
          });
          if (smoke.status !== 0) {
            results.smoke_test.passed = false;
            results.smoke_test.details.push(String(smoke.stdout || smoke.stderr || "").trim().slice(0, 2000));
          }
        } else {
          results.smoke_test.skipped = true;
        }
      } catch (e) {
        results.smoke_test.skipped = true;
      }
    } else {
      results.smoke_test.skipped = true;
    }
  } else {
    results.smoke_test.skipped = true;
  }

  // 3. Run predeploy check (route mount validation)
  const predeployPath = path.join(functionsDir, "scripts", "predeploy-check.js");
  if (fs.existsSync(predeployPath)) {
    const predeploy = spawnSync("node", [predeployPath], {
      cwd: functionsDir,
      encoding: "utf8",
      timeout: 30000,
      env: process.env
    });
    if (predeploy.status !== 0) {
      results.lint_check.passed = false;
      results.lint_check.details.push(`Predeploy check failed: ${String(predeploy.stderr || predeploy.stdout || "").trim().slice(0, 1000)}`);
    }
  } else {
    results.lint_check.skipped = true;
  }

  // 4. Determine overall summary
  if (!results.syntax_check.passed) {
    results.summary = "syntax_failed";
  } else if (!results.smoke_test.passed) {
    results.summary = "smoke_test_failed";
  } else if (!results.lint_check.passed) {
    results.summary = "predeploy_failed";
  } else {
    results.summary = "all_passed";
  }

  return results;
}

/**
 * Build a verification report markdown for the user.
 */
function buildVerificationReport(runId, appliedEdits, rejectedEdits, verification) {
  const lines = [
    "# Verification Report",
    "",
    `Run: \`${runId}\``,
    `Status: **${verification.summary}**`,
    ""
  ];

  if (appliedEdits.length) {
    lines.push("## Applied Edits");
    lines.push("");
    appliedEdits.forEach((edit) => {
      lines.push(`- ✎ \`${edit.path}\`: ${edit.summary || "Safe rewrite"} (confidence: ${edit.confidence || "?"})`);
    });
    lines.push("");
  }

  if (rejectedEdits.length) {
    lines.push("## Rejected Edits (auto-blocked)");
    lines.push("");
    rejectedEdits.forEach((edit) => {
      lines.push(`- ✗ \`${edit.path}\`: ${edit.reason}`);
    });
    lines.push("");
  }

  lines.push("## Local Verification");
  lines.push("");
  lines.push(`- Syntax check: ${verification.syntax_check.passed ? "✓ PASSED" : "✗ FAILED"}`);
  if (!verification.syntax_check.passed) {
    verification.syntax_check.details.forEach((d) => {
      lines.push(`  - \`${d.file}\`: ${d.error}`);
    });
  }

  const smokeTest = verification.smoke_test || {};
  lines.push(`- Smoke tests: ${smokeTest.skipped ? "⊘ SKIPPED (no test:smoke script)" : smokeTest.passed ? "✓ PASSED" : "✗ FAILED"}`);
  if (!smokeTest.passed && !smokeTest.skipped && smokeTest.details) {
    lines.push(`  ${smokeTest.details[0] || ""}`);
  }

  lines.push(`- Predeploy check: ${verification.lint_check.skipped ? "⊘ SKIPPED" : verification.lint_check.passed ? "✓ PASSED" : "✗ FAILED"}`);
  if (!verification.lint_check.passed && !verification.lint_check.skipped) {
    lines.push(`  ${verification.lint_check.details[0] || ""}`);
  }

  lines.push("");
  lines.push("## Next Steps");
  lines.push("");
  if (verification.summary === "syntax_failed") {
    lines.push("**Syntax errors detected.** Edits have been auto-rolled back. Review the agent's output and re-run.");
  } else {
    lines.push("Review the diffs, then:");
    lines.push(`  $ kaayko-api diff --run ${runId}`);
    lines.push(`  $ kaayko-api approve --run ${runId}`);
    lines.push(`  $ kaayko-api reject --run ${runId}`);
  }

  return lines.join("\n");
}

/**
 * Detect unsafe placeholder content in proposed edits.
 */
function detectUnsafeEdits(safeEdits) {
  return (Array.isArray(safeEdits) ? safeEdits : [])
    .map((edit) => {
      const content = typeof edit.content === "string" ? edit.content : "";
      return containsPlaceholder(content)
        ? { path: edit.path || "unknown", reason: "contains placeholder or unfinished text" }
        : null;
    })
    .filter(Boolean);
}

function containsPlaceholder(text) {
  const patterns = [
    /render logic here/i,
    /(?:\/\/|\/\*|^)\s*placeholder\b(?!\s*[=:"'])/im,
    /^\s*\.{3}\s*$/m,
    /\/\/\s*\.{3}\s*$/m,
    /\bTODO\b/i,
    /rest of (the |)implementation/i,
    /add implementation here/i,
    /insert (code|logic) here/i,
    /\/\*\s*Content of .+ after .+\s*\*\//i,
    /\/\/\s*\.\.\.\s*remaining\s/i
  ];

  return patterns.some((pattern) => pattern.test(String(text || "")));
}

function extractNamedExports(text) {
  return Array.from(String(text || "").matchAll(/exports\.([A-Za-z0-9_$]+)\s*=/g)).map((match) => match[1]);
}

function extractDeclaredClasses(text) {
  return Array.from(String(text || "").matchAll(/\bclass\s+([A-Za-z0-9_$]+)/g)).map((match) => match[1]);
}

module.exports = {
  applyAndVerifyEdits,
  applyPatchEdit,
  validateAppliedEdit,
  validateRewriteCandidate,
  runVerificationSuite,
  buildVerificationReport,
  detectUnsafeEdits,
  containsPlaceholder,
  extractNamedExports,
  extractDeclaredClasses
};
