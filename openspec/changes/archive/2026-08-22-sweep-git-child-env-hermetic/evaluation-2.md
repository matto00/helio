## Evaluation Report — Cycle 2 (evaluation-2.md)

### Phase 1: Spec Review — PASS
Issues: none.

Re-scoped review against commit 89fbe6a9 (the skeptic-final-1.md fix, on
top of the cycle-1 e19e51b7 baseline already reviewed in evaluation-1.md).
Ticket/proposal/design/tasks were not re-read (stable across cycles, per
resumability instructions) — this cycle verifies the fix and its test
coverage only.

- The bug: `setup-worktree.sh`'s `CONCERTINO_WORKTREE_HOOKS` loop previously
  ran `( cd "$WORKTREE_PATH" && unset -v $(compgen -v GIT_ ...) 2>/dev/null
  || true; eval "$hook" ... ) || true`. Because `&&` binds tighter than the
  trailing `;`, a failed `cd` short-circuited past the `unset` but the `;
  eval "$hook"` clause still ran unconditionally, in whatever cwd the
  subshell was actually in (the caller's, still poisoned) — exactly the
  class of bug this ticket exists to close.
- The fix (`scripts/concertino/setup-worktree.sh:357`): restructured to
  `cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null)
  2>/dev/null; eval "$hook" >/dev/null 2>&1`. A failed `cd` now exits the
  subshell immediately (`|| exit 0`) before `unset` or `eval` are ever
  reached; when `cd` succeeds, `unset` runs unconditionally (no longer
  gated behind `&&`) and `eval` only runs after both `cd` and the strip
  have happened. This closes the hazard correctly.

### Phase 2: Code Review — PASS
Issues: none.

**New regression case verified non-vacuous by reading it** (not just
trusting the executor's claim), in
`scripts/concertino/lib/git-child-env.selftest.sh`:
- Sets up a poisoned env, cd's to a real target dir first (establishing a
  known cwd), then attempts the eval-site pattern against a
  `$WORK/does-not-exist` directory that is never created.
- The hook string writes two marker files (`pwd > cwd-hook-output` and
  `git rev-parse --show-toplevel > hook-output`) if it ever runs.
- Assertion: FAIL if either marker file exists, PASS only if neither does.
- Traced by hand against the pre-fix pattern (`cd X && unset || true;
  eval`): if `cd` to the nonexistent dir fails, `&&` short-circuits so
  `unset` is skipped, but the trailing `; eval "$hook"` still executes
  unconditionally in the subshell's inherited (still-poisoned, real-repo)
  cwd — which would create both marker files and fail this new assertion.
  Confirms the test is a real, non-vacuous negative control for exactly the
  bug being fixed, not a tautology.
- Ran live: the new case triggers a `cd: ... No such file or directory`
  message (expected stderr from the deliberate failed cd) followed by
  `PASS: setup-worktree.sh CONCERTINO_WORKTREE_HOOKS eval-site pattern
  correctly skipped the hook entirely when cd failed`.
- The selftest's existing "eval-site strip" case (cd succeeds) was also
  updated in lockstep to mirror the fixed `cd || exit 0; unset; eval`
  sequence verbatim, so both the success and failure paths of the real
  `setup-worktree.sh` line are exercised.

**No other `&&`/`;` precedence hazard at any other `git_child` call site** —
checked every `git_child` invocation combined with `&&`/`||` across all four
scripts (`assert-phase.sh:154,156,158,160`, `cleanup.sh:108-115`,
`setup-worktree.sh:263`). All are single `git_child` commands with a
trailing `|| fallback` on that one command (`... 2>/dev/null || VAR=""`,
`... || return 0`, `... || { ... }`) — none of them chain a directory-change
before an unrelated command the way the fixed `cd`-then-`eval` site did, so
none carry the same short-circuit hazard.

Gates re-run fresh in `WORKTREE_PATH`:
- `npm run check:repo-integrity` — PASS
- `npm run lint` — PASS (0 warnings)
- `npm run typecheck` — PASS
- `npm run format:check` — PASS
- `npm run check:schemas` — PASS
- `npm run check:spec-structure` — PASS (320 canonical specs, 0 issues)
- `npm run check:openspec` — PASS
- `npm run check:openspec:selftest` — PASS (17/17)
- `npm run check:scala-quality` — PASS (130 pre-existing soft warnings, none
  newly introduced — this change touches no Scala)
- `npm test` (root jest + frontend jest) — PASS (254 suites / 2751 tests)
- `npm run selftest:concertino-git-env` — PASS, all assertions green
  including the new cd-failure case

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`,
`schemas/**`, or `openspec/specs/**` files changed in commit 89fbe6a9
(bash-only diff, confirmed by diff scope).

### Overall: PASS

### Non-blocking Suggestions
- None.
