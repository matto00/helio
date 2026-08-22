# HEL-805: Audit every concertino script that shells out to git from a pre-commit hook for the absolute GIT_DIR/GIT_INDEX_FILE leak

## Description

Spinoff of HEL-657. git exports absolute `GIT_DIR`/`GIT_INDEX_FILE` (plus
`GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES`) to hook subprocesses when a commit is
made from a linked `git worktree` checkout. Those variables override
`cwd`-based repository discovery, so any child `git` invocation that
inherits `process.env` operates on the wrong repository. HEL-657's incident:
a self-test's fixture `git init`, run as a live pre-commit hook child,
re-initialised the REAL repo as bare via the inherited `GIT_DIR`.

## RE-DERIVED SCOPE (ticket text is stale — filed during incident response,
before follow-on work landed on main; verified at b5a95c70)

Already DONE on main, do not redo:
- Shared hermetic-env helper: `scripts/lib/git-child-env.mjs`
  (`gitChildEnv`/`nonGitChildEnv`, allowlist-based). USE IT for any Node
  script; do not write a second helper.
- Tripwire: `scripts/check-repo-integrity.mjs`, wired as the first gate in
  `.husky/pre-commit`, checks `core.bare` in ~17ms. Do not duplicate.
- `scripts/check-openspec-hygiene.mjs` and
  `scripts/check-openspec-hygiene.selftest.mjs` already route every child
  `git` through `gitChildEnv`.

REMAINING scope (verified by direct enumeration of the tree at b5a95c70):
- `scripts/check-repo-integrity.mjs` already imports `gitChildEnv` — verify
  it's used correctly, no action expected.
- No other `scripts/*.mjs`/`scripts/*.js` shell out to git (only `which`/
  `where` in check-spec-structure.mjs — out of scope).
- `scripts/concertino/*.sh` — ALL SIX are git-tracked despite the directory
  being gitignored (`git ls-files -v` confirms `H` = tracked for all of
  `.concertino.env`, `README.md`, `assert-phase.sh`, `cleanup.sh`,
  `setup-worktree.sh`, `start-servers.sh`). Of these, four shell out to git
  with `-C <target-dir>` where `<target-dir>` varies per call
  (`$REPO_ROOT`, `$WORKTREE_PATH`, `$base_worktree`):
  - `assert-phase.sh`
  - `cleanup.sh`
  - `setup-worktree.sh`
  - `start-servers.sh` (single `git rev-parse --show-toplevel`, no explicit
    `-C`, so cwd-dependent — same class of risk)

  These are not literal children of `.husky/pre-commit` today (the hook
  invokes only `npm run check:*`/`lint`/`typecheck`/`format:check`/`test`,
  none of which shell into `scripts/concertino/*.sh`). But `-C <dir>` does
  NOT protect against an inherited `GIT_DIR`/`GIT_INDEX_FILE` overriding
  discovery — per git's own precedence, the env variable wins over `-C`.
  Given these scripts run inside the concertino orchestration loop
  (executor/evaluator/orchestrator shells), and the whole point of HEL-805
  is defense-in-depth against ANY future invocation context leaking a
  poisoned `GIT_DIR` into these processes, they need the equivalent bash
  hermetic-env treatment.

## Acceptance criteria

1. Every child `git` invocation in `scripts/concertino/*.sh` that targets an
   explicit directory (`-C $REPO_ROOT`, `-C $WORKTREE_PATH`,
   `-C $base_worktree`, or an implicit cwd-based call) runs with the six
   repo-locating `GIT_*` variables (`GIT_DIR`, `GIT_INDEX_FILE`,
   `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`,
   `GIT_ALTERNATE_OBJECT_DIRECTORIES`) stripped from the child's
   environment, via one shared bash helper (mirroring
   `scripts/lib/git-child-env.mjs`'s allowlist rationale — do not duplicate
   per script).
2. A regression test simulates a poisoned hook environment (exports the six
   variables pointing at a throwaway fixture path) and asserts the affected
   `scripts/concertino/*.sh` git calls still target the directory they were
   told to (`-C`/cwd), not the poisoned `GIT_DIR`. Red-before-green: the
   test is demonstrated failing (in a throwaway repo, never this one) with
   the fix removed before being demonstrated passing with it in place.
3. `check-repo-integrity.mjs` stays a low-milliseconds check; nothing here
   adds to its runtime (it isn't touched).
4. Out of scope (do not touch): HEL-806 (selftest mutation-testing coverage
   gaps), CON-131 (cleanup.sh silent-exit-0 on failed git ops), CON-132
   (change-classification), HEL-799/HEL-734 (gitignored concertino files
   missing from worktrees).
