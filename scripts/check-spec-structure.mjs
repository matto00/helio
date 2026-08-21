#!/usr/bin/env node
// Enforces the openspec-spec-hygiene invariant on every canonical spec under
// openspec/specs/ (see openspec/specs/openspec-spec-hygiene/spec.md, HEL-775):
//
//   The requirement-name set seen by the archive DELTA PARSER
//   (`extractRequirementsSection`), the set seen by the VALIDATOR's spec
//   model (`MarkdownParser.parseSections()` -> the "Requirements" section's
//   children), and the set of `### Requirement:` lines PRESENT in the file
//   must all be identical -- and the validator must report zero ERRORs for
//   that spec.
//
// Parser-visibility alone is insufficient: the delta parser closes the
// requirements section only on `/^##\s/`, while the validator closes a `##`
// section on any heading of level <= 2, INCLUDING a level-1 `#`. A
// requirement can therefore be visible to one and invisible to the other,
// which would pass a parser-only check and still abort a real
// `openspec archive` (it exits 0 even when it aborts -- see design.md).
//
// This script imports the REAL parser/validator modules from the installed
// `openspec` CLI (resolved via `which openspec`, wherever that lives on
// PATH) rather than reimplementing their scoping rules, so its fidelity is
// not a reimplementation risk -- it fails exactly when the real tools would
// disagree. Validity (the "zero ERRORs" half of the invariant, e.g. a
// missing `## Purpose`) is checked by calling the real `Validator` class
// directly per file, rather than shelling out to the CWD-bound
// `openspec validate --specs` CLI command -- same underlying check
// (`Validator.validateSpec`, the exact method the CLI itself calls per
// file), but directory-agnostic, so this same script can be pointed at a
// fixtures directory outside the repo for its own self-test (see
// check-spec-structure.spec.md's test plan / HEL-775 task 7.4).
//
// Two additional narrower checks are kept only for clearer diagnostics
// (design.md decision 3), not because they add coverage beyond the
// set-equality invariant + zero-ERRORs:
//   1. No delta-only headings (## ADDED/MODIFIED/REMOVED/RENAMED Requirements).
//   2. No duplicate requirement names within one file.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const specsDir = process.argv[2] ? join(process.argv[2]) : join(repoRoot, "openspec/specs");

const DELTA_HEADING_RE = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/m;
const REQUIREMENT_HEADER_RE = /^###\s+Requirement:\s*(.+?)\s*$/;

function resolveOpenspecPackageRoot() {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  let binPath;
  try {
    binPath = execFileSync(whichCmd, ["openspec"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  } catch {
    return null;
  }
  if (!binPath) return null;
  try {
    const real = realpathSync(binPath);
    // <root>/bin/openspec.js -> <root>
    return dirname(dirname(real));
  } catch {
    return null;
  }
}

async function loadOpenspecInternals() {
  const root = resolveOpenspecPackageRoot();
  if (!root) {
    console.error(
      "Cannot find the `openspec` CLI on PATH (required for scripts/check-spec-structure.mjs).",
    );
    process.exit(2);
  }
  let requirementBlocks;
  let markdownParser;
  let validatorModule;
  try {
    requirementBlocks = await import(
      pathToFileURL(join(root, "dist/core/parsers/requirement-blocks.js")).href
    );
    markdownParser = await import(
      pathToFileURL(join(root, "dist/core/parsers/markdown-parser.js")).href
    );
    validatorModule = await import(
      pathToFileURL(join(root, "dist/core/validation/validator.js")).href
    );
  } catch (e) {
    console.error(`Cannot load openspec's internal modules from ${root}: ${e.message}`);
    process.exit(2);
  }
  return {
    extractRequirementsSection: requirementBlocks.extractRequirementsSection,
    MarkdownParser: markdownParser.MarkdownParser,
    Validator: validatorModule.Validator,
  };
}

function inFileRequirementNames(content) {
  const names = [];
  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    const m = line.match(REQUIREMENT_HEADER_RE);
    if (m) names.push(m[1].trim());
  }
  return names;
}

function parserVisibleNames(content, extractRequirementsSection) {
  return extractRequirementsSection(content).bodyBlocks.map((b) => b.name);
}

function validatorVisibleNames(content, MarkdownParser) {
  const parser = new MarkdownParser(content);
  const sections = parser.parseSections();
  const reqSection = parser.findSection(sections, "Requirements");
  if (!reqSection) return [];
  return reqSection.children.map((c) => c.title.replace(/^Requirement:\s*/, ""));
}

function setsEqual(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

function findDuplicates(names) {
  const seen = new Set();
  const dupes = new Set();
  for (const n of names) {
    if (seen.has(n)) dupes.add(n);
    seen.add(n);
  }
  return [...dupes];
}

async function main() {
  const { extractRequirementsSection, MarkdownParser, Validator } = await loadOpenspecInternals();
  const validator = new Validator();

  let specDirs;
  try {
    specDirs = readdirSync(specsDir)
      .filter((d) => {
        try {
          return statSync(join(specsDir, d)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch (e) {
    console.error(`Cannot read specs directory ${specsDir}: ${e.message}`);
    process.exit(2);
  }

  /** @type {string[]} */
  const errors = [];

  for (const dir of specDirs) {
    const specPath = join(specsDir, dir, "spec.md");
    let content;
    try {
      content = readFileSync(specPath, "utf8");
    } catch {
      continue;
    }

    // Check: no delta-only headings.
    const deltaMatch = content.match(DELTA_HEADING_RE);
    if (deltaMatch) {
      errors.push(
        `${dir}: stray delta-only heading "## ${deltaMatch[1]} Requirements" in a canonical spec`,
      );
    }

    const inFile = inFileRequirementNames(content);

    // Check: no duplicate requirement names.
    const dupes = findDuplicates(inFile);
    if (dupes.length > 0) {
      errors.push(`${dir}: duplicate requirement name(s): ${dupes.join(", ")}`);
    }

    // Core invariant: delta-parser-visible, validator-visible, and in-file
    // requirement-name sets must all agree.
    const parserVisible = parserVisibleNames(content, extractRequirementsSection);
    const modelVisible = validatorVisibleNames(content, MarkdownParser);

    const parserOk = setsEqual(inFile, parserVisible);
    const modelOk = setsEqual(inFile, modelVisible);
    if (!parserOk || !modelOk) {
      const hiddenFromParser = inFile.filter((n) => !parserVisible.includes(n));
      const hiddenFromValidator = inFile.filter((n) => !modelVisible.includes(n));
      const extraInParser = parserVisible.filter((n) => !inFile.includes(n));
      const extraInValidator = modelVisible.filter((n) => !inFile.includes(n));
      const parts = [];
      if (hiddenFromParser.length)
        parts.push(`hidden from delta parser: ${hiddenFromParser.join(", ")}`);
      if (hiddenFromValidator.length)
        parts.push(`hidden from validator: ${hiddenFromValidator.join(", ")}`);
      if (extraInParser.length) parts.push(`extra in delta parser: ${extraInParser.join(", ")}`);
      if (extraInValidator.length) parts.push(`extra in validator: ${extraInValidator.join(", ")}`);
      errors.push(`${dir}: requirement-name sets disagree (${parts.join("; ")})`);
    }

    // Zero-ERRORs half of the invariant: run the real validator on this file
    // directly (same method `openspec validate --specs` calls per file),
    // directory-agnostic so this also runs against fixtures in a self-test.
    const report = await validator.validateSpec(specPath);
    const errorIssues = report.issues.filter((iss) => iss.level === "ERROR");
    if (errorIssues.length > 0) {
      errors.push(
        `${dir}: openspec validator reports ERROR(s): ${errorIssues.map((i) => i.message).join(" | ")}`,
      );
    }
  }

  if (errors.length > 0) {
    console.error(`spec-structure check failed (${errors.length} issue(s)):\n`);
    for (const e of errors) console.error("  - " + e);
    console.error("");
    process.exit(1);
  }

  console.log(`spec-structure check passed (${specDirs.length} canonical specs, 0 issues)`);
}

main();
