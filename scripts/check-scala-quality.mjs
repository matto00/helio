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
// Known guard limits (false negatives, not fixed here): a `'"'` char literal
// can confuse the string blanking; text inside a multi-line `"""` block and
// `${...}` inside an ordinary `"..."` literal are not scanned as code.
//
// Soft rules (warn, do not fail):
//   - Files over 250 lines (general source) or 80 lines (aggregator/index)
//     are reported. Add the file path to AGGREGATOR_FILES below to mark an
//     aggregator. Otherwise the 250-line budget applies.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Files that are aggregators / barrel-style indexes — held to the tighter
// 80-line budget. Paths relative to repoRoot.
const AGGREGATOR_FILES = new Set(["backend/src/main/scala/com/helio/api/JsonProtocols.scala"]);

// FQN prefixes that should never appear inline (they should be imported).
const FQN_PREFIXES = [
  "com.helio.",
  "spray.json.",
  "org.apache.pekko.",
  "org.postgresql.",
  "java.sql.",
  "java.time.",
  "java.util.",
  "java.nio.charset.",
  "java.security.",
  "scala.concurrent.",
  "at.favre.lib.",
  "slick.jdbc.",
  "scala.annotation.",
];

// Every prefix must end in "." — the match regex requires a word character right
// after the prefix, so a dot-less entry like "java.util.UUID" can never fire.
export function assertPrefixesEndInDot(prefixes) {
  const bad = prefixes.filter((p) => !p.endsWith("."));
  if (bad.length) {
    throw new Error(
      `FQN_PREFIXES entries must end in '.': ${bad.map((p) => JSON.stringify(p)).join(", ")}`,
    );
  }
}
assertPrefixesEndInDot(FQN_PREFIXES);

// Escapes every regex metacharacter (not just `.`) so FQN_PREFIXES entries are
// treated as literal text when composed into fqnLineRegex below. CodeQL
// js/incomplete-sanitization: the previous version only escaped `.`.
function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const fqnLineRegex = new RegExp(`(${FQN_PREFIXES.map(escapeRegExp).join("|")})\\w`);

const SOFT_BUDGET = 250;
const AGGREGATOR_BUDGET = 80;

// Pure scan of one Scala file's text. Returns { hardErrors, softWarnings }.
export function scanScalaText(rel, text) {
  const hardErrors = [];
  const softWarnings = [];
  const lines = text.split("\n");

  const budget = AGGREGATOR_FILES.has(rel) ? AGGREGATOR_BUDGET : SOFT_BUDGET;
  const loc = lines.length;
  if (loc > budget) {
    softWarnings.push(`${rel} is ${loc} lines (soft budget ${budget}); consider splitting`);
  }

  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

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

    // Blank string literals first (so a `//` inside "http://..." is not taken for a
    // comment), then drop single-line `/* ... */` spans and any trailing `//` comment.
    const stripped = raw
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/\/\*.*?\*\//g, "")
      .replace(/\/\/.*$/, "");
    const match = stripped.match(fqnLineRegex);
    if (!match) continue;

    const offender = match[1];
    const col = raw.indexOf(offender) + 1;
    hardErrors.push(
      `${rel}:${i + 1}:${col}: inline FQN '${offender}…' — add a top-of-file import instead`,
    );
  }
  return { hardErrors, softWarnings };
}

function walk(dir, repoRoot, acc) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, repoRoot, acc);
    else if (entry.endsWith(".scala")) {
      const { hardErrors, softWarnings } = scanScalaText(
        relative(repoRoot, full),
        readFileSync(full, "utf8"),
      );
      acc.hardErrors.push(...hardErrors);
      acc.softWarnings.push(...softWarnings);
    }
  }
}

function main() {
  const repoRoot = process.argv[2] ? resolve(process.argv[2]) : defaultRepoRoot;
  const scanRoots = [
    join(repoRoot, "backend/src/main/scala"),
    join(repoRoot, "backend/src/test/scala"),
  ];
  const acc = { hardErrors: [], softWarnings: [] };
  for (const root of scanRoots) {
    try {
      walk(root, repoRoot, acc);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const { hardErrors, softWarnings } = acc;

  if (softWarnings.length) {
    process.stderr.write("Scala file-size warnings:\n");
    for (const w of softWarnings) process.stderr.write(`  ${w}\n`);
    process.stderr.write("\n");
  }

  if (hardErrors.length) {
    process.stderr.write(
      `Scala code-quality check failed — ${hardErrors.length} violation(s):\n\n`,
    );
    for (const e of hardErrors) process.stderr.write(`  ${e}\n`);
    process.stderr.write(
      "\nSee CONTRIBUTING.md 'Imports & Qualifiers'. Fix with a top-of-file import.\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    `Scala code-quality check: clean (${softWarnings.length} soft warning(s))\n`,
  );
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) main();
