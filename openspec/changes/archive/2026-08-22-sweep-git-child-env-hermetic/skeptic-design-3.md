## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read fresh, in full: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/git-hook-hermeticity/spec.md`. Verified the three round-2 change
requests against actual file contents, not the orchestrator's claim.

**CR (r2) #1 — design.md Goals vs. Decisions contradiction: FIXED.**
`design.md` Goals now reads "One shared bash helper that strips every
currently-set `GIT_*`-namespaced variable (a prefix strip, mirroring the
Node helper's `nonGitChildEnv` — not an enumerated list)". That agrees with
the Decisions block's `compgen -v GIT_` strip and with the Planner Notes.
`grep -n six design.md` returns only lines 36/37/44/120 — all of them
*historical contrast* ("not a six-name denylist", "the six-name list would
have missed"), i.e. arguing against the enumerated list rather than
specifying it. No surviving prescriptive six-name reference.

**CR (r2) #2 — proposal.md still describing the strip as six variables:
FIXED.** `proposal.md` "What Changes" bullet 1 now says the helper mirrors
"`nonGitChildEnv` prefix-strip approach (not its six-name allowlist, which
the same file documents as having already failed once) ... strips every
currently-set `GIT_*`-namespaced variable". This matches
`specs/git-hook-hermeticity/spec.md`'s requirement ("SHALL strip every
currently-set `GIT_*`-namespaced environment variable ... a prefix strip,
not an enumerated denylist"). The remaining "six" in proposal.md line 23
describes what the *test fixture exports as poison*, not what is stripped —
consistent with `tasks.md` 2.1 and ticket AC2, not a contradiction.

**CR (r2) #3 — CR6 naming a nonexistent `npx husky install` call site:
FIXED, and correct against ground truth.** `design.md` Decisions bullet 3
now states there is no literal `npx husky install` line and targets the
generic hook loop. I verified the actual site:
`scripts/concertino/setup-worktree.sh:343-349` —
`if [ -n "${CONCERTINO_WORKTREE_HOOKS:-}" ]` … `for hook in "${HOOKS[@]}"` …
`( cd "$WORKTREE_PATH" && eval "$hook" >/dev/null 2>&1 ) || true` (line 349),
character-for-character the line design.md quotes. And
`scripts/concertino/.concertino.env` line 9 is
`CONCERTINO_WORKTREE_HOOKS='npx husky install'`, exactly as design.md
describes it (config-driven, arbitrary per deployment). `tasks.md` 1.4 and
spec.md both carry the corrected framing. Wrapping the loop's `eval` rather
than enumerating hooks is the right call: it covers any future configured
hook.

**Independent scope check (not requested, done anyway).** Enumerated the git
call sites the tasks claim to cover:
`assert-phase.sh` (10), `cleanup.sh` (14, incl. the bare
`git rev-parse --show-toplevel` at :50 and the process-substitution
`< <(git -C "$REPO_ROOT" worktree list --porcelain)` at :135),
`setup-worktree.sh` (13, incl. bare `rev-parse`/`worktree list|add`/
`show-ref`/`fetch` at :209-275), `start-servers.sh` (1, `rev-parse
--show-toplevel` at :43). Tasks 1.2-1.5 name exactly these four files and
call out the bare cwd-based calls specifically. A sourced shell function
(`git_child`) works in all of these contexts including `$(...)` and `< <(...)`,
so the wiring is implementable as designed. No fifth `scripts/concertino`
file shells out to git.

**AC traceability.** AC1 → tasks 1.1-1.5 (strip is a superset of the six
named variables, so AC1 is satisfied, not weakened). AC2 → tasks 2.1/2.2 +
spec.md's dual-arm requirement, which upgrades "red-before-green" from a
one-off manual observation to a permanent every-run assertion. AC3 →
explicit Non-Goal (`check-repo-integrity.mjs` untouched). AC4 → Non-Goals
lists all five out-of-scope tickets.

**Environment note (not a blocker for this gate).** The worktree's
`scripts/concertino/` is missing the gitignored helper scripts present on
main (`next-report-number.sh`, `persist-evidence.sh`, `emit-event.sh`, …) —
the known HEL-799/HEL-734 gap, explicitly out of scope here. I ran
`next-report-number.sh` from the main checkout against this change dir.

### Verdict: CONFIRM

### Non-blocking notes

- `unset -v $(compgen -v GIT_ ...)` with an empty expansion runs `unset -v`
  with no operands; harmless in bash, and the trailing `|| true` covers it
  regardless. Worth a one-line comment in the helper so a future reader
  doesn't "fix" it.
- proposal.md line 23 hedges the selftest filename ("`git-child-env.selftest.sh`
  or similar") while tasks.md 2.1 fixes it at
  `scripts/concertino/lib/git-child-env.selftest.sh`. tasks.md governs;
  tightening proposal.md to match would remove the last ambiguity.
- Task 2.2 ("exercise each of the four scripts' actual call sites") is the
  expensive half of the test work and has no stated acceptance signal for
  *how* each script is exercised (several require a real worktree/servers).
  The executor should be prepared to assert at the level of "which repo did
  the call resolve to" rather than running the scripts end-to-end.
