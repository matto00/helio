- `scripts/check-openspec-hygiene.mjs` — replaced rule 1's unconditional `status === "complete"` trigger with the
  escaped-OR-stale overdue test (D1); added the `[targetRoot]` argument (D11), `OPENSPEC_TELEMETRY=0`/`DO_NOT_TRACK=1`
  on every `openspec` invocation (D14), the base-ref resolver, the escaped/stale predicates pinned to `targetRoot`
  with `--full-tree` (D10), the recursive-mtime untracked fallback (D5), `OPENSPEC_HYGIENE_STALE_DAYS` threshold
  handling, the per-change exempt diagnostic (D13), D6 degradation (unknown → report, unresolved base ref →
  staleness-only, git-unavailable → legacy unconditional reporting — each with a stderr notice), and the
  missing-`archive/`-directory guard (D15). Rules 2 and 3 are otherwise unchanged. **`runGit`'s `gitChildEnv()`
  strips `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_COMMON_DIR`/`GIT_OBJECT_DIRECTORY`/
  `GIT_ALTERNATE_OBJECT_DIRECTORIES` from every child `git` invocation** — git sets these ABSOLUTE for hook
  subprocesses during a commit made from a `git worktree` checkout, which otherwise silently overrides
  `cwd`-based repo discovery (found live in this delivery: a real pre-commit run redirected fixture git calls
  onto this worktree's own branch; root-caused, repaired via `git reset` to the pre-existing base with the
  working tree confirmed untouched, then re-verified by explicitly injecting the leaked values).
- `scripts/check-openspec-hygiene.selftest.mjs` — new. Spawns the real script as a subprocess against fixture git
  repositories built under `os.tmpdir()`, asserting on stdout/stderr message text (never exit code alone, D9).
  Covers escaped, tracked-stale, untracked-stale, the rebase author-vs-committer-date control, two in-flight
  (exempt) cases, three D6 degradation branches, rules 2/3 preservation, the missing-archive-dir guard, the
  no-exempt-diagnostic-when-nothing-complete case, and the invalid-threshold fallback (D12). Its own `git()`
  helper strips the same repo-locating vars as above, PLUS `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`/
  `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` (evaluator finding, cycle 1):
  git also sets these for hook subprocesses during `rebase`/`commit --amend`, and left inherited they silently
  backdate/re-author fixture commits for any contributor who happens to have them exported (measured:
  `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` poisoned to `2020-01-01` turned 2.10/2.13 red). Stripped by default in
  `gitChildEnv()`; a case's own explicit date (2.7, 2.8, 2.9) is applied AFTER stripping so it still wins.
- `package.json` — added the `check:openspec:selftest` script entry.
- `.husky/pre-commit` — wired `npm run check:openspec:selftest` in immediately after `npm run check:openspec`,
  leaving every other line (including `typecheck` and `check:spec-structure`) intact and in order.
- `openspec/changes/scope-archival-hygiene-rule/tasks.md` — all 37 tasks marked complete.
