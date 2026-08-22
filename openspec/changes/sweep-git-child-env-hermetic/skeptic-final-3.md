## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Cold verification. Every conclusion below is derived from files/commands I ran
myself in this worktree, not from the executor's or prior skeptics' reports.

### What I verified (with evidence)

**1. design.md CR6 now documents the shipped fix, not the buggy draft** —
`design.md:60-86`. The bullet now explicitly labels the round-1 form
(`cd ... && unset ... || true; eval ...`) as "a real bug, not just a draft",
explains the `&&`/`;` precedence mechanism, and names the actual shipped form
(`cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ ...); eval "$hook"`)
as the verified-correct final one, attributed to commit 89fbe6a9. This matches
`setup-worktree.sh:357` byte-for-byte in substance. Round-2 CR1 closed.

**2. The new coupling assertion is real and non-vacuous** —
`git-child-env.selftest.sh:239-248`. It resolves `SETUP_WORKTREE` from
`CONCERTINO_DIR` (derived from `BASH_SOURCE`), i.e. the actual sibling
`setup-worktree.sh`, not an inline copy; greps the real `eval "$hook"` line and
requires both the literal `cd "$WORKTREE_PATH" || exit 0` and the ordered
`cd ... || exit 0; ... unset -v $(compgen -v GIT_ ...; ... eval "$hook"` sequence.

Mutation test, reproduced independently by me (executor's claim NOT taken on
trust): copied `scripts/` to a `mktemp -d` throwaway, ran the selftest there
unmutated → `ALL PASS`. Then, in the throwaway copy only, replaced
setup-worktree.sh's real line with the round-1 buggy form via a python
replace (selftest file itself untouched) → selftest printed
`FAIL: setup-worktree.sh's real CONCERTINO_WORKTREE_HOOKS eval line does NOT
match the fixed sequencing — found:     ( cd "$WORKTREE_PATH" && unset ... || true; eval ...`,
`1 FAILURE(S)`, **exit code 1** (verified separately). Green on current
committed state: **exit code 0**. Round-2 CR2 closed — the RED/GREEN coupling is
genuine.

**3. Nothing in my verification touched this repository.** All mutation work was
under `/tmp/tmp.uJF9VbhnYR` (a `mktemp -d`), since deleted. `git status
--porcelain` in the worktree after all my work shows only
` M openspec/changes/sweep-git-child-env-hermetic/workflow-state.md` (the
orchestrator's own bookkeeping file), i.e. byte-identical committed state for
every file in scope.

**4. Full gate suite re-run fresh by me** — `sh .husky/pre-commit` end-to-end:
repo-integrity, lint, typecheck, format:check, check:schemas,
check:spec-structure, check:openspec, check:openspec:selftest,
check:scala-quality (clean, 130 pre-existing soft warnings), jest
(254 suites / 2751 tests passed). **Exit 0.** Plus
`bash scripts/concertino/lib/git-child-env.selftest.sh` → exit 0 / `ALL PASS`.
Note the selftest is deliberately NOT in the hook (documented at
`.husky/pre-commit:15-20` and `package.json` `selftest:concertino-git-env`) —
by design, since it builds fixture git repos and running it as a literal hook
child would recreate the HEL-657 mechanism. I ran it out-of-band as intended.

**5. Acceptance criteria traced:**
- AC1 — every child git in the four scripts is `git_child`-wrapped. Verified by
  my own independent grep (`grep -nE '(^|[^_a-zA-Z"])git '` across
  `scripts/concertino/*.sh`), not the selftest's regex: the only three
  remaining hits are a failure-message string and two comments in
  `assert-phase.sh` (lines 110, 144, 146). Single shared helper
  (`lib/git-child-env.sh`), prefix-strip not denylist, `()` subshell + `exec`
  so no leak into the caller.
- AC2 — regression test exists, simulates the poisoned six-variable env, and is
  dual-armed (bare `git` proven misdirected → non-vacuous; `git_child` proven
  correct), plus a cd-failure case and the new static coupling assertion.
  Red-before-green reproduced by me above, in a throwaway dir only.
- AC3 — `check-repo-integrity.mjs` is untouched (absent from
  `git diff b5a95c70..HEAD --stat`); runtime unaffected.
- AC4 — out-of-scope items (HEL-806, CON-131/132, HEL-799/734) untouched.

**6. Holistic diff pass** (`git diff b5a95c70..HEAD -- scripts/ package.json
.husky/`): mechanical `git` → `git_child` substitutions plus one `source` line
per script, one new helper, one new selftest, one npm script, one hook comment.
No TODO/FIXME/debug leftovers, no unrelated edits, no behavioural change beyond
the env strip. No frontend/UI changes in this diff, so the design-standard/
screenshot review is not applicable.

### Verdict: CONFIRM

### Round-budget note for the orchestrator
This is round 3 of a 2-round `SKEPTIC_FINAL_ROUNDS` budget. Flagging as
instructed. Both prior REFUTEs found real defects (a live bug, then a real
coverage gap), so the extra round was well spent; this round is a clean
CONFIRM with no new findings.

### Non-blocking notes
- `scripts/concertino/*.sh` are rendered by `concertino sync` from templates in
  the upstream Concertino repo. Unless these `git_child` changes are also
  landed upstream, a future `concertino sync` will silently clobber them (this
  repo has a documented history of exactly that). Worth an upstream follow-up
  ticket; not a blocker for shipping here.
- This worktree is missing the gitignored, untracked `scripts/concertino/*.sh`
  helpers (`next-report-number.sh`, `persist-evidence.sh`, etc.); I invoked the
  main-repo copies. That is the already-known HEL-799/HEL-734 gap, explicitly
  out of scope here.
