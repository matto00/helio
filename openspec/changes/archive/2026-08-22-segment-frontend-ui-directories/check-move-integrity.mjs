#!/usr/bin/env node
/**
 * Move-integrity gate for HEL-635 (segment-frontend-ui-directories).
 *
 * A green test suite cannot distinguish a correct file move from one that silently dropped,
 * truncated, or rewrote a file. This script proves, mechanically, that the three-directory
 * segmentation touched nothing but file locations and the relative-path specifiers needed to
 * reach relocated files. See openspec/changes/segment-frontend-ui-directories/design.md D4/D6
 * for the full rationale; this is the implementation, not a restatement.
 *
 * Checks, in order (any failure aborts with a non-zero exit):
 *   1. Non-vacuity      — the diff against BASE holds at least 116 renamed (R) paths.
 *   2. Whole-repo status — no D/T anywhere; A only for this change's openspec/ artifacts or this
 *                          script; the only non-frontend/ M is docs/compute-expression-grammar.md.
 *   3. Whole-tree path set — tracked paths under frontend/ today equal the BASE set with the
 *                          rename pairs applied, exactly (closes the "moved file dropped outside
 *                          the three ui/ dirs" hole R+M alone would miss).
 *   4. Content check    — every R/M file's old and new content are identical once every quoted
 *                          relative-path literal is replaced by a fixed-length placeholder and
 *                          both sides are run through prettier. Normalize, never strip.
 *   5. Substitution-site check — every quoted relative literal in an R/M file sits in an accepted
 *                          statement form (import/export incl. continuation, require, jest.mock,
 *                          jest.requireActual, dynamic import). Anything else fails.
 *   6. Specifier-target check — resolves each site's target on both the old and new side
 *                          (extension-aware, rename-map-aware) and requires the same target.
 *                          Catches a wrong-but-existing path (e.g. a swapped .css sibling) that
 *                          the content check, by construction, cannot see.
 *
 * BASE is re-derived every run as `git merge-base origin/main HEAD` — never HEAD (vacuous once
 * committed), never a hard-pinned SHA (origin/main advances). An unresolvable specifier or a
 * prettier error on either side of the content check is a FAILURE, never a skip.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import prettier from "prettier";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
process.chdir(REPO_ROOT);

// The change directory legitimately lives at either path depending on whether the
// change has been archived yet; this checker runs on both sides of `openspec archive`,
// so both are accepted. Without the archived prefix, archiving relocates the very
// artifacts this allow-list pins and the status assertion reports 16 spurious `A`s
// while every substantive check still passes.
// The one canonical spec `openspec archive` syncs for this change. Named explicitly
// rather than allowing an `openspec/specs/` prefix, which would wave through any
// unrelated spec addition.
const SYNCED_SPEC_PATH = "openspec/specs/frontend-ui-directory-structure/spec.md";
const CHANGE_DIR_PREFIXES = [
  "openspec/changes/segment-frontend-ui-directories/",
  "openspec/changes/archive/2026-08-22-segment-frontend-ui-directories/",
];
const NON_FRONTEND_M_ALLOWED = new Set(["docs/compute-expression-grammar.md"]);
const MIN_RENAMES = 116;

const RELATIVE_LITERAL = /(['"])(\.{1,2}\/[^'"]*)\1/g;
const PLACEHOLDER = "$1./__SPEC__$1";

let failures = 0;

function fail(message) {
  failures++;
  console.error(`FAIL: ${message}`);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 128 });
}

function gitOrNull(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Derive BASE (never HEAD, never hard-pinned).
// ---------------------------------------------------------------------------
const BASE = git(["merge-base", "origin/main", "HEAD"]).trim();
console.log(`BASE = ${BASE} (git merge-base origin/main HEAD, re-derived this run)`);

// Whole-repo diff, rename-detected, BASE -> current working tree (uncommitted or committed,
// both work: after commit the working tree equals HEAD, so this is never vacuous either way).
const rawStatus = git(["diff", "-M", "--name-status", BASE]).trim();
const statusLines = rawStatus ? rawStatus.split("\n") : [];

const renames = []; // { status, oldPath, newPath }
const others = []; // { status, path }
for (const line of statusLines) {
  const parts = line.split("\t");
  const status = parts[0];
  if (status.startsWith("R")) {
    renames.push({ status, oldPath: parts[1], newPath: parts[2] });
  } else {
    others.push({ status, path: parts[1] });
  }
}

// ---------------------------------------------------------------------------
// 2. Non-vacuity.
// ---------------------------------------------------------------------------
if (renames.length < MIN_RENAMES) {
  fail(
    `Non-vacuity: only ${renames.length} R entries against BASE=${BASE} (need >= ${MIN_RENAMES}). ` +
      `A base yielding no/too-few renames must never read as a pass.`,
  );
} else {
  console.log(`Non-vacuity OK: ${renames.length} R entries (>= ${MIN_RENAMES}).`);
}

// ---------------------------------------------------------------------------
// 3. Whole-repo status assertion.
// ---------------------------------------------------------------------------
for (const o of others) {
  if (o.status === "D" || o.status.startsWith("T")) {
    fail(`Whole-repo status: unexpected ${o.status} at ${o.path} (no D/T is permitted anywhere).`);
  } else if (o.status === "A") {
    const okA =
      CHANGE_DIR_PREFIXES.some((prefix) => o.path.startsWith(prefix)) || o.path === SYNCED_SPEC_PATH;
    if (!okA) fail(`Whole-repo status: unexpected A at ${o.path}.`);
  } else if (o.status.startsWith("M")) {
    if (!o.path.startsWith("frontend/") && !NON_FRONTEND_M_ALLOWED.has(o.path)) {
      fail(`Whole-repo status: unexpected non-frontend/ M at ${o.path}.`);
    }
  } else {
    fail(`Whole-repo status: unrecognized status "${o.status}" at ${o.path}.`);
  }
}
for (const r of renames) {
  if (!r.oldPath.startsWith("frontend/") || !r.newPath.startsWith("frontend/")) {
    fail(`Whole-repo status: rename outside frontend/: ${r.oldPath} -> ${r.newPath}.`);
  }
}
if (failures === 0) {
  console.log(
    `Whole-repo status assertion OK: ${renames.length} renames (all under frontend/), ` +
      `${others.length} other entries, all accounted for.`,
  );
}

// ---------------------------------------------------------------------------
// 4. Whole-tree path-set assertion, baseline derived from $BASE (not the working tree).
// ---------------------------------------------------------------------------
const baselineFrontendFiles = git(["ls-tree", "-r", "--name-only", BASE, "--", "frontend/"])
  .trim()
  .split("\n")
  .filter(Boolean);
const renameByOld = new Map(renames.map((r) => [r.oldPath, r.newPath]));
const expectedSet = new Set(baselineFrontendFiles.map((f) => renameByOld.get(f) || f));

// `git ls-files` alone reflects the INDEX, not the working tree: a file removed from disk but
// not yet staged still shows up there, which would make this assertion blind to exactly the
// silent-deletion case it exists to catch. Subtract `--deleted` (tracked paths missing from the
// working tree) so this reflects what is actually present on disk right now.
const trackedFrontendFiles = git(["ls-files", "--", "frontend/"])
  .trim()
  .split("\n")
  .filter(Boolean);
const deletedFrontendFiles = new Set(
  git(["ls-files", "--deleted", "--", "frontend/"]).trim().split("\n").filter(Boolean),
);
const currentFrontendFiles = trackedFrontendFiles.filter((f) => !deletedFrontendFiles.has(f));
const currentSet = new Set(currentFrontendFiles);

const missing = [...expectedSet].filter((f) => !currentSet.has(f));
const extra = [...currentSet].filter((f) => !expectedSet.has(f));
if (missing.length || extra.length) {
  fail(
    `Whole-tree path-set assertion: expected ${expectedSet.size} tracked frontend/ paths ` +
      `(baseline + rename pairs), got ${currentSet.size}. ` +
      `Missing: ${JSON.stringify(missing.slice(0, 20))}${missing.length > 20 ? " …" : ""} ` +
      `Extra: ${JSON.stringify(extra.slice(0, 20))}${extra.length > 20 ? " …" : ""}`,
  );
} else {
  console.log(`Whole-tree path-set assertion OK: ${expectedSet.size} paths match exactly.`);
}

// ---------------------------------------------------------------------------
// In-scope files for content / site / specifier-target checks: every R (new side) + every M
// under frontend/, i.e. every file this change moved or edited in place.
// ---------------------------------------------------------------------------
const inScope = [
  ...renames.map((r) => ({ oldPath: r.oldPath, newPath: r.newPath, moved: true })),
  ...others
    .filter((o) => o.status.startsWith("M") && o.path.startsWith("frontend/"))
    .map((o) => ({ oldPath: o.path, newPath: o.path, moved: false })),
];

function readOld(oldPath) {
  const result = gitOrNull(["show", `${BASE}:${oldPath}`]);
  if (result === null) {
    fail(`Content check: could not read ${oldPath} at BASE=${BASE} (git show failed).`);
    return null;
  }
  return result;
}

function readNew(newPath) {
  const abs = path.join(REPO_ROOT, newPath);
  if (!fs.existsSync(abs)) {
    fail(`Content check: ${newPath} does not exist in the current tree.`);
    return null;
  }
  return fs.readFileSync(abs, "utf8");
}

// ---------------------------------------------------------------------------
// 5. Content check — normalize (fixed-length placeholder, never strip), then prettier both
//    sides, require byte-identity. A prettier error on either side is a FAILURE, never a skip.
// ---------------------------------------------------------------------------
async function prettierFormatOrFail(content, filepath, label) {
  const config = (await prettier.resolveConfig(filepath)) || {};
  try {
    const out = await prettier.format(content, { ...config, filepath });
    if (typeof out !== "string" || out.length === 0) {
      fail(
        `Content check: prettier produced empty output for ${label} — treated as a failure, not a skip.`,
      );
      return null;
    }
    return out;
  } catch (e) {
    fail(`Content check: prettier errored on ${label}: ${e.message.split("\n")[0]}`);
    return null;
  }
}

const contentResults = []; // { newPath, identical }

async function runContentCheck() {
  for (const entry of inScope) {
    const oldContent = readOld(entry.oldPath);
    const newContent = readNew(entry.newPath);
    if (oldContent === null || newContent === null) continue;

    const oldNormalized = oldContent.replace(RELATIVE_LITERAL, PLACEHOLDER);
    const newNormalized = newContent.replace(RELATIVE_LITERAL, PLACEHOLDER);

    const oldFormatted = await prettierFormatOrFail(
      oldNormalized,
      entry.newPath,
      `${entry.oldPath} (old, normalized)`,
    );
    const newFormatted = await prettierFormatOrFail(
      newNormalized,
      entry.newPath,
      `${entry.newPath} (new, normalized)`,
    );
    if (oldFormatted === null || newFormatted === null) {
      contentResults.push({ newPath: entry.newPath, identical: false });
      continue;
    }

    const identical = oldFormatted === newFormatted;
    contentResults.push({ newPath: entry.newPath, identical });
    if (!identical) {
      fail(
        `Content check: ${entry.oldPath} -> ${entry.newPath} differs beyond import/path-specifier lines.`,
      );
    }
  }
  const okCount = contentResults.filter((r) => r.identical).length;
  console.log(
    `Content check: ${okCount}/${contentResults.length} files identical (normalize + prettier both sides).`,
  );
}

// ---------------------------------------------------------------------------
// 6. Substitution-site check — every quoted relative literal must sit in an accepted statement
//    form. Statement-level, not per-line: an import's continuation-line closer belongs to the
//    statement above it.
// ---------------------------------------------------------------------------
const ACCEPTED_FORMS = [
  // import ... from "spec";  (single- or multi-line, 's' flag lets '.' span newlines)
  /\bimport\s[^;]*?\bfrom\s*(['"])(\.{1,2}\/[^'"]*)\1/gs,
  // export ... from "spec";
  /\bexport\s[^;]*?\bfrom\s*(['"])(\.{1,2}\/[^'"]*)\1/gs,
  // bare side-effect import "spec";
  /\bimport\s*(['"])(\.{1,2}\/[^'"]*)\1\s*;/g,
  // dynamic import("spec")
  /\bimport\(\s*(['"])(\.{1,2}\/[^'"]*)\1\s*\)/g,
  // require("spec")
  /\brequire\(\s*(['"])(\.{1,2}\/[^'"]*)\1\s*\)/g,
  // jest.mock("spec", ...)
  /\bjest\.mock\(\s*(['"])(\.{1,2}\/[^'"]*)\1/g,
  // jest.requireActual("spec")
  /\bjest\.requireActual\(\s*(['"])(\.{1,2}\/[^'"]*)\1/g,
];

function countRawLiterals(content) {
  const re = new RegExp(RELATIVE_LITERAL.source, "g");
  return (content.match(re) || []).length;
}

function countAcceptedFormMatches(content) {
  // Count distinct literal occurrences (by match start index of the captured literal) that fall
  // within at least one accepted form. Using match indices avoids double counting when two forms
  // could both match overlapping text.
  const coveredIndices = new Set();
  for (const formRe of ACCEPTED_FORMS) {
    const re = new RegExp(formRe.source, formRe.flags);
    let m;
    while ((m = re.exec(content)) !== null) {
      // Locate the literal's own start index within the full match.
      const literalStart = m.index + m[0].lastIndexOf(m[2]);
      coveredIndices.add(literalStart);
      if (m.index === re.lastIndex) re.lastIndex++; // guard zero-length matches
    }
  }
  return coveredIndices.size;
}

let totalRawSites = 0;
let totalAcceptedSites = 0;

function runSiteCheck() {
  for (const entry of inScope) {
    const abs = path.join(REPO_ROOT, entry.newPath);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, "utf8");
    const raw = countRawLiterals(content);
    const accepted = countAcceptedFormMatches(content);
    totalRawSites += raw;
    totalAcceptedSites += accepted;
    if (accepted < raw) {
      fail(
        `Substitution-site check: ${entry.newPath} has ${raw} quoted relative literal(s) but only ` +
          `${accepted} sit in an accepted statement form (import/export incl. continuation, require, ` +
          `jest.mock, jest.requireActual, dynamic import). A literal outside these forms is not permitted.`,
      );
    }
  }
  console.log(
    `Substitution-site check: ${totalAcceptedSites}/${totalRawSites} sites in an accepted form ` +
      `across ${inScope.length} in-scope files (design.md D4 measured baseline: 623 sites).`,
  );
}

// ---------------------------------------------------------------------------
// 7. Specifier-target check — resolve each site's target on the old side (against BASE tree +
//    rename map) and the new side (against the current tree), extension-aware, and require the
//    same target. This is the only check that catches a wrong-but-existing path (e.g. a swapped
//    co-located .css sibling), which normalize-and-compare provably cannot see.
// ---------------------------------------------------------------------------
const CANDIDATE_SUFFIXES = ["", ".tsx", ".ts", ".css", "/index.tsx", "/index.ts"];
const baselineFileSet = new Set(baselineFrontendFiles);

function resolveAgainstBaseline(fromRepoPath, literal) {
  const dir = path.posix.dirname(fromRepoPath);
  const base = path.posix.normalize(path.posix.join(dir, literal));
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (baselineFileSet.has(candidate)) return candidate;
  }
  return null; // unresolvable against the baseline tree
}

function resolveAgainstCurrent(fromRepoPath, literal) {
  const dir = path.posix.dirname(fromRepoPath);
  const base = path.posix.normalize(path.posix.join(dir, literal));
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (currentSet.has(candidate)) return candidate;
  }
  return null; // unresolvable against the current tree
}

function canonicalizeExt(p) {
  // Extension-aware canonicalization: an extensionless resolution and an explicit-extension
  // resolution of the same real file must compare equal.
  return p; // resolve*() above already return the real on-disk path (with its true extension),
  // so both sides are already canonical; kept as a named no-op for clarity at the call site.
}

function extractOrderedLiterals(content) {
  const re = new RegExp(RELATIVE_LITERAL.source, "g");
  const out = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    out.push(m[2]);
  }
  return out;
}

function runSpecifierTargetCheck() {
  let checkedSites = 0;
  for (const entry of inScope) {
    const oldContent = readOld(entry.oldPath);
    const newAbs = path.join(REPO_ROOT, entry.newPath);
    if (oldContent === null || !fs.existsSync(newAbs)) continue;
    const newContent = fs.readFileSync(newAbs, "utf8");

    const oldLiterals = extractOrderedLiterals(oldContent);
    const newLiterals = extractOrderedLiterals(newContent);
    if (oldLiterals.length !== newLiterals.length) {
      fail(
        `Specifier-target check: ${entry.oldPath} -> ${entry.newPath} has ${oldLiterals.length} ` +
          `relative literal(s) before the move and ${newLiterals.length} after — an import was ` +
          `added or removed, not just re-pointed.`,
      );
      continue;
    }

    for (let i = 0; i < oldLiterals.length; i++) {
      const oldLiteral = oldLiterals[i];
      const newLiteral = newLiterals[i];
      const oldTarget = resolveAgainstBaseline(entry.oldPath, oldLiteral);
      const newTarget = resolveAgainstCurrent(entry.newPath, newLiteral);
      checkedSites++;

      if (oldTarget === null) {
        fail(
          `Specifier-target check: ${entry.oldPath} site ${i}: "${oldLiteral}" does not resolve ` +
            `against BASE=${BASE} — unresolvable is a FAILURE, never a skip.`,
        );
        continue;
      }
      if (newTarget === null) {
        fail(
          `Specifier-target check: ${entry.newPath} site ${i}: "${newLiteral}" does not resolve ` +
            `against the current tree — unresolvable is a FAILURE, never a skip.`,
        );
        continue;
      }
      const expectedNewTarget = canonicalizeExt(renameByOld.get(oldTarget) || oldTarget);
      const actualNewTarget = canonicalizeExt(newTarget);
      if (expectedNewTarget !== actualNewTarget) {
        fail(
          `Specifier-target check: ${entry.newPath} site ${i}: "${oldLiteral}" resolved to ` +
            `${oldTarget} pre-move (expected post-move target ${expectedNewTarget}), but the current ` +
            `specifier "${newLiteral}" resolves to ${actualNewTarget} instead.`,
        );
      }
    }
  }
  console.log(
    `Specifier-target check: ${checkedSites} sites resolved and compared across ${inScope.length} in-scope files.`,
  );
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------
await runContentCheck();
runSiteCheck();
runSpecifierTargetCheck();

console.log("");
if (failures > 0) {
  console.error(`check-move-integrity: ${failures} failure(s).`);
  process.exit(1);
} else {
  console.log("check-move-integrity: all checks passed.");
  process.exit(0);
}
