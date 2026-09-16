## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold spawn. Spawn-cwd guard: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio
branch=feature/gate-ai-steps-tier-limits/hel-1108` (ambient is an ancestor of `WORKTREE_PATH`,
the normal spawn shape).

Live-resolved base: `scripts/concertino/resolve-review-base.sh "$PWD" main origin` → exit 0,
`0ce987459d101c726a0082ad330b2f5f624fa6d0`; `git rev-parse HEAD` is the SAME SHA and
`git diff --stat BASE...HEAD` is EMPTY — planning artifacts only, as briefed. (They are in fact
still UNTRACKED: `git status --porcelain` → `?? openspec/changes/gate-ai-steps-tier-limits/`.
See N10.)

Gate scripts, re-run with correct arguments after my first invocations passed wrong/missing args
and printed usage errors (the reproduce-before-concluding rule — the results below are the real
ones; my first `openspec validate` with no item name printed "Nothing to validate" and my first
carryover call printed a usage error, neither of which is a result):
- `npx openspec validate gate-ai-steps-tier-limits --type change` → `Change
  'gate-ai-steps-tier-limits' is valid`, exit 0.
- `scripts/concertino/check-constraints-carryover.sh "$PWD" gate-ai-steps-tier-limits` → `OK`,
  exit 0. C10 and C11 are present in BOTH `workflow-state.md` (`CONSTRAINTS`, `agreed_at:
  design-gate`) and `tasks.md`'s `## Standing Constraints`; 11 constraints, 3
  `CONSTRAINT_REVIEWS` entries.

### What I verified (with evidence)

**Round-2 CR1 — RESOLVED on substance, and the five-site enumeration IS exhaustive. I derived
this from the code, not from the table.**

I deliberately did not trust any list in the artifacts (or in my briefing). My first grep used the
wrong path (`services/PipelineRunService.scala` does not exist; the real file is
`services/pipelines/PipelineRunService.scala`) and returned only comment lines plus one test hit —
so I re-ran against the real file. Ground truth, `grep -n "execute" <real file>` plus
`grep -n "backend"`:

```
494/495:  backend .execute(pipeline, Vector(selectedRoot), Vector.empty, ...)
566/567:  backend .execute(pipeline, roots, slicedSteps.toVector, ...)
694/695:  backend .execute(pipeline, roots, Vector.empty, ...)
710/711:  backend .execute(pipeline, roots, slicedSteps.toVector, ...)
945/946:  backend .execute(pipeline, roots, steps, ...)
```

Exactly FIVE `backend.execute` call sites; the artifacts' cited lines are the `backend` receiver
lines with `.execute(` on the following line. The enumeration matches ground truth.

I then closed the "is there a SIXTH execution path, or one outside `PipelineRunService`?" question
structurally rather than by enumeration, since that is the defect class that has bitten twice:

- `PipelineExecutionContext(` is constructed in **main** at exactly ONE place —
  `InProcessPipelineEngine.scala:693`, inside `makeContext` (`grep -rn "PipelineExecutionContext("
  backend/src`; every other hit is a test). `makeContext` sets `aiClient = aiStepClient` (`:704`),
  so it is the only production door to an AI client.
- `makeContext` has exactly two call sites (`grep -n "makeContext"`): `:218` inside the test-only
  `executeWithStepCounts`, and `:418` inside `executeTree`'s per-node evaluation.
- `executeTree` has exactly ONE main-side caller: `InProcessExecutionBackend.scala:60`.
- `InProcessExecutionBackend` is constructed in main at exactly ONE place:
  `PipelineRunService.scala:119`, as the `backend` field (`:118`), and only when the injectable
  `executionBackend` param is `null`. **`ApiRoutes.scala` passes `executionBackend = null`**
  (verified at `:331-355`), so production always uses `InProcessExecutionBackend`; the
  `SparkJobSubmitter` that `ApiRoutes` receives at `:84` is NOT wired as the pipeline execution
  backend. `new PipelineRunService(` appears in main only at `ApiRoutes.scala:331`.
- `ctx.aiClient.complete` appears in main at exactly two places — `AnalyzeWithAiStep.scala:67` and
  `GenerateTextStep.scala:66` — confirming D1's single-chokepoint premise. Chat reaches
  `ClaudeClient` by its own separate path.

So the production reachability chain is closed: five `backend.execute` sites → one backend → one
`executeTree` → one `makeContext` → one context → one seam. **There is no sixth execution path and
no AI-reachable execution path outside `PipelineRunService`.** C11 is correct and complete, and the
round-2 finding is genuinely fixed rather than merely described at greater length.

**2.2a / N5 — correct.** `executeWithStepCounts` has exactly one main-side caller, the engine's own
`execute` at `:189`, and the file's own doc at `:202-210` states it is test-only as of P1.2 with
`InProcessExecutionBackend` (the only production consumer) calling `executeTree` exclusively. Its
`makeContext` call at `:218` passes no owner, so "stays defaulted `None`" is right, and the
reworded expectation (zero callers from OUTSIDE the engine, with `:189` named as the expected
intra-file hit) matches what a literal grep actually returns.

**D8 / N7 — construction sites are exactly as stated.** `grep -rn "ClaudeAiStepClient("
backend/src` returns precisely four: production `ApiRoutes.scala:328` plus the three named test
sites at `AnalyzeWithAiStepSpec.scala:62`, `GenerateTextStepSpec.scala:65`,
`PipelineRunServiceAiStepClientWiringSpec.scala:131` — the exact lines D8/3.5a name. The current
signature is `class ClaudeAiStepClient(client: ClaudeClient)(implicit ec)`, so making the gate a
required second param does force all four, as claimed. `AiStepFailure` is a sealed trait of exactly
four case classes (`AiStepClient.scala:24-29`), so D6's compiler-forcing premise holds, and
`AiStepRequest.ownerUserId` defaults to `None` with no populating caller — the gate is indeed
unreachable today (`ClaudeAiStepClient.scala:13-21` carries the "not implemented by this ticket"
HEL-1108 marker verbatim).

**N6 (val-init-order trap) — every cited line is exact.** `aiStepClient` at `ApiRoutes.scala:322`,
`chatAccessServiceOpt` at `:488` (built as `Option(dbContext).map(ctx => new
ChatAccessService(userRepo, new AssistantDailyUsageRepository(ctx), userTierConfig))`), `userRepo`
a constructor param at `:78`, `dbContext` at `:149`. So the trap is real, the instruction in task
3.2 to build from `userRepo`+`dbContext` and NOT to reference `chatAccessServiceOpt` is the correct
avoidance, and D8's `Option(dbContext)` fallback matches the established `ApiRoutes` idiom.

**The backfill log-only ruling is defensible, and its spec scenarios are behavior contracts.**
`backfillOutputNode` does `.recoverWith { log.error; Future.successful(()) }` (`:664-667`), and both
backfill `.recover` arms log only (`:696-698`, `:717-…`) — so "best-effort, off the request path"
is the pre-existing contract, not a new invention, and D4's divergence from the run path's loud 422
is honestly labelled as a divergence with a stated reason (no caller to tell). The two new
scenarios state outcomes, not implementation ("previously materialized rows remain intact and are
NOT replaced with an empty or partial row set"; "an `owner`-tier pipeline's backfill is never
blocked by the cap") and 3b.4's verification names a mutation (let the denial write an empty row
set) that would genuinely go red. Good.

**Scope (C6) intact.** No frontend task was added; D9's no-forced-frontend conclusion is restated;
no HEL-1109/HEL-1136/HEL-1135 work is absorbed. C5 intact: `ls | sort -V` confirms V107
(`V107__add_writeback_ops.sql`) is still the highest migration and no DDL is proposed. D10 remains
scope created by this ticket's own change, not creep.

**Previously-confirmed items I spot-checked rather than re-derived** (per my brief): AC1's
already-satisfied status and the restraint (C9), the analyzewithai spec asymmetry, the writeback
spec's false tier-gating claim, D3/D6/D7/D9, the no-migration conclusion, and D10's soundness
including `previewAtNode` as the single preview chokepoint (`:450-455` gates on `findByIdShared`
alone; the source-level arm at `:494` runs `Vector.empty` steps). Nothing I read contradicts any of
them.

### Verdict: REFUTE

**No change request from round 1 or round 2 survives unaddressed.** Round-2 CR1 is genuinely and
correctly resolved — I re-derived the five-site enumeration from the code and it is exhaustive, and
I could find no sixth path. N5–N8 all landed accurately.

This REFUTE rests on ONE narrow, new, artifact-level defect that the round-2 fix introduced while
correcting itself: one cell of the D2 table is **false against the code**, which in turn makes one
clause of task 2.4a's "falsifiable" verification **impossible to satisfy**. The required
implementation ACTION (thread the owner into both backfill sites) is correct and unchanged — this
is a one-line-per-item accuracy fix to the pinned enumeration and one task clause, not a redesign.
I flag it rather than waving it through specifically because a verification that cannot go red is
how both prior defects survived, and because C11 is now the canonical list future rounds will
trust.

### Change Requests

1. **D2's table claims `:694` is AI-reachable; it is not, by the table's own reasoning — and that
   makes task 2.4a's mutation clause unsatisfiable at that site.** Ground truth,
   `PipelineRunService.scala:695`:

   ```scala
   else backend
     .execute(pipeline, roots, Vector.empty, dataSourceRepo, new AssertionSink, new TruncationSink)
   ```

   It passes `Vector.empty` steps — identical to `:495`, the site the same table correctly marks
   "AI reachable? **No** — n/a, no steps". With zero steps no step evaluates, so no AI step can
   run there. Two consequences to fix:

   - The `:694` row's "AI reachable? **Yes**" is false; it should read No, for the same
     zero-steps reason as `:494`. Only `:710` (the `slicedSteps.toVector` closure arm,
     `NodeDependencyClosure.closureOf`, line 711) is a genuinely AI-reachable backfill site.
     Correct this in D2, and in C11 in BOTH `tasks.md` and `workflow-state.md` (C11 currently
     asserts both backfill sites need threading without distinguishing reachability).
   - The `:694` row is also MISLABELLED "Output backfill, node arm". Per the code it is the
     **source/root-level** arm (`case allRoots if targetStepId.isEmpty`, `:676`); `:710` is the
     step/node arm (`case Some(target)`, `:707-711`). The labels are currently swapped in spirit
     and will mislead the executor about which site to test.
   - Task 2.4a says "a mutation dropping the threading at **either** site makes it go red." That
     cannot be satisfied at `:694`: no AI step is reachable there, so no AI-client assertion can be
     made red by mutating it. Restate 2.4a so the falsifiable mutation evidence is required at
     `:710` (where it is genuinely achievable), and state plainly that `:694` is threaded for
     uniformity/future-proofing with NO behavioral test possible — rather than demanding red
     evidence that does not exist. As written, an executor must either fabricate that evidence or
     silently drop the clause.

   Note the fail-closed danger argument in D2/2.4a survives this correction intact **for `:710`**,
   which is the site that matters: left unthreaded, `ownerUserId = None` → not permitted (3.5c) →
   every AI-pipeline step-bound Output backfill breaks invisibly through the log-only `.recover`
   arms, including for uncapped `owner`-tier users. Keep that reasoning; just attach it to the
   right site. (Threading `:694` anyway remains harmless and is fine to keep as a mandate.)

### Non-blocking notes

- **N9 (minor line-reference imprecision, no action strictly required).** D2 and task 2.2 say
  `executeTree` "forwards it into `makeContext` (`:686-705`)". `:686-705` is `makeContext`'s
  *definition*; the **call** `executeTree` must actually change is at `InProcessPipelineEngine
  .scala:418`. Naming `:418` alongside the definition would save the executor a lookup. (The
  other `makeContext` call, `:218`, is the test-only flat path D2 correctly leaves defaulted.)
- **N10 (artifacts are uncommitted).** The whole change directory is untracked
  (`?? openspec/changes/gate-ai-steps-tier-limits/`), so `BASE...HEAD` is empty and nothing in
  this design is yet captured in a commit. Harmless for a design gate — but it means the round-1
  and round-2 reports and these artifacts exist only in the worktree, which `cleanup.sh --phase4`
  would remove. Worth a commit before execution begins.
- **N11.** D2's prose still says the plan "previously reasoned about three" sites; once CR1 is
  applied, the honest count is four threaded sites of which two (`:494`, `:694`) are
  zero-step/non-AI-reachable and threaded only for uniformity. Stating it that way makes the table
  self-consistent.
