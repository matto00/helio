## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Independently re-derived every load-bearing fact from source, not from round 1's report or the plan.

- `grep -rn "closureOf" backend/src/main/scala` -> exactly two production call sites,
  `PipelineRunService.scala:507` and `:662`. Plan's corrected premise holds.
- `sed -n '500,540p' PipelineRunService.scala` — :507 `NodeDependencyClosure.closureOf(sortedSteps.toVector, target)`;
  masking lookup verbatim at :527; `outcome.stepCounts` passed straight into `RunResultResponse` at :536,
  NOT through the node-keyed lookup. **Decision 1's observation surface is real.**
- `grep -n "def ..."` — :507 lives in `private def previewAtNode` (:403), the shared implementation
  `previewStep` (:293) and `previewOutputs` (:329) both delegate to. Round 1's claim that the site is
  `previewStep` was itself imprecise; the plan's Context section is the accurate one.
- `sed -n '655,675p'` + `grep -n` — **CR1 lands and is correct**: :662 is inside
  `private def evaluateNodeRowsForBackfill` (:631), reached from `def backfillOutputNode` (:592); returns
  `Future[Unit]`; discards `stepCounts`; persists only target rows read through the same node-keyed lookup
  at :666. An output assertion there is provably invariant under widening, exactly as Decision 4 states.
- **CR2 lands and is mechanically feasible**: `PipelineRunService.scala:67` `executionBackend: PipelineExecutionBackend = null`,
  `:109` `if (executionBackend != null) executionBackend else new InProcessExecutionBackend(...)`.
  `PipelineExecutionBackend.execute` (trait :25) takes `steps: Vector[PipelineStep]` — the exact argument the
  spy must capture. Six specs already construct `new PipelineRunService(...)` directly
  (`PipelineRunRoutesSpec:229,799`, `PipelineRunServiceSpec:134`, others), and `backfillOutputNode` is already
  exercised by `PipelineRunServiceSpec`/`OutputRoutesSpec` — so there is a live invocation path to spy on.
  The escape hatch is closed in both `design.md` D4 and task 3.4. Good.
- **CR3 lands on a real fact**: `InProcessPipelineEngine.scala:449`
  `if (next.enabled) counts = counts.updated(next.id.value, nextFrame.size.toLong)`. `stepCounts` is keyed by
  executed ENABLED node id. The disabled-off-closure-node degeneracy is genuine, and Decision 2 + task 2.1a
  address it as a fixture property with an explicit assertion, not a hope.
- **CR4 lands**: Decision 3 now states plainly that M4 is the same code mutation as M1 on a different fixture
  (reported as a fixture axis), names M3's wrong-reason risk concretely, and pre-commits the substitute
  (`closure.dropRight(1)`) rather than deferring the choice to execution time. Task 4.7 requires the same
  accounting in `mutation-evidence.md`.
- Discrimination sanity-check on the mandatory axes: M1 (full list) adds off-closure enabled node keys; M2
  (`closureOf(..., sortedSteps.head)`) collapses the key set to a root's closure. Both change
  `stepRowCounts.keySet` on a non-degenerate fixture. AC3's "more than one axis" is satisfied by M1+M2 alone,
  independent of M3's fate — so the plan's minimum bar does not rest on the riskiest mutation.
- Constraints re-checked: no production-source edit is prescribed (mutations are apply-run-revert), no
  migration anywhere, no Playwright/e2e; task 5.3 re-asserts a clean `git diff --stat` as a gate.

The plan's bar is the ticket's bar — assert the executed node SET, on a fixture where correct output is a
proper subset of the pipeline's nodes, proven red by running real mutations. That is precisely the
discrimination the three green-but-vacuous runs lacked.

### Verdict: CONFIRM

### Non-blocking notes

1. `design.md` D4 says "`previewOutputs` (:329) does not slice at all" and "an implementer sent looking for a
   `previewOutputs` slice will find nothing." Literally true of its own body, but `previewOutputs` DOES reach
   the :507 slice through `previewAtNode`. Nothing in the plan breaks — :507 is guarded, and AC5's second site
   is correctly re-identified as :662 — but a one-line clarification ("`previewOutputs` delegates to
   `previewAtNode`, so it is covered by the :507 guard") would prevent a future reader re-opening this.
2. M3's pre-committed substitute `closureOf(...).dropRight(1)` assumes the target is LAST in the closure vector.
   Per `NodeDependencyClosure`'s own doc, the result is emitted in `steps` (repository) order filtered to
   membership — NOT target-last. On the linear-trunk fixture the target likely is last; on the M4 branching
   fixture it may not be, in which case `dropRight(1)` removes a mid-closure ancestor and reds for the wrong
   reason again. Recommend the executor record WHICH node the mutation actually dropped alongside the failure
   output. The plan's existing "a red for an unrelated reason is not evidence" rule already prevents a bogus
   axis from being counted, so this is a sharpening, not a gap.
3. `tasks.md` lists 4.7 before 4.6. Cosmetic ordering only.
