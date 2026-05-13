#!/usr/bin/env node
// Enforces CONTRIBUTING.md "Imports & Qualifiers" + file-size rules on Scala
// sources. Run by husky pre-commit; exits non-zero on hard violations.
//
// Hard rules (fail commit):
//   - No inline fully-qualified names. Every type/symbol used in a Scala file
//     must be imported at the top (or via a single-use scoped import inside a
//     companion object / function — see CONTRIBUTING.md exception). Inline
//     references like `com.helio.domain.PanelId(...)`, `spray.json.JsObject`,
//     `java.util.UUID.randomUUID()`, `org.apache.pekko.http.X` etc. are
//     rejected.
//
// Soft rules (warn, do not fail):
//   - Files over 250 lines (general source) or 80 lines (aggregator/index)
//     are reported. Add the file path to AGGREGATOR_FILES below to mark an
//     aggregator. Otherwise the 250-line budget applies.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = [
  join(repoRoot, "backend/src/main/scala"),
  join(repoRoot, "backend/src/test/scala"),
];

// Files that are aggregators / barrel-style indexes — held to the tighter
// 80-line budget. Paths relative to repoRoot.
const AGGREGATOR_FILES = new Set(["backend/src/main/scala/com/helio/api/JsonProtocols.scala"]);

// FQN prefixes that should never appear inline (they should be imported).
const FQN_PREFIXES = [
  "com.helio.",
  "spray.json.",
  "org.apache.pekko.",
  "org.postgresql.",
  "java.util.UUID",
  "java.util.Base64",
  "java.util.concurrent.",
  "java.nio.charset.",
  "java.security.",
  "scala.concurrent.",
  "at.favre.lib.",
  "slick.jdbc.",
];

const fqnLineRegex = new RegExp(
  `(${FQN_PREFIXES.map((p) => p.replace(/\./g, "\\.")).join("|")})\\w`,
);

const hardErrors = [];
const softWarnings = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (entry.endsWith(".scala")) checkFile(full);
  }
}

function checkFile(absPath) {
  const rel = relative(repoRoot, absPath);
  const text = readFileSync(absPath, "utf8");
  const lines = text.split("\n");

  // File-size soft budget
  const budget = AGGREGATOR_FILES.has(rel) ? 80 : 250;
  const loc = lines.length;
  if (loc > budget) {
    softWarnings.push(`${rel} is ${loc} lines (soft budget ${budget}); consider splitting`);
  }

  // FQN inline check
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    // Track /** ... */ block comments
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }

    // Skip single-line comments and scaladoc continuation lines
    if (line.startsWith("//") || line.startsWith("*")) continue;

    // Skip import and package declarations (top-level or scoped)
    if (/^(import|package)\b/.test(line)) continue;

    if (!fqnLineRegex.test(raw)) continue;

    // Pre-extract any string literals so we don't flag FQN-shaped text
    // inside double-quoted strings (e.g., test fixtures or log messages).
    const stripped = raw.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (!fqnLineRegex.test(stripped)) continue;

    // Find the offending qualifier for the error message
    const match = stripped.match(fqnLineRegex);
    const offender = match ? match[1] : "inline FQN";
    const col = raw.indexOf(offender) + 1;
    hardErrors.push(
      `${rel}:${i + 1}:${col}: inline FQN '${offender}…' — add a top-of-file import instead`,
    );
  }
}

for (const root of scanRoots) {
  try {
    walk(root);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

if (softWarnings.length) {
  process.stderr.write("Scala file-size warnings:\n");
  for (const w of softWarnings) process.stderr.write(`  ${w}\n`);
  process.stderr.write("\n");
}

if (hardErrors.length) {
  process.stderr.write(`Scala code-quality check failed — ${hardErrors.length} violation(s):\n\n`);
  for (const e of hardErrors) process.stderr.write(`  ${e}\n`);
  process.stderr.write(
    "\nSee CONTRIBUTING.md 'Imports & Qualifiers'. Fix with a top-of-file import.\n",
  );
  process.exit(1);
}

process.stdout.write(`Scala code-quality check: clean (${softWarnings.length} soft warning(s))\n`);
