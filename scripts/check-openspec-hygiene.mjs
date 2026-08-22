#!/usr/bin/env node
// Catches OpenSpec drift that should be cleaned up before commit:
//   1. Active changes that are OVERDUE for archival, or have no tasks.
//      A fully-checked (100%) change is reported only when it is overdue --
//      either "escaped" (reachable from the base branch, i.e. it reached the
//      mainline still unarchived) or "stale" (no activity within
//      OPENSPEC_HYGIENE_STALE_DAYS, default 14). A fully-checked change that
//      is neither is in flight (e.g. an executor's mid-Execution commit,
//      before the orchestrator's separate Phase 3 archive step) and is
//      exempt -- see openspec/changes/scope-archival-hygiene-rule/design.md
//      (D1). When both escaped and stale hold, both reasons are reported.
//      Every fully-checked change this rule examines and exempts prints a
//      diagnostic naming it and why (D13), so "examined and exempted" is
//      distinguishable from "did nothing".
//   2. Stray files in `openspec/changes/` (should only contain change dirs + `archive/`).
//   3. Executor handoff files (`files-modified.md`) left behind in archived changes.
//
// Env:
//   OPENSPEC_HYGIENE_STALE_DAYS  Staleness threshold in days (default 14). A
//                                non-integer or non-positive value falls back
//                                to the default.
//
// Usage: node check-openspec-hygiene.mjs [targetRoot]
//   targetRoot defaults to the repo this script lives in (mirrors
//   scripts/check-spec-structure.mjs). Every path, the `openspec list --json`
//   cwd, and every `git` invocation are pinned to targetRoot (D10) so this
//   script can also run against a fixture repo (see the self-test).
//
// Degradation (D6): a predicate that cannot be evaluated (throws, or returns
// unparsable output) means "unknown -> report", plus a stderr notice naming
// what failed -- never a silent false. An unresolvable base ref means
// "decide on staleness alone". Git being unavailable, or the target not
// being a git repository, means legacy unconditional reporting of every
// complete change, plus an explicit stderr notice.
//
// Every `openspec` child process asserts on stdout, never on `$?` --
// `openspec archive` exits 0 even when it aborts (D9) -- and disables
// telemetry (`OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1`) for speed and to
// avoid a third-party network call at pre-commit (D14).

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_STALE_DAYS = 14;
const OPENSPEC_ENV = { OPENSPEC_TELEMETRY: "0", DO_NOT_TRACK: "1" };

// Repo-locating env vars git sets ABSOLUTE for hook subprocesses running
// during a commit made from a `git worktree` checkout -- GIT_DIR wins over
// `cwd`-based repository discovery unconditionally. Left inherited, every
// `git` call below would silently operate against the repo git resolved
// them for (the checkout the commit is running in), not `targetRoot`
// (measured: a real pre-commit-hook run against a fixture repo elsewhere
// under targetRoot redirected onto the actual worktree's refs). Stripped
// from every child `git` invocation so `cwd: targetRoot` is authoritative.
const GIT_REPO_LOCATING_ENV_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];

function gitChildEnv() {
  const env = { ...process.env };
  for (const key of GIT_REPO_LOCATING_ENV_VARS) delete env[key];
  return env;
}

const scriptRepoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = process.argv[2] ? join(process.argv[2]) : scriptRepoRoot;
const changesDir = join(targetRoot, "openspec/changes");
const archiveDir = join(changesDir, "archive");

const errors = [];
const notices = [];
const exemptDiagnostics = [];

function staleDaysThreshold() {
  const raw = process.env.OPENSPEC_HYGIENE_STALE_DAYS;
  if (raw === undefined) return DEFAULT_STALE_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_STALE_DAYS;
  return n;
}

// Every git invocation is pinned to targetRoot and captures its own stderr
// (D10, task 1.11) so git's `fatal:` lines never leak to the terminal ahead
// of this script's own notice.
function runGit(args) {
  try {
    const stdout = execFileSync("git", args, {
      cwd: targetRoot,
      encoding: "utf8",
      env: gitChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function isGitRepo() {
  const r = runGit(["rev-parse", "--is-inside-work-tree"]);
  return r.ok && r.stdout.trim() === "true";
}

// git rev-parse --verify --quiet origin/main, then main; null if neither
// resolves (task 1.4).
function resolveBaseRef() {
  for (const ref of ["origin/main", "main"]) {
    const r = runGit(["rev-parse", "--verify", "--quiet", ref]);
    if (r.ok && r.stdout.trim()) return ref;
  }
  return null;
}

// "Escaped": the change directory is reachable from the base branch
// (task 1.5, D10). --full-tree and cwd: targetRoot are both required --
// without either, this silently returns false from a subdirectory.
function evaluateEscaped(name, baseRef) {
  const pathspec = `openspec/changes/${name}`;
  const r = runGit(["ls-tree", "--full-tree", baseRef, "--", pathspec]);
  if (!r.ok) {
    return { known: false, detail: r.error.message };
  }
  return { known: true, escaped: r.stdout.trim().length > 0 };
}

// Newest mtime among a directory and ALL of its entries, recursively (task
// 1.7) -- a top-level-only walk misses a nested specs/<cap>/spec.md edit,
// and the parent directory's own mtime does not advance when a descendant
// file is edited in place. The directory's own mtime is included in the max.
function newestMtimeSeconds(root) {
  let maxMs = statSync(root).mtimeMs;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.mtimeMs > maxMs) maxMs = st.mtimeMs;
      if (st.isDirectory()) walk(full);
    }
  };
  walk(root);
  return Math.floor(maxMs / 1000);
}

// "Stale": last activity is older than the threshold (task 1.6/1.7, D5).
// AUTHOR date (%at), not committer date (%ct) -- a rebase resets %ct to now
// while %at holds, which would let a repeatedly-rebased branch reset the
// staleness clock indefinitely. When the change directory has no commits at
// all, fall back to the newest filesystem mtime among it and its entries.
function evaluateStale(name, staleDays, nowSeconds) {
  const pathspec = `openspec/changes/${name}`;
  const r = runGit(["log", "-1", "--format=%at", "--", pathspec]);
  if (!r.ok) {
    return { known: false, detail: r.error.message };
  }
  const trimmed = r.stdout.trim();
  let epochSeconds;
  if (trimmed === "") {
    try {
      epochSeconds = newestMtimeSeconds(join(changesDir, name));
    } catch (e) {
      return { known: false, detail: `mtime fallback failed: ${e.message}` };
    }
  } else {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return {
        known: false,
        detail: `unparsable \`git log --format=%at\` output: ${JSON.stringify(trimmed)}`,
      };
    }
    epochSeconds = parsed;
  }
  const ageSeconds = nowSeconds - epochSeconds;
  const ageDays = Math.floor(ageSeconds / 86400);
  return { known: true, stale: ageSeconds > staleDays * 86400, ageDays };
}

function evaluateOverdue(change, gitOk, baseRef, staleDays, nowSeconds) {
  const reasons = [];
  let unknown = false;
  let ageDaysForExempt = null;

  if (baseRef) {
    const escapedResult = evaluateEscaped(change.name, baseRef);
    if (!escapedResult.known) {
      unknown = true;
      notices.push(
        `openspec-hygiene: could not evaluate whether "${change.name}" is reachable from ${baseRef}: ${escapedResult.detail}`,
      );
    } else if (escapedResult.escaped) {
      reasons.push(`reachable from ${baseRef}`);
    }
  }

  const staleResult = evaluateStale(change.name, staleDays, nowSeconds);
  if (!staleResult.known) {
    unknown = true;
    notices.push(
      `openspec-hygiene: could not evaluate staleness for "${change.name}": ${staleResult.detail}`,
    );
  } else {
    ageDaysForExempt = staleResult.ageDays;
    if (staleResult.stale) {
      reasons.push(`inactive for ${staleResult.ageDays}d (threshold ${staleDays}d)`);
    }
  }

  return { unknown, reasons, ageDaysForExempt };
}

function main() {
  let listJson;
  try {
    const out = execFileSync("openspec", ["list", "--json"], {
      cwd: targetRoot,
      encoding: "utf8",
      env: { ...process.env, ...OPENSPEC_ENV },
    });
    listJson = JSON.parse(out);
  } catch (e) {
    console.error("Failed to run `openspec list --json`:", e.message);
    process.exit(2);
  }

  const gitOk = isGitRepo();
  let baseRef = null;
  if (gitOk) {
    baseRef = resolveBaseRef();
    if (!baseRef) {
      notices.push(
        "openspec-hygiene: could not resolve origin/main or main as a base ref; evaluating archival staleness only.",
      );
    }
  } else {
    notices.push(
      `openspec-hygiene: git is unavailable, or ${targetRoot} is not a git repository; falling back to legacy unconditional reporting of complete changes.`,
    );
  }

  const staleDays = staleDaysThreshold();
  const nowSeconds = Math.floor(Date.now() / 1000);

  for (const change of listJson.changes ?? []) {
    if (change.status === "no-tasks") {
      errors.push(
        `change "${change.name}" has no tasks — finish the proposal or remove the directory`,
      );
      continue;
    }
    if (change.status !== "complete") continue;

    const label = `change "${change.name}" is complete (${change.completedTasks}/${change.totalTasks}) but not archived`;
    const runArchive = `run \`openspec archive ${change.name}\``;

    if (!gitOk) {
      errors.push(`${label} — ${runArchive}`);
      continue;
    }

    const { unknown, reasons, ageDaysForExempt } = evaluateOverdue(
      change,
      gitOk,
      baseRef,
      staleDays,
      nowSeconds,
    );

    if (unknown) {
      errors.push(
        `${label} — archival-overdue condition could not be fully evaluated (see stderr notice above) — ${runArchive}`,
      );
      continue;
    }

    if (reasons.length > 0) {
      errors.push(`${label} — overdue: ${reasons.join(" AND ")} — ${runArchive}`);
      continue;
    }

    // Exempt: examined, not overdue (D13) -- distinguishes "examined and
    // exempted" from "did nothing".
    const baseLabel = baseRef ?? "no resolvable base branch";
    const ageLabel = ageDaysForExempt === null ? "unknown" : `${ageDaysForExempt}d`;
    exemptDiagnostics.push(
      `openspec/changes/${change.name}: complete but in flight (absent from ${baseLabel}, last activity ${ageLabel} ago)`,
    );
  }

  // 2. Stray entries in openspec/changes/
  for (const entry of readdirSync(changesDir)) {
    const full = join(changesDir, entry);
    const isDir = statSync(full).isDirectory();
    if (!isDir) {
      errors.push(`stray file in openspec/changes/: ${entry} — remove or move into a change dir`);
    }
  }

  // 3. Leftover executor handoff in archived changes. A missing archive/
  // directory means "no archived changes", not a crash (D15) -- readdirSync
  // throwing ENOENT here used to exit 1, indistinguishable by exit code from
  // a real report.
  let archiveEntries;
  try {
    archiveEntries = readdirSync(archiveDir);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    archiveEntries = [];
  }
  for (const entry of archiveEntries) {
    const full = join(archiveDir, entry);
    if (!statSync(full).isDirectory()) continue;
    try {
      statSync(join(full, "files-modified.md"));
      errors.push(
        `archive/${entry}/files-modified.md is an executor handoff and should not persist — delete it`,
      );
    } catch {
      // not present, fine
    }
  }

  for (const n of notices) console.error(n);
  for (const d of exemptDiagnostics) console.log(d);

  if (errors.length) {
    console.error("OpenSpec hygiene issues:\n");
    for (const e of errors) console.error("  - " + e);
    console.error("");
    process.exit(1);
  }

  console.log("openspec/ is clean");
}

main();
