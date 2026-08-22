## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Cold review of the plan for HEL-657 at
`openspec/changes/scope-archival-hygiene-rule/` (`ticket.md`, `proposal.md`, `design.md`,
`tasks.md`, `specs/openspec-archival-hygiene/spec.md`). Every conclusion below is derived from
commands I ran myself in this worktree or in throwaway repos under the scratchpad; the planner's
narrative was treated as claims to verify.

**Tooling note (not a blocker).** `scripts/concertino/next-report-number.sh`,
`persist-evidence.sh` and `emit-event.sh` do not exist in this worktree — its branch point
(`3596b161`) predates them; only `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`,
`start-servers.sh` are present. I did not guess a filename: I scanned the change directory
directly (`ls … | grep -i skeptic` → `(none)`), which is the collision check that script performs,
and used the main checkout's copies of `persist-evidence.sh` / `emit-event.sh` (both write into the
main checkout by design, and `persist-evidence.sh` resolves the source relative to *its own* git
working tree, i.e. this worktree — the documented usage).

---

### What I verified (with evidence)

**Planner claim 1 — the trigger is exactly `completedTasks === totalTasks` against the working
tree, git- and phase-blind. CONFIRMED, exactly.**
`/usr/lib/node_modules/@fission-ai/openspec/dist/core/list.js:115`:
`status: c.totalTasks === 0 ? 'no-tasks' : c.completedTasks === c.totalTasks ? 'complete' : 'in-progress'`.
Counts come from `utils/task-progress.js:getTaskProgressForChange`, which `fs.readFile`s
`<changesDir>/<name>/tasks.md` (working tree) and counts lines matching `/^[-*]\s+\[[\sx]\]/i`.
`scripts/check-openspec-hygiene.mjs:32` branches on that string. No git, branch, PR or phase input
anywhere in the path. Live: `openspec list --json` in this worktree returns
`{completedTasks: 0, totalTasks: 22, status: "in-progress"}`.

**Planner claim (D5) — `lastModified` is filesystem mtime and unusable. CONFIRMED.**
`list.js:11 getLastModified()` walks the change dir and returns the max `stat.mtime`, falling back
to the directory's own mtime. D5's rejection is correct.

**Planner claim (D2) — the ticket's own "move it to CI" fix is inert. BOTH HALVES CONFIRMED.**
`grep -rn "check:openspec|check-openspec|check:spec-structure|check-spec-structure|check:schemas|check:scala" .github/`
→ no matches; the only workflows are `ci.yml`, `cd-backend.yml`, `cd-frontend.yml`. And
`ci.yml:1-17` sets `paths-ignore: ["**.md", "LICENSE", ".github/ISSUE_TEMPLATE/**", "docs/**"]` on
**both** `push` and `pull_request`. A change directory is entirely markdown, so a drift-only PR
skips CI. **The rejection stands.** (Scope note in non-blocking section.)

**Planner claim (D3) — a `PHASE:`-based exemption would still fire on the Phase 3 squash.
CONFIRMED.** `.claude/agents/concertino-orchestrator.md` "Phase 3: Delivery" step 1 is *Squash all
branch commits*, step 2 is `openspec archive`. The squash is a commit, so pre-commit runs with
`tasks.md` at 100% and the change not yet archived. D3 is grounded.

**Planner claim ("not universal", HEL-773). CONFIRMED.**
`openspec/changes/archive/2026-08-21-top-anchored-mobile-nav-sheet/tasks.md:68` is
`- [x] 7.1 At archive, correct the capability's stale "bottom-sheet picker" Purpose wording`.

**Predicate behaviour (throwaway repo, scratchpad `probe2`/`probe3`/`probe4`).**
`git ls-tree main -- openspec/changes/<name>` returns a tree line when present, empty + rc 0 when
absent, rc 128 on a bad ref. `git log -1 --format=%ct -- <dir>` returns a timestamp when committed,
empty + rc 0 when untracked. Pathspec `…/foo` does **not** match `…/foo-bar`. So the mechanics the
plan proposes work as described — the problems are in what they *miss*, below.

**Base-ref resolution and the escaped condition against real history.**
`git rev-parse --verify --quiet origin/main` and `main` both resolve here (`3596b161`).
`git ls-tree main -- openspec/changes/` returns only `openspec/changes/archive`, and iterating the
last 30 commits on `main` found **zero** commits whose tree holds a non-archive change directory.
The "escaped" condition has therefore never been true in this repo's recent history — legitimate
for a guard against a state that hasn't happened yet, but it means AC2's practical coverage rests
almost entirely on the staleness condition, which sharpens change requests 4 and 5.

**Plan validity.** `openspec validate scope-archival-hygiene-rule` → `is valid`.
`node scripts/check-spec-structure.mjs` → `passed (318 canonical specs, 0 issues)`.

**No placeholders.** No `TODO`/`TBD`/"figure out later" in any artifact; every task names a file
and a concrete action; AC1–AC6 each map to at least one task (AC1→2.4, AC2→2.2/2.3, AC3→3.3,
AC4→2.x, AC5→1.7/2.6, AC6→3.5). Scope is tight — no drift beyond the ticket.

---

### Verdict: REFUTE

The core discriminator (escaped OR stale) is a defensible design and I do **not** ask for it to be
replaced. The AC2 narrowing described under Risks is, in principle, acceptable: harm from a
complete-unarchived change really is ~zero until it merges or ages. But three things must be fixed
before implementation, and they are not nits:

1. **The test that proves both directions cannot run** — proven three independent ways below. As
   planned, `npm test` goes green while executing none of it. That is the ticket's own forbidden
   failure mode ("a fix that stops false-positiving by never firing at all has FAILED") relocated
   one level up, into the verifier.
2. **Both new predicates fail silently toward *exempt*** under a condition I reproduced, which
   inverts D6's stated "degrade toward firing".
3. **The Risks section's central reassurance is false as written** — the never-committed exemption
   is a permanent hiding place, not a deferral.

---

### Change Requests

**1. Decide and specify how the new test actually executes; `npm test` will not run it as planned.**
Three separately fatal problems, each reproduced:
   - **(a) The proposed filename does not match the test glob.** Using jest's own matcher from this
     worktree's `node_modules`:
     `micromatch.isMatch('scripts/check-openspec-hygiene.test.mjs', ['**/?(*.)+(spec|test).[tj]s?(x)'])`
     → **false** (`.test.js` → true, `.test.ts` → true, `.spec.mjs` → false). `jest.config.cjs:4`
     is that exact `testMatch`, and `moduleFileExtensions` (line 23) has no `mjs`. Task 2.1 proposes
     `scripts/check-openspec-hygiene.test.mjs` by name.
   - **(b) Anything under the worktree is excluded from the run inside the worktree.**
     `jest.config.cjs:16` `testPathIgnorePatterns: [… "/.claude/worktrees/"]` is an unanchored
     substring regex, and this worktree's own absolute path contains `/.claude/worktrees/`. Proven
     by contrast, same inline config, only the ignore list differing, `rootDir` = this worktree:
     with `"/.claude/worktrees/"` → `--listTests` prints **nothing**; without it → prints all four
     `scripts/*.mjs`. Task 2.9 names this hazard but no task resolves it, and it is a real tension:
     the pattern must stay for the main checkout's run. So the executor, the evaluator and I would
     all verify in the one place the test cannot run.
   - **(c) `--passWithNoTests` makes (a) and (b) look green.** `package.json` `"test": "jest
     --passWithNoTests && npm --prefix frontend test"`, and `npx jest --listTests` in this worktree
     currently prints **nothing** — root jest matches zero tests today, so there is no existing
     signal that would look different.
   Required: pick one mechanism in `design.md` and add the task that implements it — either
   (i) a self-test invoked by the script itself (e.g. `--self-test`) exposed as its own npm script
   and wired into `.husky/pre-commit`, which runs identically inside a worktree and in the main
   checkout and matches HEL-775's actual precedent; or (ii) a `*.test.js`/`*.test.ts` file **plus**
   the specific `jest.config.cjs` edit (and the `.claude/worktrees/` tension resolution, e.g.
   anchoring the ignore with `<rootDir>` as `modulePathIgnorePatterns` on line 22 already does) that
   makes it run. Task 2.9's "confirm it runs" must then name the command whose output proves it.

**2. Add the target-root override the fixture tests require; the script cannot currently be pointed
at a fixture repo.** `scripts/check-openspec-hygiene.mjs:12` derives
`repoRoot = dirname(import.meta.url) + "/.."` and passes `cwd: repoRoot` to `openspec list --json`
— there is no argv/env override. Proven: from a throwaway repo containing two 100%-complete
changes, `node <worktree>/scripts/check-openspec-hygiene.mjs` printed `openspec/ is clean` (rc 0) —
it evaluated *this worktree*, not the fixture. Tasks 2.1–2.6 require running it against throwaway
repos under `os.tmpdir()` but no task in section 1 adds the override, so as written those tests
would assert against the helio repo's own state. (`openspec list --json` does work in a bare temp
dir with only `openspec/changes/<name>/tasks.md` — I verified — so fixtures are viable once
targeting is solved.) Required: add a task for a target-root argument, mirroring
`check-spec-structure.mjs`'s `process.argv[2]` (`scripts/check-spec-structure.mjs:45`), or state
explicitly that the test copies the script into the fixture repo and why that is equivalent.

**3. Pin `cwd` and anchor the pathspec on every git call, and define what a failed git call
*means*.** Both predicates evaluate to "exempt" — silently, exit 0 — when the process CWD is not
the repo root. Reproduced twice, in the same repo where the change *is* on `main`:
   ```
   # from repo root
   git ls-tree main -- openspec/changes/foo        -> 1 line   (escaped: true)
   # from ./scripts
   git ls-tree main -- openspec/changes/foo        -> 0 lines  (escaped: false)  rc=0
   git log -1 --format=%ct -- openspec/changes/foo -> empty    (never committed) rc=0
   # from ./scripts, with --full-tree
   git ls-tree --full-tree main -- openspec/changes/foo -> 1 line
   ```
   Escaped-false plus never-committed is precisely the permanently-exempt combination. Tasks
   1.2/1.3/1.4 give the commands with no `cwd`. Required: (a) every git invocation passes
   `cwd: repoRoot` (as the existing `openspec` call already does) and `git ls-tree` uses
   `--full-tree` or a `:(top)`-anchored pathspec; (b) task 1.8's try/catch must specify its *result*
   — a throw or unparsable output in a per-change predicate must mean "condition unknown → report"
   (plus a stderr notice), not a silent `false`. As written, 1.8 wraps the calls without saying what
   the wrapper returns, which is the same fail-open D6 forbids.

**4. Close or honestly bound the never-committed exemption — it is a permanent hiding place, and
the Risks claim about it is false.** Task 1.4, D5, and the spec scenario "Change has no commits yet"
make an untracked complete change exempt **forever**: `git log -1 -- <untracked path>` is always
empty regardless of the directory's age (verified), and an untracked directory can never become
reachable from the base ref. Today's rule *does* fire on that state. So `design.md` Risks —
"No state that previously fired is now permanently invisible — only *deferred*" — is false, and the
falsity is codified as a normative SHALL in the spec delta, not just an implementation detail.
Required: either (a) close it — when there are no commits, fall back to the change directory's
filesystem mtime for staleness. D5's objection to mtime applies only to *tracked* files that a fresh
checkout materialises; `scripts/concertino/setup-worktree.sh` copies only `CONCERTINO_ENV_FILES`
(`:283`) and `node_modules`, never `openspec/changes/`, so an untracked change dir exists only in
the checkout that created it and its mtime is a genuine age signal there. This is safe for AC1: an
executor's freshly-written change dir has an mtime of ~now and stays exempt. Or (b) keep the
exemption but correct the Risks paragraph to state the permanent hole explicitly and justify it,
and add the matching caveat to the spec requirement.

**5. Justify `%ct` versus `%at` — a rebase resets the staleness clock without touching the change.**
Reproduced: a change dir committed `2026-01-02`, then `git rebase main` after main moved →
`%ct` jumped from `1767340800` to `1787358219` (= now) while `%at` stayed `1767340800`. Committer
date measures the last history rewrite, not "untouched", which is what D5/1.4 claim to measure. A
long-lived branch rebased more often than the threshold keeps a complete-unarchived change exempt
indefinitely — a second hide-forever vector, and it compounds with request 4 given that "escaped"
has never been true in this repo's history. Required: state the choice in D5/task 1.4 with its
rationale (author date, or the max of author and committer date), and note the interaction with
Phase 3's squash.

**6. Test D6's degradation branches — they are currently specified but unverified.** The spec delta
makes two normative scenarios ("Base branch reference cannot be resolved" → staleness-only; "Git is
unavailable entirely" → unconditional reporting **plus a stderr notice"**). Tasks 2.1–2.9 cover
neither. D6 is the safety net that stops the rule silently disabling itself, so an untested D6 is
exactly the risk class this ticket exists to eliminate. Required: add tasks asserting both — a
fixture repo with no `main`/`origin/main` ref, and a non-git directory — including the stderr text.

**7. Make 2.7 a real anti-vacuity control and add the mutant that matters for AC2.** As written,
2.7 offers two options and both are hollow: *"assert the exact exempt-path message"* — no task makes
the script emit one; D7 requires distinct messages only on the two **firing** reasons, and the
success path prints the pre-existing `openspec/ is clean` regardless of whether a complete change
was examined and exempted or none existed at all. *"Temporarily force the escaped/stale predicate
true in-test"* — from a subprocess that means constructing escaped/stale repo state, which is just
tests 2.2/2.3 again, not a control on 2.4/2.5. Required: (a) extend task 1.5 to emit a per-change
**exempt diagnostic** naming the change and why it was exempted (e.g. "absent from origin/main, last
commit 0d ago"), and have 2.4/2.5 assert it — this makes "the script silently did nothing"
distinguishable from "the script examined it and exempted it", and is useful to a human at
pre-commit besides; (b) task 2.8 mutates in one direction only (rule 1 → unconditional, caught by
2.4). Add the opposite mutant — force the overdue predicate always-false — and require that 2.2
**and** 2.3 fail, with output recorded. That is the mutant corresponding to the ticket's explicit
failure mode.

---

### Non-blocking notes

- **D2 is correct but slightly over-stated.** Both facts check out, and the conclusion holds for
  *wiring the rule into the existing `ci.yml`*. It would not hold for a new dedicated workflow with
  no `paths-ignore`. The local-check choice is still the right one (cheaper, no new workflow, fires
  at the moment of the mistake) — consider softening the wording to "moving it into the existing CI
  workflow" so a future reader doesn't inherit a stronger claim than the evidence supports.
- **The `no-tasks` branch is preserved in code (task 1.5) but absent from the contract.** The new
  `openspec-archival-hygiene` spec will be the capability describing rule 1, and it says nothing
  about `no-tasks` — which fires when `tasks.md` is missing *or* has zero checkbox lines
  (`task-progress.js:19-27` returns `{total:0}` on a read failure). AC5 names only the stray-file
  and leftover-handoff rules, so nothing downstream would catch an accidental gating of `no-tasks`
  under the new overdue logic. One scenario would close that.
- **A canonical spec goes stale when this ships.**
  `openspec/specs/openspec-spec-hygiene/spec.md`, requirement "The structure guard runs pre-commit
  and is independently attributable", justifies HEL-775's separation by
  *"that script's known false-positive (a complete-but-unarchived change reported on implementation
  commits)"*. The normative SHALL stays true and must not change (AC6), but the rationale becomes
  historically inaccurate. Decide explicitly: a `MODIFIED` delta touching only that sentence, or
  leave it. **If a task is added, it must not be an "at archive" task** — by the design's own
  observation, an at-archive task holds `tasks.md` below 100% through Execution, which would prevent
  this change from ever exercising its own fix and would void task 3.3's live AC3 proof.
- **`tasks.md` numbering:** a single `## 1. Tooling` heading spans the 1.x/2.x/3.x groups. Cosmetic
  only — `openspec validate` passes.
- **Escaped is a fire-direction false positive in one unobserved case:** a deliberately multi-PR
  delivery that lands the change directory on `main` at 100% before a later PR archives it would be
  reported. No instance exists in the last 30 commits on `main`, so this is a note, not a request.
