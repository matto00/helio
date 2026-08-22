## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All AC met: (1) helper is a `GIT_*`-prefix strip (`compgen -v GIT_`, not an
  enumerated six-name denylist) in `scripts/concertino/lib/git-child-env.sh`,
  matches `scripts/lib/git-child-env.mjs`'s `nonGitChildEnv` rationale cited
  in design.md's Decisions section. (2) Regression test
  (`git-child-env.selftest.sh`) is a permanent, non-vacuous dual-arm
  assertion — verified by reading the script, not just the claim: it runs
  the poisoned-env scenario twice (bare `git` vs `git_child`) against fresh
  fixture repos each time, asserting the bare arm reaches the poisoned repo
  and the `git_child` arm does not; this assertion runs unconditionally on
  every invocation, no manual hand-edit required. Red-before-green is
  demonstrated structurally by the test itself (the bare-git-arm assertion
  is the "red" case, permanently re-verified). All fixture/poison repos are
  built under `mktemp -d`; nothing touches the real repo. (3)
  `check-repo-integrity.mjs` untouched — confirmed by diff scope. (4) No
  HEL-806/CON-131/CON-132/HEL-799/HEL-734 work present.
- Every call site verified routed: `assert-phase.sh`, `cleanup.sh`,
  `setup-worktree.sh` (including bare/cwd calls and the
  `CONCERTINO_WORKTREE_HOOKS` eval loop), `start-servers.sh`. Grep for bare
  `git ` invocations outside `git_child` turned up only a string literal in
  an error message (`assert-phase.sh:110`, "not a git work tree" — not an
  invocation).
- Selftest strips `GIT_*` from its own process as its literal first
  executable statement, before any fixture build or poison export —
  confirmed by reading the file.
- `npm run selftest:concertino-git-env` is wired outside the `check:`
  namespace and is NOT added to `.husky/pre-commit` — confirmed in
  `package.json` and `.husky/pre-commit` diffs; a comment at both the
  npm-script site (design.md) and the hook site explains why.
- Tasks: 8/8 marked `[x]`, all match what was implemented; no items left
  unchecked.
- No scope creep: diff touches exactly the files named in proposal.md's
  Impact section plus `package.json`/`.husky/pre-commit` wiring — no
  unrelated changes.
- No regressions to other specs: infra-only, no product-facing capability
  touched.
- Spec delta (`specs/git-hook-hermeticity/spec.md`) reflects the final
  implemented behavior accurately, including the explicit note that this
  change archives with `--skip-specs` (infra-only, matching the
  `bump-brace-expansion-lockfile` precedent).

### Phase 2: Code Review — PASS
Issues: none.

Gates re-run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` gate at this
speed):
- `npm run check:repo-integrity` — PASS
- `npm run lint` — PASS (0 warnings)
- `npm run typecheck` — PASS
- `npm run format:check` — PASS
- `npm run check:schemas` — PASS
- `npm run check:spec-structure` — PASS (320 canonical specs, 0 issues)
- `npm run check:openspec` — PASS (openspec/ clean; change correctly
  reported as "in flight")
- `npm run check:openspec:selftest` — PASS (17/17)
- `npm run check:scala-quality` — PASS (130 pre-existing soft warnings,
  none newly introduced by this diff — this change touches no Scala)
- `npm test` (root jest + frontend jest) — PASS (254 suites / 2751 tests)
- `npm run selftest:concertino-git-env` (the new gate, run manually since
  it is deliberately outside `.husky/pre-commit`) — PASS, all 11 assertions
  green including the dual-arm non-vacuous check

Code-quality review (CONTRIBUTING.md; DESIGN.md N/A — no frontend/UI
touched):
- `git_child()` correctly defined as a `()` subshell (not `{ }`), confirmed
  the `unset` does not leak into the caller's environment by design.
- DRY: single shared helper, sourced by all four scripts — no duplication.
- Readable: clear function name, extensive doc-comment cross-referencing
  the Node-side sibling and the HEL-657 incident.
- No dead code, no TODO/FIXME left behind.
- No over-engineering: minimal helper (4 lines of actual logic), no
  speculative abstraction beyond what the ticket asked for.
- Error handling: `unset -v $(compgen -v GIT_ ...) || true` correctly
  tolerates the case where no `GIT_*` vars are set (`compgen -v` exits
  non-zero with empty output in that case, which would otherwise abort
  under `set -e` inside the scripts that source it — the `|| true` guards
  this).
- Tests meaningful: the dual-arm design specifically avoids the trivially-
  gameable trap of just asserting "the fix works" — it also proves the
  attack scenario is real on every run, which is a materially stronger
  regression guard than a typical single-arm test and would catch a real
  regression (e.g. someone reverting `git_child` to plain `git`, or the
  `compgen -v GIT_` expansion silently breaking on a future bash version).
- Behavior-preserving: all `git ... ` -> `git_child ...` replacements are
  pure substitutions (same arguments, same call sites); the
  `CONCERTINO_WORKTREE_HOOKS` eval-site change wraps the existing eval with
  an env-strip preamble, does not change what the hook does.

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`,
`schemas/**`, or `openspec/specs/**` (canonical, merged specs) files
changed — infra-only bash change, confirmed by diff stat.

### Overall: PASS

### Non-blocking Suggestions
- None beyond what's already good practice here; the implementation is
  tight and matches the design's explicit rationale for each decision
  (prefix-strip over denylist, `()` subshell, dual-arm test, npm-namespace
  placement) point for point.
