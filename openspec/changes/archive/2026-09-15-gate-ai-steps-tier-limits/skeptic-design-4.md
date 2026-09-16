## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold spawn. Spawn-cwd guard: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio
branch=feature/gate-ai-steps-tier-limits/hel-1108` (ambient is an ancestor of `WORKTREE_PATH`, the
normal spawn shape).

Live-resolved base: `scripts/concertino/resolve-review-base.sh "$PWD" main origin` → exit 0,
`0ce987459d101c726a0082ad330b2f5f624fa6d0`. `git rev-parse HEAD` =
`eaf97dbded55fe3dda5256fdcbdf8f6340eb242d`; `git diff --stat BASE...HEAD` = 11 files, 1191
insertions, **all markdown under `openspec/changes/gate-ai-steps-tier-limits/`** — no production
code. N10 is applied (the artifacts are committed now). This remains a design gate.

Gate scripts:
- `openspec validate gate-ai-steps-tier-limits` → `Change 'gate-ai-steps-tier-limits' is valid`,
  exit 0.
- `scripts/concertino/check-constraints-carryover.sh "$PWD" gate-ai-steps-tier-limits` → `OK`,
  exit 0. (My first call passed the change name only and printed a usage error; re-run with
  `<WORKTREE_PATH> <CHANGE_NAME>` per the reproduce-before-concluding rule — the `OK` is the real
  result.) C1–C11 present and textually identical in both `workflow-state.md` `CONSTRAINTS` and
  `tasks.md` `## Standing Constraints`.

### What I verified (with evidence)

**Round-3 CR1 is FULLY and ACCURATELY resolved. I re-derived both arms from the code.**
`grep -n` on `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` gives
exactly five `backend.execute` sites (`:494/495`, `:566/567`, `:694/695`, `:710/711`, `:945/946`),
and reading `evaluateNodeRowsForBackfill` in full:

- `:684` `case allRoots if targetStepId.isEmpty =>` … `:694 else backend` `.execute(pipeline,
  roots, Vector.empty, …)` — this is unambiguously the **source/root-level** arm and it passes
  `Vector.empty` steps. D2 now labels `:694` "Output backfill, **source/root-level** arm" with
  "AI reachable? **No — n/a, no steps**". **Correct.**
- `:706` `case Some(target) =>` … `:709` `NodeDependencyClosure.closureOf(allSteps.toVector,
  target)` … `:710 backend` `.execute(pipeline, roots, slicedSteps.toVector, …)` — the **step/node**
  arm with a real closure. D2 marks only `:710` AI-reachable. **Correct.** The arm labels are
  un-swapped exactly as briefed, and match the code.
- The fail-closed danger argument is re-attached to `:710` only, which is the site that matters.
- Task 2.4a now demands the falsifiable mutation at `:710` ONLY; new task **2.4a-i** covers `:694`
  for uniformity and says plainly that no AI step is reachable, no behavioural assertion can be
  made red, and "do NOT fabricate red evidence". That is the right shape — it converts the
  previously unsatisfiable clause into an honest inspection task.
- Task **2.4b** requires classifying all five sites into the two groups. **C11 carries the same
  three-vs-two split in both files, verbatim.**

**C10 and C11 are accurate as pinned.** C11's three AI-reachable sites (`:566`, `:710`, `:945`) and
two `Vector.empty` sites (`:494`, `:694`) match ground truth line-for-line. C10: `submit` authorizes
owner-or-`findGrantRole` (`:210`, `:215`), while `previewAtNode` (`:450`, `:451`) gates on
`findByIdShared` alone — the asymmetry C10 closes is real. Line pins I re-checked and found exact:
`PipelineRunService:114` (single engine construction), `:119` (`backend` selection),
`InProcessPipelineEngine.scala:418` (the `makeContext` CALL, N9 applied), `:218` (the test-only flat
path), `:686` (`makeContext` definition), `:354` (`executeTree`), `PipelineExecutionBackend.scala:34`
and `InProcessExecutionBackend.scala:28` (the two `execute` signatures), `ApiRoutes:322`
(`aiStepClient`), `:328` (`new ClaudeAiStepClient(...)`), `:488` (`chatAccessServiceOpt`), `:78`
(`userRepo`), `:149` (`dbContext = null`) — so the N6 val-init-order trap and D8's four
construction sites are stated accurately.

**N9, N10, N11 applied.** On N11 the artifact is actually *better* than the brief described: D2 says
"All FIVE … must thread the owner", then splits three AI-reachable from two uniformity-only. Five is
the self-consistent number (3+2); the brief's "four threaded sites" phrasing would have been wrong.

**Scope is still bounded.** C5 holds: `ls | sort -V` on the migration dir gives `V107__add_writeback_ops.sql`
as the highest present, and no DDL is proposed anywhere. C6 holds: no frontend task exists, D9's
no-forced-frontend conclusion is restated, and no HEL-1109 / HEL-1136 / HEL-1135 scope is absorbed.
D10 remains scope created by this ticket's own change, not creep.

**Spec deltas remain behavior contracts, not implementation plans**, and now cover the backfill
ruling with two outcome-stated scenarios plus an `owner`-tier-never-blocked scenario. The
`tier-gated-assistant-access` MODIFIED requirement header still matches the live spec text.

**I audited EVERY task's verification clause for achievability, as asked.** 2.1, 2.2, 2.2a, 2.3,
2.4, 2.4a, 2.4a-i, 2.4b, 2.5, 3.2, 3.2a, 3.3, 3.4, 3.5, 3.5a, 3.5b, 3.5c, 3.6, 3b.1–3b.4, 4.1–4.3
and 5.1–5.5 are all satisfiable as written. In particular 3.5's "the build fails if the parameter is
removed from a call site" IS achievable (a missing required argument is a type error), and 3.5b /
3b.2 / 3b.4 / 4.1–4.3 all name mutations that can genuinely go red. **Exactly one clause cannot be
satisfied — task 3.1 — and it rests on a false premise carried since round 1. That is CR1 below.**

### Verdict: REFUTE

**No change request from rounds 1–3 survives unaddressed.** Round-3 CR1 in particular is fully and
accurately fixed against the code, including the arm labels; C10/C11 are accurate; scope is bounded.

This REFUTE rests on ONE new finding, in the same defect class the orchestrator asked me to hunt
(an unsatisfiable verification clause) — one that no prior round checked because all three, and the
ticket's own premise notes, repeated the same unverified assertion about the Scala compiler.

### Change Requests

1. **D6's "the compiler forces both step files" is FALSE for this build, which makes task 3.1's
   verification unsatisfiable and invalidates a Risks-table mitigation.**

   Task 3.1 says: "Verify the compiler forces both step files to handle it (**a non-exhaustive
   match must fail the build** before task 3.4)." It will not fail the build. Ground truth, four
   independent corroborations:

   - `cd backend && sbt -batch "print Compile/scalacOptions"` → `*` (an EMPTY sequence). Reproduced
     with `show Compile/scalacOptions` → `[info] *`. (My first attempt passed a bad `--no-colors`
     flag and my second ran from the repo root, which is not an sbt project; both were measurement
     errors, re-run correctly — the two clean runs above agree.)
   - `backend/build.sbt` contains **no `scalacOptions` at all** (grep for
     `scalacOptions|Xfatal-warnings|-Werror|Wconf|Xlint` across every `.sbt`/`.scala` build file
     returns only `ThisBuild / scalaVersion := "2.13.15"`). `backend/project/plugins.sbt` adds only
     sbt-assembly.
   - CI runs plain `sbt compile test` (`.github/workflows/ci.yml:149`) — no warning escalation.
   - `scripts/check-scala-quality.mjs` has no exhaustivity rule (its own header says its extra
     rules "warn, do not fail").

   On Scala 2.13 with no `-Xfatal-warnings`/`-Werror`, `match may not be exhaustive` is a **warning**.
   So adding `AiStepFailure.QuotaExceeded` compiles green with both step files untouched, and
   `sbt test` (task 5.3) stays green.

   Why this is load-bearing rather than pedantic — the consequence is an AC2 failure mode, and it is
   quiet. Both step files match `case Left(AiStepFailure.X(...)) => fail(...)` ×4 plus `case
   Right(...)` (`AnalyzeWithAiStep.scala:68-72`, `GenerateTextStep.scala:67-71`). A missed arm means
   a quota denial throws `scala.MatchError` at runtime instead of `fail("ai-quota-exceeded", …)`.
   `StepExecutionException.from` (`InProcessPipelineEngine.scala:48-52`) allowlists only
   `IllegalArgumentException` for verbatim message pass-through; a `MatchError` hits the
   `case other` arm at `:51` and becomes the generic **"step execution failed"** — losing the limit
   and the UTC reset that AC2 and task 3.4 require, and that the
   `pipeline-ai-tier-gating` scenario "Denial names the limit and the reset" mandates. The Risks
   table's entry "[Gate silently bypassed if a future AI step skips the seam] → mitigated by … the
   compiler forcing the new variant (D6)" is therefore not a real mitigation as stated.

   Required (all artifact-level, no scope change):
   - Correct D6 and the Risks entry: the sealed set gives exhaustivity **warnings**, not a build
     failure, in this build (no `scalacOptions`, `sbt compile test`).
   - Restate 3.1's verification in terms that can actually be satisfied. Either (a) make the tests
     the enforcement — require the per-step `QuotaExceeded` mapping tests of 3.4 plus 4.3's
     distinguishability assertion, and state that a missing arm is caught there and NOT by the
     compiler; or (b) if a genuine build-level guarantee is wanted, decide explicitly to add a
     scoped `-Xfatal-warnings`/`-Wconf` escalation and own that as a build change (note this risks
     failing on pre-existing warnings elsewhere, so (a) is the cheaper call for a held release).
   - Add an explicit assertion that a `QuotaExceeded` denial surfaces the quota message **verbatim**
     (i.e. via the `IllegalArgumentException` allowlist), not the generic "step execution failed" —
     with the mutation being "drop one step file's `QuotaExceeded` arm", which must make it go red.
     That is the falsifiable evidence 3.1 currently claims to get from the compiler and does not.

### Non-blocking notes

- **N12 (one stale line pin).** D2 and task 2.4a-i cite the source/root arm's guard as
  `targetStepId.isEmpty`, `:676`; the actual line is **`:684`** (`case allRoots if
  targetStepId.isEmpty =>`). Every other pin I checked is exact, and the arm is unambiguously
  identified by the quoted guard text, so this misleads nobody — but C11-adjacent pins are the ones
  future rounds trust, so it is worth correcting while CR1 is being applied.
- **N13.** Task 3.2 carries two separate "Verify by" clauses (the `chatAccessServiceOpt`/NPE check
  and the tier-semantics unit test). Both are achievable; splitting them into 3.2/3.2b would make
  the evidence file easier to audit, since one task with two independent verifications is how a
  half-done task reads as complete.
- **N14.** `ClaudeAiStepClient` carries the "not implemented by this ticket" HEL-1108 marker in TWO
  places — the class scaladoc (`:14-19`) and an inline comment inside `complete` (`:21-23`). Task
  3.6 says "comment" singular; make sure both are updated, or a grep for the stale claim will still
  hit.
