## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of HEL-657 on `task/scope-openspec-archival-hygiene-check/HEL-657` @ `bf3e23b0`, base
`origin/main` @ `3596b161`. No UI/backend surface, so no servers were started (per the orchestrator's
instruction and confirmed by the diff: `scripts/check-openspec-hygiene.mjs`,
`scripts/check-openspec-hygiene.selftest.mjs` (new), `package.json` +1 line, `.husky/pre-commit` +1 line,
plus the change directory's own markdown). Every conclusion below is from a command I ran myself in this
session. All mutation experiments were done on **copies under the scratchpad**, never in the worktree;
final integrity check confirms the four source files still match `HEAD` byte-for-byte.

### What I verified (with evidence)

#### 1. Ground truth

```
$ git diff --name-status origin/main...HEAD
M  .husky/pre-commit          M  package.json
M  scripts/check-openspec-hygiene.mjs
A  scripts/check-openspec-hygiene.selftest.mjs   (+ change-dir markdown only)
$ git status --porcelain
 M openspec/changes/scope-archival-hygiene-rule/workflow-state.md   (orchestrator bookkeeping only)
```

`openspec list --json` in this worktree: `scope-archival-hygiene-rule`, `37/37`, `"status": "complete"`,
unarchived — i.e. exactly the state the ticket says used to force `git commit -n`.

#### 2. AC1 / AC3 — both directions, reproduced independently

OLD script (`git show origin/main:scripts/check-openspec-hygiene.mjs`, run against this worktree's real
`openspec/` tree via a symlinked root so the worktree stayed untouched):

```
  - change "scope-archival-hygiene-rule" is complete (37/37) but not archived — run `openspec archive ...`
exit=1
```

NEW script, same state, same instant:

```
openspec/changes/scope-archival-hygiene-rule: complete but in flight (absent from origin/main, last activity 0d ago)
openspec/ is clean
exit=0
```

AC1 and AC3 hold, and the exempt diagnostic (D13) proves the change was **examined and exempted**, not
silently skipped. Also verified cwd-independent: identical result run from `/tmp`, from `scripts/`, and
from `scripts/concertino/`.

#### 3. AC2 — the rule still genuinely fires. Four realistic abandonment states I built myself

Each is a real git repo in the scratchpad, checked with the shipped script (not the self-test's fixtures):

| State I constructed | Result |
| --- | --- |
| 40-day-old change, **real `git rebase`** onto an advanced `main` (`%at=1783908155` held, `%ct` moved to now) | `exit=1` — "inactive for 40d (threshold 14d)" |
| 40-day-old change, **merge commit** of `main` into the feature branch (history simplification could have masked it) | `exit=1` — "inactive for 40d" |
| Change **escaped to `main` with an author date of NOW** (GitHub squash-merge shape — staleness can never see this) | `exit=1` — "reachable from main" |
| 40-day-old change in a **fresh `git clone`** (all filesystem mtimes reset to today) | `exit=1` — "inactive for 40d" |

The last two are the ones that matter most: the squash case is caught only by "escaped", the fresh-clone
case only by `%at` (D5's whole argument), and both fire. AC2 is alive, not decorative.

Threshold boundary probed directly: 13d → exempt, exactly 14d → exempt, **14d+60s → fires**, 15d → fires.
No off-by-one that could hide an overdue change.

**Hunt for permanent invisibility (the load-bearing AC2 claim): I could not find one.** Every exempt state
I could construct requires *ongoing activity* — a new commit touching the change dir, or an mtime bump on
an untracked one — i.e. the change is not abandoned. Two bounded-delay exceptions found, neither permanent
(both listed as non-blocking notes below). I also confirmed D5's supporting claim by reading
`scripts/concertino/setup-worktree.sh:280-287`: it copies only `CONCERTINO_ENV_FILES` and module
directories, never `openspec/changes/`, so an untracked change dir's mtime really is a genuine age signal.

#### 4. Mutation testing — can the 17-case suite go green on a broken implementation?

I ran 11 mutants against sandbox copies. **Caught** (the ones that matter):

| Mutant | Suite result |
| --- | --- |
| `%at` → `%ct` (rebase resets the clock) | 1 FAIL — 2.9, the explicit control |
| unknown → silently exempt (fail-open, D6 inverted) | 1 FAIL — 2.12-C |
| drop `cwd: targetRoot` from `runGit` (D10) | **12 FAIL** |
| drop `gitChildEnv()` from `runGit`, *run under a hook env* | **8 FAIL** (see §5) |

**Survived** (green suite, behaviour altered) — all three are coverage gaps, not defects; I verified the
shipped behaviour is correct in each case:

- `staleDaysThreshold()` hardcoded to the default (env override ignored) → **17/17 green**. The spec delta
  this change ships adds `Scenario: Threshold overridden` with zero coverage. I confirmed the shipped code
  *does* honour it: `OPENSPEC_HYGIENE_STALE_DAYS=1` on a 2-day-old change fires ("threshold 1d");
  `=30` on a 20-day-old change exempts. Spec satisfied, test missing.
- `DEFAULT_STALE_DAYS` changed to `19`, or to `1` → **17/17 green** both times. Every FIRES case backdates
  20 days, so any default in 1..19 passes. The `1` direction is the interesting one: it silently reinstates
  this ticket's original false positive for any change worked across more than a day.
- mtime fallback made non-recursive / directory-only (task 1.7's explicit concern) → **17/17 green**. Case
  2.8 backdates the directory *and* every entry, so it cannot distinguish. This mutant's realistic failure
  direction is over-reporting, not hiding.

I judged none of these blocking: the delivered implementation is correct on every state I could build, and
the suite catches every core behaviour (escaped, stale, `%at` vs `%ct`, unknown→report, cwd pinning,
GIT_DIR hermeticity under the hook, all three degradation branches, rules 2/3, the missing-`archive/`
guard).

#### 5. The GIT_DIR / env-leak hazard — the highest-risk part of the diff

First I established the hazard is real rather than folklore. A throwaway `git worktree` checkout with an
`env | grep ^GIT_` pre-commit hook shows git handing hook subprocesses:

```
GIT_DIR=/…/mainrepo/.git/worktrees/wt      GIT_INDEX_FILE=/…/worktrees/wt/index
GIT_AUTHOR_DATE=@1787364012 -0700          GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL / GIT_CONFIG_PARAMETERS
```

Absolute, and `GIT_DIR` beats `cwd`-based discovery unconditionally. Note `GIT_AUTHOR_DATE` is set on an
ordinary commit too — and on `git commit --amend` of an old commit it carries that *old* date, which is
precisely how a leaked date would turn 2.10 red. Both strips are load-bearing.

**Fix is complete in both scripts.** Shipped self-test under a full simulated hook environment
(`GIT_DIR` + `GIT_INDEX_FILE` of this real worktree, plus `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` =
2023 and all four identity vars poisoned): **17 passed, 0 failed**, and afterwards
`git status` showed only the pre-existing `workflow-state.md` edit with `HEAD` still at `bf3e23b0`.

**Removing either strip is caught, loudly, in the place it matters.** I reproduced the original incident
safely: a mutant self-test with its own strip removed, run with `GIT_DIR` pointed at a **throwaway** repo,
wrote 4 spurious commits into that repo, created a `feature` branch, moved `HEAD` off its branch and left
`D README.md` / `?? f.txt` behind. The mutant with the *main script's* strip removed produced **8 FAILs**
under a hook env (0 FAILs standalone) — so the pre-commit hook itself is the regression test for this
class, which is the right place for it.

I also checked the one leak var **not** in either strip list, `GIT_CONFIG_PARAMETERS`: harmless, because
command-line `-c` wins over it (probed directly), and the shipped suite is 17/17 under
`GIT_CONFIG_PARAMETERS` carrying `commit.gpgsign=true` plus a bogus identity.

Contributor-hostility check, all 17/17: no global git identity at all; `commit.gpgsign=true` with a
nonexistent gpg program; global `core.hooksPath` + `init.defaultBranch=trunk`.

#### 6. AC5 / AC6

- AC5: rule 2 (stray entries) and rule 3 (leftover `files-modified.md`) are byte-identical to
  `origin/main` apart from the deliberate ENOENT guard (D15); both fire in the suite with message-text
  assertions, and I confirmed the `no-tasks` branch still fires on a real fixture (`exit=1`).
- AC6: `git diff --stat origin/main...HEAD -- scripts/check-spec-structure.mjs jest.config.cjs` is
  **empty**. `.husky/pre-commit` is `typecheck` on line 5, `check:spec-structure` on line 8,
  `check:openspec` on 9, with the single new `check:openspec:selftest` on line 10. Correctly ordered.

#### 7. Gates re-run by me, in full, on the committed tree

`sh .husky/pre-commit` → **exit 0** in 40.4 s. lint ✓, typecheck ✓, format:check ("All matched files use
Prettier code style!") ✓, check:schemas (66 across 47 protocol files) ✓, check:spec-structure (318
canonical specs, 0 issues) ✓, check:openspec (exit 0 + exempt diagnostic) ✓, check:openspec:selftest
(**17 passed, 0 failed, 17 total (1972ms)**) ✓, check:scala-quality (clean, 128 pre-existing soft
warnings) ✓, `npm test` (254 suites / 2751 tests) ✓. This matches `evaluation-1.md`'s table exactly —
corroborated independently, not taken on trust.

#### 8. Nothing embarrassing after merge

- **Performance**: selftest 2.03-2.05 s (D14 budget 3 s), 5% of a 40 s chain. It is close to net-free:
  D14's telemetry opt-out, which I re-measured, cuts `openspec list --json` from 900/1222/2132 ms to
  109/112/113 ms with byte-identical output, so `check:openspec` itself got ~0.8-2.0 s *faster*. The git
  predicates cost 3-20 ms each (worst case = full 1057-commit history walk for an untracked name: 10-20 ms).
- **No leaked fixtures**: `/tmp` has zero `openspec-hygiene-selftest-*` entries after ~15 suite runs
  including deliberately crashed mutants — the `finally` cleanup holds.
- **No damage from the disclosed incident**: no stray `feature` branch in the real repo; only two commits
  above `origin/main`; both went through the live hook.
- **No stray artifacts**: no PNGs or logs at repo root; `files-modified.md` matches the actual diff.

### Verdict: CONFIRM

All six acceptance criteria trace to evidence I produced myself. The central risk — "a fix that removes
the false positive by making the rule never fire" — is refuted four ways over on real git states,
including the two cases (squash-escape with a fresh author date; fresh clone with reset mtimes) that each
of the two predicates exists specifically to cover. The highest-risk element of the diff, the hermetic git
environment, is complete in both scripts, demonstrably necessary, and regression-protected at pre-commit.

### Non-blocking notes

1. **`OPENSPEC_HYGIENE_STALE_DAYS` valid-override path has no self-test case.** A mutant that ignores the
   env var entirely passes 17/17. The shipped code is correct (verified: `=1` fires on a 2-day change,
   `=30` exempts a 20-day one), but the spec delta's `Scenario: Threshold overridden` is uncovered. One
   case, ~10 lines: commit a change 2 days back, run with `OPENSPEC_HYGIENE_STALE_DAYS=1`, assert it fires.
2. **`DEFAULT_STALE_DAYS = 14` is not pinned by any case.** Any default in 1..19 keeps the suite green,
   because every FIRES case uses a 20-day backdate. A `1` would silently reinstate this ticket's original
   symptom. Cheapest fix: one boundary case at ~15 days asserting it fires, or assert the literal
   `threshold 14d` text in 2.7's message.
3. **`design.md` says of the threshold "Env-overridable, which is how the self-test drives it."** The
   shipped suite drives staleness by backdating commits, and only ever sets the env var to an *invalid*
   value (`-5`). Worth correcting when notes 1/2 are addressed, so the design does not over-claim coverage.
4. **`evaluateOverdue(change, gitOk, …)`** — `gitOk` is never read
   (`scripts/check-openspec-hygiene.mjs:185`). ESLint's `no-unused-vars` default (`args: "after-used"`)
   will not flag it because later parameters are used. Dead parameter; drop it.
5. **`origin/main` ahead-of-local is handled; local-ahead-of-`origin/main` is not.** A change committed to
   *local* `main` but not yet pushed reports "absent from origin/main" and stays exempt (probed on a
   fixture with a real bare remote). `design.md`'s Risks section covers only the opposite direction. The
   exposure window is commit-until-push (push updates the remote-tracking ref immediately), and staleness
   backstops at 14 days, so this is a bounded delay, never suppression.
6. **Cosmetics in the report/diagnostic strings.** A change 14d+60s old prints "inactive for 14d
   (threshold 14d)", which reads as if 14 were not greater than 14 (it is, in seconds). A commit with a
   future author date prints "last activity -30d ago". Neither hides anything.
7. **`files-modified.md`** says the explicit-date `extra` applies to "2.7, 2.8, 2.9"; 2.8 backdates
   filesystem mtimes and never passes `extra`. The self-test's own comment and commit `bf3e23b0` both get
   this right. Ephemeral file (deleted at archive), so cosmetic only.

### Note for the orchestrator (not a finding against the change)

`scripts/concertino/{next-report-number,persist-evidence,emit-event}.sh` do **not** exist in this
worktree — its base (`3596b161`) predates them. They do exist in the main checkout at
`/home/matt/Development/helio/scripts/concertino/`, so I ran `next-report-number.sh` from there against
this change directory; it returned `READY number=1`, which is the filename this report uses. Not a
BLOCKER: verification itself was never impeded.
