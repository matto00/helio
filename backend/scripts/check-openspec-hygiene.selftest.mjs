#!/usr/bin/env node
// Self-test for scripts/check-openspec-hygiene.mjs (design.md D12). Spawns the
// real script as a subprocess against small fixture git repositories built
// under os.tmpdir() -- never inside this repository -- and asserts on the
// script's stdout/stderr TEXT, never on exit code alone (D9: a crash and a
// real report both exit 1 from that script, indistinguishable by exit code).
//
// Not a jest test: D12 gives three measured reasons (openspec is a global
// binary absent from package.json; jest.config.cjs's testPathIgnorePatterns
// unanchored-substring-excludes everything under .claude/worktrees/, which is
// exactly where the executor/evaluator/skeptic verify; .test.mjs does not
// match testMatch anyway).
//
// Wired into package.json as `check:openspec:selftest` and into
// .husky/pre-commit after `check:openspec`.

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gitChildEnv, nonGitChildEnv } from "./lib/git-child-env.mjs";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "check-openspec-hygiene.mjs");
const OPENSPEC_ENV = { OPENSPEC_TELEMETRY: "0", DO_NOT_TRACK: "1" };
// Pin the fixture git identity so the self-test cannot depend on the
// developer's global git config (task 2.2) -- this repo uses a repo-local
// identity, so a contributor with no global identity, or `commit.gpgsign=true`,
// would otherwise have EVERY commit in this repo blocked by this gate.
const GIT_IDENTITY = [
  "-c",
  "user.name=Selftest Fixture",
  "-c",
  "user.email=selftest@example.invalid",
  "-c",
  "commit.gpgsign=false",
];
const DAY = 24 * 60 * 60;

// Repo-locating env vars git sets ABSOLUTE for hook subprocesses running
// during a commit made from a `git worktree` checkout -- GIT_DIR wins over
// `cwd`-based repository discovery unconditionally, regardless of `cwd`.
// Child `git` gets an explicit minimal environment (allowlist, not denylist)
// so `cwd: repoDir` is authoritative and no ambient variable can redirect a
// fixture command onto the real repository. The mechanism, the incident it
// caused, and why the original denylist was the wrong shape are documented in
// scripts/lib/git-child-env.mjs. See HEL-805.
//
// Cases that deliberately backdate a COMMIT (2.7, 2.9) pass their own
// GIT_AUTHOR_DATE/GIT_COMMITTER_DATE via `extra`, which is applied AFTER the
// allowlist, so an intentional value still wins. (2.8 backdates filesystem
// mtimes via backdateRecursive instead of a commit and never passes `extra`.)

let passed = 0;
let failed = 0;
const fixtures = [];

function record(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail) console.log(`        ${detail.split("\n").join("\n        ")}`);
  }
}

function git(repoDir, args, env = {}) {
  return execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    env: gitChildEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commitAll(repoDir, message, dateEnv = {}) {
  git(repoDir, ["add", "-A"]);
  git(repoDir, [...GIT_IDENTITY, "commit", "-q", "-m", message], dateEnv);
}

function amendNow(repoDir) {
  // Preserves the existing author date, resets committer date to now --
  // the same shape a real rebase leaves behind (measured probe, design.md D5).
  git(repoDir, [...GIT_IDENTITY, "commit", "--amend", "-q", "--no-edit"]);
}

function writeChange(repoDir, name, { checked = 2, total = 2 } = {}) {
  const dir = join(repoDir, "openspec/changes", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "proposal.md"), "## Why\ntest\n\n## What Changes\ntest\n");
  const lines = ["## 1. Work"];
  for (let i = 1; i <= total; i++) {
    lines.push(`- [${i <= checked ? "x" : " "}] 1.${i} task ${i}`);
  }
  writeFileSync(join(dir, "tasks.md"), lines.join("\n") + "\n");
  return dir;
}

function ensureArchiveDir(repoDir) {
  mkdirSync(join(repoDir, "openspec/changes/archive"), { recursive: true });
}

function seedMain(repoDir) {
  writeFileSync(join(repoDir, "README.md"), "seed\n");
  commitAll(repoDir, "seed main");
}

function backdateRecursive(path, epochSeconds) {
  const st = statSync(path);
  utimesSync(path, epochSeconds, epochSeconds);
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) backdateRecursive(join(path, entry), epochSeconds);
  }
}

function makeRepo(prefix = "openspec-hygiene-selftest-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtures.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  return dir;
}

function makePlainDir(prefix = "openspec-hygiene-selftest-nogit-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtures.push(dir);
  return dir;
}

function runScript(targetDir, env = {}) {
  // spawnSync (not execFileSync) -- execFileSync only returns stdout on a
  // zero-exit run and discards stderr entirely on that path, which would
  // silently hide every stderr notice this script emits on its exit-0
  // (exempt) path. spawnSync always returns both regardless of exit code.
  const res = spawnSync("node", [scriptPath, targetDir], {
    encoding: "utf8",
    // The script under test is our own node script, not `git` -- it needs the
    // ambient node/npm environment, so a strict allowlist would be wrong here.
    // Strip the GIT_* namespace by prefix instead, so it cannot inherit a
    // GIT_DIR that would point it at the real repo rather than `targetDir`.
    env: nonGitChildEnv({ ...OPENSPEC_ENV, ...env }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function evidence(res) {
  return `status=${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`;
}

function caseEscaped() {
  const repo = makeRepo();
  ensureArchiveDir(repo);
  writeChange(repo, "escaped-change");
  commitAll(repo, "add escaped-change, on main");
  const res = runScript(repo);
  record(
    "2.6 FIRES - escaped: complete change committed on base branch",
    res.status === 1 && /escaped-change/.test(res.stderr) && /reachable from main/.test(res.stderr),
    evidence(res),
  );
}

function caseStaleTracked() {
  const repo = makeRepo();
  ensureArchiveDir(repo);
  seedMain(repo);
  git(repo, ["checkout", "-q", "-b", "feature"]);
  writeChange(repo, "stale-tracked-change");
  const old = Math.floor(Date.now() / 1000) - 20 * DAY;
  const dateStr = `@${old} +0000`;
  commitAll(repo, "add stale-tracked-change", {
    GIT_AUTHOR_DATE: dateStr,
    GIT_COMMITTER_DATE: dateStr,
  });
  const res = runScript(repo);
  record(
    "2.7 FIRES - stale (tracked): backdated author date on a branch absent from base",
    res.status === 1 &&
      /stale-tracked-change/.test(res.stderr) &&
      /inactive for 20d/.test(res.stderr) &&
      !/reachable from/.test(res.stderr),
    evidence(res),
  );
}

function caseStaleUntracked() {
  const repo = makeRepo();
  ensureArchiveDir(repo);
  seedMain(repo);
  const dir = writeChange(repo, "stale-untracked-change");
  const old = Math.floor(Date.now() / 1000) - 20 * DAY;
  backdateRecursive(dir, old);
  const res = runScript(repo);
  record(
    "2.8 FIRES - stale (untracked): never committed, dir AND every entry backdated",
    res.status === 1 &&
      /stale-untracked-change/.test(res.stderr) &&
      /inactive for 20d/.test(res.stderr),
    evidence(res),
  );
}

function caseRebaseDoesNotReset() {
  const repo = makeRepo();
  ensureArchiveDir(repo);
  seedMain(repo);
  git(repo, ["checkout", "-q", "-b", "feature"]);
  writeChange(repo, "rebased-stale-change");
  const old = Math.floor(Date.now() / 1000) - 20 * DAY;
  const dateStr = `@${old} +0000`;
  commitAll(repo, "add rebased-stale-change", {
    GIT_AUTHOR_DATE: dateStr,
    GIT_COMMITTER_DATE: dateStr,
  });
  amendNow(repo); // moves committer date to now, author date holds
  const res = runScript(repo);
  record(
    "2.9 FIRES - rebase does not reset the clock (%at vs %ct control)",
    res.status === 1 &&
      /rebased-stale-change/.test(res.stderr) &&
      /inactive for 20d/.test(res.stderr),
    evidence(res),
  );
}

function caseInFlight() {
  const repo = makeRepo();
  ensureArchiveDir(repo);
  seedMain(repo);
  git(repo, ["checkout", "-q", "-b", "feature"]);
  writeChange(repo, "in-flight-change");
  commitAll(repo, "add in-flight-change");
  const res = runScript(repo);
  record(
    "2.10 DOES NOT FIRE - in flight: feature branch, committed now, absent from base (AC1)",
    res.status === 0 &&
      /in-flight-change/.test(res.stdout) &&
      /complete but in flight/.test(res.stdout),
    evidence(res),
  );
}

function caseFreshUntracked() {
  const repo = makeRepo();
  ensureArchiveDir(repo);
  seedMain(repo);
  writeChange(repo, "fresh-untracked-change");
  const res = runScript(repo);
  record(
    "2.11 DOES NOT FIRE - freshly written, never committed, mtime now",
    res.status === 0 &&
      /fresh-untracked-change/.test(res.stdout) &&
      /complete but in flight/.test(res.stdout),
    evidence(res),
  );
}

function caseNoBaseRef() {
  // Neither `main` nor `origin/main` may resolve, but `git log` must still
  // behave normally (empty success, not a fatal error) so this case isolates
  // "no resolvable base ref" from "unborn repo" (measured probe: a truly
  // unborn HEAD makes `git log -1 -- <path>` fail outright for ANY path,
  // which correctly routes into the D6 "predicate failed -> unknown ->
  // report" branch instead -- not what this case means to exercise). Use a
  // differently-named branch with real history instead of an unborn one.
  const repo = mkdtempSync(join(tmpdir(), "openspec-hygiene-selftest-nobase-"));
  fixtures.push(repo);
  git(repo, ["init", "-q", "-b", "trunk"]);
  ensureArchiveDir(repo);
  seedMain(repo);
  writeChange(repo, "no-base-ref-change");
  const res = runScript(repo);
  record(
    "2.12 degradation A - unresolvable base ref: staleness alone (stderr notice)",
    /could not resolve origin\/main or main/.test(res.stderr) && /staleness/.test(res.stderr),
    evidence(res),
  );
  record(
    "2.12 degradation A - unresolvable base ref: fresh change still exempt",
    res.status === 0 && /complete but in flight/.test(res.stdout),
    evidence(res),
  );
}

function caseNonGitDir() {
  const dir = makePlainDir();
  mkdirSync(join(dir, "openspec/changes/archive"), { recursive: true });
  writeChange(dir, "non-git-change");
  const res = runScript(dir);
  record(
    "2.12 degradation B - non-git directory: reports unconditionally (stderr notice)",
    /is not a git repository/.test(res.stderr) && /legacy unconditional reporting/.test(res.stderr),
    evidence(res),
  );
  record(
    "2.12 degradation B - non-git directory: reports the complete change",
    res.status === 1 && /non-git-change/.test(res.stderr),
    evidence(res),
  );
}

function caseCorruptRef() {
  const repo = makeRepo();
  ensureArchiveDir(repo);
  seedMain(repo);
  // Point origin/main at an absent object: resolution succeeds (git
  // rev-parse --verify --quiet returns the recorded SHA even though the
  // object is missing), then `ls-tree` fails outright (measured probe).
  mkdirSync(join(repo, ".git/refs/remotes/origin"), { recursive: true });
  writeFileSync(
    join(repo, ".git/refs/remotes/origin/main"),
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n",
  );
  writeChange(repo, "corrupt-ref-change"); // fresh + untracked; would be exempt but for the predicate failure
  const res = runScript(repo);
  record(
    "2.12 degradation C - predicate fails outright (dangling origin/main): unknown -> reports (stderr notice)",
    /could not evaluate whether "corrupt-ref-change" is reachable/.test(res.stderr),
    evidence(res),
  );
  record(
    "2.12 degradation C - predicate fails outright: exit 1, reported",
    res.status === 1 && /corrupt-ref-change/.test(res.stderr),
    evidence(res),
  );
}

function caseStrayFile() {
  const repo = makeRepo();
  ensureArchiveDir(repo);
  writeFileSync(join(repo, "openspec/changes/README.txt"), "stray\n");
  const res = runScript(repo);
  record(
    "2.13 rule 2 preserved - stray file in openspec/changes/",
    res.status === 1 && /stray file in openspec\/changes\/: README\.txt/.test(res.stderr),
    evidence(res),
  );
}

function caseLeftoverHandoff() {
  const repo = makeRepo();
  mkdirSync(join(repo, "openspec/changes/archive/2026-01-01-old-change"), { recursive: true });
  writeFileSync(
    join(repo, "openspec/changes/archive/2026-01-01-old-change/files-modified.md"),
    "- foo\n",
  );
  const res = runScript(repo);
  record(
    "2.13 rule 3 preserved - leftover files-modified.md in an archived change",
    res.status === 1 &&
      /archive\/2026-01-01-old-change\/files-modified\.md is an executor handoff/.test(res.stderr),
    evidence(res),
  );
}

function caseNoArchiveDir() {
  const repo = makeRepo();
  mkdirSync(join(repo, "openspec/changes"), { recursive: true }); // deliberately no archive/
  const res = runScript(repo);
  record(
    "2.13 / 1.12 - missing archive/ directory does not crash",
    res.status === 0 && /openspec\/ is clean/.test(res.stdout),
    evidence(res),
  );
}

function caseNoCompleteChange() {
  const repo = makeRepo();
  ensureArchiveDir(repo);
  writeChange(repo, "in-progress-change", { checked: 1, total: 2 });
  const res = runScript(repo);
  record(
    "2.13 - no fully-checked change present emits no exempt diagnostic",
    res.status === 0 && !/complete but in flight/.test(res.stdout),
    evidence(res),
  );
}

function caseInvalidThreshold() {
  const repo = makeRepo();
  ensureArchiveDir(repo);
  seedMain(repo);
  git(repo, ["checkout", "-q", "-b", "feature"]);
  writeChange(repo, "invalid-threshold-change");
  commitAll(repo, "add invalid-threshold-change");
  const res = runScript(repo, { OPENSPEC_HYGIENE_STALE_DAYS: "-5" });
  record(
    "2.13 - invalid OPENSPEC_HYGIENE_STALE_DAYS falls back to the 14d default",
    res.status === 0 && /complete but in flight/.test(res.stdout),
    evidence(res),
  );
}

function main() {
  const start = Date.now();
  console.log("check-openspec-hygiene.selftest: running fixture cases against a real subprocess\n");
  try {
    caseEscaped();
    caseStaleTracked();
    caseStaleUntracked();
    caseRebaseDoesNotReset();
    caseInFlight();
    caseFreshUntracked();
    caseNoBaseRef();
    caseNonGitDir();
    caseCorruptRef();
    caseStrayFile();
    caseLeftoverHandoff();
    caseNoArchiveDir();
    caseNoCompleteChange();
    caseInvalidThreshold();
  } finally {
    for (const dir of fixtures) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; do not mask the real result
      }
    }
  }
  const elapsedMs = Date.now() - start;
  const total = passed + failed;
  console.log(`\n${passed} passed, ${failed} failed, ${total} total (${elapsedMs}ms)`);
  if (total === 0) {
    console.error("check-openspec-hygiene.selftest: zero cases ran — treating this as a failure.");
    process.exit(1);
  }
  if (failed > 0) {
    process.exit(1);
  }
}

main();
