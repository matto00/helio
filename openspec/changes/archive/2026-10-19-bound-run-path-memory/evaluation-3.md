## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: 2859de639ba30bc8c242b07d8911c45a68bbd1f5. I reviewed the delta since my cycle-2 PASS at 83359b000:
- 437f325c8: post-walk pricing.
- d7be12a12: batched snapshot write.
- 25e718d49: merge of main. It touches frontend only and I did not review it beyond confirming that.
- 2859de639: archive commit. It adds no Scala.

The known, owner-accepted round-3 item (batches capped by row count rather than bytes; 294 MB UTF-16 shape; HEL-1679; `proceed-to-delivery`) is out of scope for this verdict.

### Phase 1: Spec Review — PASS
- Owner ruling 3 is now enforced after the walk as well as during it. `RunLimits.postWalkCells` / `MaxPostWalkCells` (3,900,000) is checked in `PipelineRunExecutor` before any write. A refusal is a clean step error on the terminal step, with no snapshot written. `PipelineRunLimitsServiceSpec` tests this with the 17-step, two-Output shape.
- AC6 is still accepted. `RunLimitsGuardSpec` pins the AC6 post-walk cost at exactly 3,900,000.
- The capacity trade-off is disclosed in design.md "Cycle 3": the limit equals AC6's cost, so an Output one column wider than AC6's shape is refused. That is consistent with my cycle-2 Point 1. It belongs in the PR body, which the orchestrator says already carries the disclosures.
- C1 holds: the ruled numbers are unchanged.

### Phase 2: Code Review — FAIL
Gates (fresh, run by me under the sbtfull lock, at 2859de639): `sbt testFull` gave **Tests: succeeded 9375, failed 0, canceled 5**, EXIT=0. I did not rely on `green-testfull-cycle4.summary.txt`.

What is correct:
- **Batched write atomicity is correct.** `guard.fold(action)(g => g.andThen(action)).transactionally` wraps the whole chain: guard, then delete, then every batch through its `flatMap` continuation. Slick pins one session and one transaction across `flatMap` inside `.transactionally`, so a failure in any batch rolls back the delete and every earlier batch. The SQL and row indices are unchanged.
- **The post-walk check is correct.**
  - It prices each retained frame once by identity, so a disabled-step passthrough is not double-counted, plus the terminal's JSON copy plus the largest other Output's copy. That matches what `PipelineRunSucceededWrites` actually holds: the terminal reuses `jsRows`, and the other Outputs are converted one at a time.
  - Dry runs are skipped, and they retain nothing.
  - The check runs inside `.map` before `transformWith`, so the failure takes `executeRunFailure` before any write-back, snapshot, history or alert.
  - Not pricing text length here is sound. The retained frames' text is already inside the walk's length-priced tally at walk end, `JsString` shares the `String`, and the remaining `compactPrint` copy is the batched-write concern.
- The three `postwalk-*` mutations exercise the real mechanism: limit unbounded, check not called, copies dropped. Each is red against an asserting spec.

Issues:
1. **The batched write's load-bearing property has no CI guard; only a constant pin does.** The cycle-4 fix works because each batch's `compactPrint` text is built lazily, when that batch runs:
   ```scala
   acc.andThen(DBIO.successful(()).flatMap(_ => insertBatch(batch)))
   ```
   This is `NodeSnapshotRepository.scala:172-173`. The obvious refactor `acc.andThen(insertBatch(batch))` builds every batch's JSON text up front. That reintroduces exactly the second full copy of the node's text (210 MB, `evidence/red-utf16-heap.summary.txt`).

   Every spec in `testFull` would stay green under that refactor:
   - `NodeSnapshotBatchedWriteSpec` checks only `SnapshotInsertBatchSize <= 200` and the content of the rows written. The eager variant writes identical rows.
   - The recorded mutation `snapshot-write-unbatched` (`200` -> `100000`) only turns the constant check red.
   - The only thing that would catch it is the opt-in `RunPathHeapSpec`, which does not run in CI.

   This is a guard that cannot fail for the regression it exists to prevent, so C2 ("a mutation that turns its spec red" per bound) is met only in form.

### Phase 3: UI Review — N/A
The merge commit 25e718d49 brings in main's frontend change, which is already on main (HEL-1665, #1068). This branch makes no frontend change of its own. The orchestrator reports CI green on 2859de639 and a full local e2e pass of 618.

### Overall: FAIL

### Change Requests
1. **`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:161-174` and `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotBatchedWriteSpec.scala`: add a deterministic spec that fails when the batch JSON is built eagerly.**
   - Suggested approach: make the per-row JSON rendering a seam, for example a `private[persistence]` `render: JsObject => String` parameter or overridable member defaulting to `_.compactPrint`. Then assert in the spec that when the first INSERT batch executes, at most `SnapshotInsertBatchSize` rows have been rendered.
     - One way to observe this: record the render count from a counting `render`, and have each batch's DBIO snapshot that count before its inserts run.
     - Another way: write 450 rows and check that the maximum rendered-but-not-yet-inserted count stays at or below 200.
   - Then record a mutation `snapshot-write-eager` (replace `acc.andThen(DBIO.successful(()).flatMap(_ => insertBatch(batch)))` with `acc.andThen(insertBatch(batch))`) that turns it red, in the archived `evidence/mutations.md`.
   - No production behaviour change is needed beyond the seam.

### Non-blocking Suggestions
- `NodeSnapshotBatchedWriteSpec`'s doc says "replacing the previous snapshot atomically", but nothing tests atomicity. A case where batch 2 fails (for example, a row whose `data` is not valid jsonb) and the earlier snapshot survives intact would back the claim.
- `RunLimitsGuardSpec` "hold the post-walk limit at or under the measured ceiling": `MaxPostWalkCells <= 3900000L` repeats the constant it guards. It is a tripwire, as in cycle 2. That is fine, but label it as a tripwire, not as a measurement.
