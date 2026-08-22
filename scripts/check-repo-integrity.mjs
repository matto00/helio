#!/usr/bin/env node
/**
 * Fast tripwire for repository-level corruption that is silent, survives
 * across commits, and surfaces far away from its cause.
 *
 * WHY
 * ---
 * On 2026-08-21 a pre-commit gate shelling out to `git init` inherited git's
 * hook-exported `GIT_DIR` and re-initialised this repository as bare, writing
 * `core.bare = true` into the shared config. Because `core.bare` is a common
 * (non-worktree-scoped) key, every linked worktree kept working normally while
 * the main checkout was unusable. Nothing noticed for ~70 minutes; the damage
 * finally surfaced as an unrelated ticket that could not create a worktree,
 * and cost hours of forensics to trace back. See HEL-805.
 *
 * The leak itself is fixed (scripts/lib/git-child-env.mjs). This check exists
 * because the CLASS of bug -- a hook subprocess quietly reconfiguring the repo
 * it runs inside -- is not closed by fixing one instance of it. A corrupted
 * repo state that goes unnoticed for an hour is a different problem from one
 * that fails the very next commit with an explanation.
 *
 * Deliberately narrow: one git call, no filesystem walk, no network. It runs
 * on every commit in every worktree, so it must stay in the low milliseconds.
 * Add a check here only if it is that cheap and that unambiguous.
 */

import { execFileSync } from "node:child_process";
import { gitChildEnv } from "./lib/git-child-env.mjs";

/**
 * Read a git config key, treating "unset" as distinct from "empty".
 * `git config --get` exits 1 when the key is absent, which is not an error.
 */
function readConfig(key) {
  try {
    return execFileSync("git", ["config", "--get", key], {
      encoding: "utf8",
      env: gitChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return undefined;
  }
}

const problems = [];

// `core.bare = true` on a repo that has a working tree. Checked rather than
// inferred: reading the flag directly is what distinguishes this from the
// dozens of downstream symptoms it produces (`fatal: this operation must be
// run in a work tree`, a root that reports `(bare)`, a fast-forward that moves
// the ref but not the tree, and a resulting diff that looks like staged
// deletions reverting a merged ticket -- all one flag, none of them damage).
if (readConfig("core.bare") === "true") {
  problems.push(
    [
      "core.bare is true — this repository has been re-initialised as bare.",
      "",
      "  Most likely cause: a process shelled out to `git init` (or another",
      "  repo-creating command) while inheriting git's hook-exported GIT_DIR.",
      "  From a linked worktree that value is <repo>/.git/worktrees/<name>,",
      "  whose basename is not `.git`, so git guesses `bare`.",
      "",
      "  Your work is not lost — this is a single config flag. To repair:",
      "    git config core.bare false",
      "    git rev-parse --is-inside-work-tree     # expect: true",
      "    git status --short                      # inspect BEFORE resyncing",
      "",
      "  If the working tree is stale (HEAD ahead of the checkout), restore the",
      "  affected paths explicitly rather than with `git reset --hard`, which",
      "  would discard unrelated local edits along with the stale ones.",
    ].join("\n"),
  );
}

if (problems.length > 0) {
  console.error("Repository integrity check failed:\n");
  for (const p of problems) console.error(`  ${p.split("\n").join("\n  ")}\n`);
  process.exit(1);
}
