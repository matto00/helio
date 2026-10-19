## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed: worktree HEAD 069afd36d5c69d245c0f3c779b9a4fc6d160b52b, with the untracked change dir
`openspec/changes/bound-run-path-memory/` (ticket.md, proposal.md, design.md at 150 lines, tasks.md,
specs/pipeline-run-memory-bounds/spec.md). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/run-path-memory-bounds/HEL-1660`.

### What I verified (with evidence)

**Owner rulings.** `.concertino/runs/HEL-1660/events.jsonl` has 2 `escalation.answered` events, both
`answer_source":"human"`, carrying `nonfatal-plus-stackoverflow-arm` and `accept-50kx6`. ticket.md rulings 1-8 match.

**Round-3 change requests.**

| CR | Status | Evidence |
|---|---|---|
| 1(a) Second-node OOM spec would hang | Resolved | D7 now separates thrown from returned failures, says position does not decide the path, and states the boxed case is a step that *returns* `Future.failed`. The proof table has "OOM returned as `Future.failed`" and states that no spec throws a fatal error on a later node. The "never completes" sentence is present. |
| 1(b) Boxed SOE contradicted the guard | Resolved | The guard has an explicit SOE exemption (unwrap, then convert), and the table row "SOE returned as `Future.failed`" has the mutation "drop the guard's SOE exemption". |
| 2 Text-light/text-heavy split | Resolved | D6 names both just-under-budget variants, each run as a real run and a dry run, max taken. Task 3.3 repeats it. |
| R3 note: name the outcome of a later-node non-OOM fatal error | Resolved | D7: "Pekko's `jvm-exit-on-fatal-error` exits the instance, or the run hangs until the instance goes." |
| R3 note: redundant guard clause | Resolved | The guard text no longer has the `StepExecutionException` clause. |

**Earlier rounds (lost to condensing?).** None lost. These are still present: required `retain` with no default and
its empty-set mutation (R1 CR5, D3), root pinning and write-back pinning under `runRetention`, each with a spec and a
mutation (R1 CR3, R2 CR4, D3a), terminal retention only under the run-only flag, so the draft is unchanged (R2 CR1),
end-to-end measurement with real `nodeSnapshotRepo`/`outputHistoryRepo` (R1 CR4, R2 CR3, D6), AC6 = 50k x 6 per
`accept-50kx6` (R1 CR2), SOE ruling (R1 CR1), the warn downgrade only for Outputs absent from `retain`,
`SparkJobSubmitter` in Impact, and escalation (not a unilateral raise) if AC6 does not fit.

**Citations re-read at 069afd36d.** All hold except one off-by-region (see note 1):
- `InProcessPipelineEngine.scala:297`: `catch { case ex: Throwable => Future.failed(ex) }`. This is the only `Throwable`
  catch (grep). `:298-303` is `recoverWith` → `StepExecutionException.from`. `:528-531` is leaf-first keyed on
  `ctx.maxLiveCells.isDefined`. `:537` is `getOrElse(rootFrames.head._2)`. `:604-609` is `trunkRows`, with the
  lowest-root fallback at `:607`. `:907-913` is `csvRowsWithinLimits`.
- `InProcessExecutionBackend.scala:53-62`: `loaded`/`primaryRows` are held until the `yield`; `:61` is the only
  production `executeTree` call besides `DraftPreviewService.scala:188-200`. A grep of `main/` finds the callers of
  `backend.execute`: `PipelineRunExecutor:245`, `PipelineRunPreview:198,280` and `PipelineRunBackfill:121,138`. Flat
  `execute`/`executeWithStepCounts` has no production caller. D1's "one entry" claim holds.
- `PipelineRunExecutor.scala:23-36`: the constructor has no `outputRepo`. `:282-285` is `jsRows`. `:447` is `applyWriteBacks`.
- `PipelineRunSucceededWrites.scala`: `:88` is the null-repo gate. `:96-101` is the StepKey/RootKey mapping. `:104` is
  the intersect. `:110` is `nodeJsRows`. `:218-222` is the "never evaluated by the tree walk" `log.error`.
- `UpsertSourceStep.scala:34` records the whole input `rows`. `CsvLimits.scala:17-19` is 15 MB / 50,000 / 300,000.
  `ExpressionInterpreter.scala:270-271` is `checkLength(length, maxChars: Int)`. `Dockerfile:46` is `MaxRAMPercentage=75.0`.
- `InProcessPipelineEngineDraftSeamSpec.scala:103-108` (order keyed on `maxLiveCells`) and
  `DraftPreviewHeapSpec.scala:83-92` (`BudgetOverridingEngine` override of the full `executeTree` signature): task 2.3's
  coupling change is real and correctly scoped. Adding a `leafFirst`/`runRetention` parameter forces that override to change.

**D7 mechanics checked against the code.**
- The first node is evaluated synchronously from `executeTree`, through `loop(steps)` → `evalNode` → `evalOneStep`.
- Later nodes are evaluated inside `transformWith`'s success callback (`:541-560`).
- The table's mutations each bite:
  - With the `try` reverted to `Throwable`, a first-node OOM becomes a boxed failed Future rather than a synchronous
    escape, so the spec goes red.
  - Dropping the pass-through converts the returned OOM into a `StepExecutionException`, so the spec goes red.
  - Dropping the SOE `try` arm lets the SOE escape, so the spec goes red. On a later node it hangs and goes red through
    the spec's await timeout.
  - Dropping the SOE exemption lets the boxed SOE pass through as `ExecutionException`, so the spec goes red.

**Coverage.** AC1→1.1/1.2, AC2→3.1, AC3→2.4/3.3, AC4→2.2/3.1, AC5→2.1/3.2, AC6→3.4, AC7→2.7, AC8→C6/2.1/2.3,
AC9→C2/3.1/2.7. There are no TODO/TBD placeholders and no scope beyond the ticket. HEL-1676 and HEL-1677 are excluded.

### Verdict: CONFIRM

The plan is sound and verifiable. Every round 1-3 change request is resolved, and condensing lost none of them. The
remaining issues are wording-level and resolvable in execution without a design decision. The notes below are for the
executor and evaluator.

### Non-blocking notes

1. **D7 overclaims the SOE message.** D7 says SOE is converted "via `StepExecutionException.from(step, rawSoe)`, so the
   message names a stack overflow", and the proof table expects a "`StepExecutionException` naming the overflow".
   `StepExecutionException.from` (`InProcessPipelineEngine.scala:54-58`) maps any non-`IllegalArgumentException` cause
   to the reason `"step execution failed"`. So the message will not name the overflow; only `getCause` will be the SOE.
   This is today's wording too, and ruling 8 ("stays a step error") plus the spec scenario ("naming that step") are
   satisfied either way. Executor: assert `getCause.isInstanceOf[StackOverflowError]` plus the step id/kind in the
   message. Do not widen HEL-859's allowlist unless you record it as a deliberate wording change. Evaluator: check that
   the SOE specs assert on the cause, not on a message substring the code cannot produce.
2. D3 cites the trunk terminal's "lowest-root fallback" as `:537`. That line is the parent-frame fallback
   (`rootFrames.head._2`). The terminal fallback that `runRetention` must preserve is `:607`
   (`orElse(nodeOutcomes.get(RootKey(lowestRootId)))`). The intent is unambiguous: keep the lowest root in
   `nodeOutcomes` when there is no trunk terminal, otherwise `trunkRows` becomes `Seq.empty`. Give that case its own
   assertion in the 2.4 terminal-retention spec (a pipeline whose lowest root has no trunk steps).
3. The D6 sentence "Each runs as both a real run and a dry run, and the worst post-walk peak is the max of the four
   (...), and the AC6 ordinary shape" is garbled by condensing. Task 3.3 makes the intent clear: the two
   just-under-budget variants x {real, dry}, max taken, with AC6 measured as well.
4. Injecting a fatal error into a step for the D7 specs needs a seam: for example, a `contextTransform`-supplied stub
   (AI client or lane resolver) or a stubbed `dataSourceRepo` for a join's secondary read. One stub must *throw* and
   one must *return* `Future.failed`. Name the seam in the spec, so the thrown/returned distinction is visibly real and
   not two spellings of the same path.
5. Preview and backfill each call `execute` twice (`PipelineRunPreview:198/280`, `PipelineRunBackfill:121/138`): once
   root-only with no steps, once with the sliced closure. Both calls need a `retain` (the root key for the first, the
   target `StepKey` for the second). The required parameter forces this at compile time; this note is only so the
   target choice is deliberate.
