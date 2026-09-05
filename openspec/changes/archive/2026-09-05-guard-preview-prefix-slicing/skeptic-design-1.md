## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` in the change dir.
- `grep -rn "closureOf" backend/src/main/scala` -> exactly two production call sites:
  `PipelineRunService.scala:507` and `PipelineRunService.scala:662`. Confirms the plan's
  correction of the ticket's stale line-403/`pathToRoot` premise.
- `sed -n '495,545p' PipelineRunService.scala` — site 1 is `previewStep` (def at :293); masking
  lookup at :527 confirmed verbatim; `outcome.stepCounts` is passed straight into
  `RunResultResponse` at :536 without passing through the node-keyed lookup. **Design Decision 1's
  observation surface is sound.**
- `InProcessPipelineEngine.scala:403,449` — `counts` is built as
  `if (next.enabled) counts = counts.updated(next.id.value, ...)` inside the Kahn loop over the
  `steps` vector it was handed. So `stepCounts.keySet` == the set of ENABLED steps in the slice,
  keyed by step id. Decision 1 holds; the widening mutation will add keys. (One caveat, CR3 below.)
- `sed -n '650,675p'` + `grep -n "def previewOutputs\|def backfill"` — **site 2 (:662) is NOT
  `previewOutputs`.** It is inside `private def evaluateNodeRowsForBackfill(...): Future[Unit]`
  (`def backfillOutputNode` at :592). The real `previewOutputs` (:329) does not call `closureOf`
  at all. This falsifies design Decision 4 and tasks 3.1/3.2 as written.
- `sed -n '108,110p'` — `private val backend: PipelineExecutionBackend = if (executionBackend != null) ...`,
  i.e. the execution backend IS constructor-injectable. Relevant to CR2.

### Verdict: REFUTE

The step-preview half of the plan (Decisions 1-3, tasks 1, 2, 4.1-4.4) is sound and unusually
well-aimed at the "green test that discriminates nothing" failure mode. The second-call-site half
(AC5, Decision 4, task 3) is built on a factually wrong premise and, as written, cannot produce a
discriminating guard — it would most likely be dropped via the 3.2 escape hatch on a false finding.

### Change Requests

1. **Correct the identity of the second slicing site in `design.md` Decision 4 (and the tasks).**
   Line 662 is `evaluateNodeRowsForBackfill` (backfill for `backfillOutputNode`), returning
   `Future[Unit]`; it discards `outcome.stepCounts` entirely and only persists the TARGET's rows via
   `persistBackfilledRows`. `previewOutputs` (:329) does not slice. The plan must name the site
   correctly, or an implementer will hunt for a `previewOutputs` slice that does not exist.

2. **Decision 4's prescribed assertion surface is provably degenerate — replace it.** It says to
   guard the site "in `PipelineRunServiceSpec` against the returned envelope" / "route response".
   There is no envelope: the only observable output is the persisted target rows, and those are read
   through the SAME node-keyed lookup at :664 — so widening the slice cannot change them. An
   assertion on persisted rows is exactly the masked, non-discriminating test this ticket exists to
   prevent. Name a mechanism that actually observes the executed node set. The viable one is already
   available: `PipelineRunService` takes an injectable `executionBackend` (:108), so a spy
   `PipelineExecutionBackend` that captures the `steps: Vector[PipelineStep]` argument handed to
   `execute` discriminates the widening mutation directly. Because that mechanism exists, the task
   3.2 "genuinely unassertable -> scope out with a follow-up" escape hatch must be closed: state in
   `design.md` that scoping out requires first demonstrating the spy-backend approach fails.

3. **Rule out the disabled-node degeneracy the plan does not mention.** `stepCounts` gets NO entry
   for a disabled node (`InProcessPipelineEngine.scala:449`). Two consequences the fixtures must
   handle explicitly: (a) if the off-closure node in a fixture is disabled, M1 is silently
   non-discriminating — every fixture node outside the closure must be `enabled = true`; (b) task
   2.1's "assert `stepRowCounts.keySet` equals exactly the target's closure" is only true when every
   node in the closure is enabled. Restate the expected set as "the enabled members of the target's
   closure" and add this to the task 2.3 comment requirement.

4. **State the AC3 axis accounting honestly in `design.md`.** M4 is the SAME mutation as M1 on a
   different fixture (design already concedes this). If M3 turns out to red for the wrong reason
   (likely: dropping ancestors leaves `isReady` unsatisfiable, so `loop` fails with
   `LaneReferenceError` and the test reds on a 500, not a key-set mismatch), the surviving true
   code-mutation axes collapse to M1 and M2 alone. Pre-commit to a concrete replacement for M3 that
   fails for the right reason — e.g. drop only the TERMINAL end (`closure.dropRight(1)`, an
   off-by-one that still executes a valid connected slice) — rather than leaving the substitution
   unspecified at execution time.

### Non-blocking notes

- Constraints (no production diff, no migration, no Playwright/e2e, EmbeddedPostgres) are stated
  clearly in Decision 5 and re-checked in task 5.3; good.
- Task 1.3's "confirm the existing tests stay GREEN under M1, else escalate" is the right
  premise-validation order and should be kept exactly as written.
- `mutation-evidence.md` as a separate artifact is fine and does not collide with report numbering.
