## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD: d7be12a125a6ea219527a9268b675ff52584b1b2. Base resolved live with `resolve-review-base.sh`: 25aca36601d8c10a3d098f0354549d2af0342230. Scope is the owner's extra round, limited to CR1-CR3 of skeptic-final-2.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/run-path-memory-bounds/HEL-1660`.
- **Round-3 diff** (`git diff 437f325..HEAD`, one commit, d7be12a12). The only main-code change is `NodeSnapshotRepository.overwriteRowsAction`:
  - Rows are grouped `SnapshotInsertBatchSize = 200` at a time.
  - Each batch's `compactPrint` runs inside `DBIO.successful(()).flatMap(_ => insertBatch(batch))`, so it is deferred until that batch runs.
  - The batches are folded onto `deleteAction` with `andThen`.
- **Atomicity holds.** I read the code at HEAD:
  - The run guard still runs first (`guard.fold(action)(g => g.andThen(action))`).
  - The whole replace is still one `.transactionally` inside one `withSystemContext`.
  - The delete still runs before every insert, and the SQL text is unchanged.
  - `overwriteRowsWith` still appends `andThen`, the history insert, inside the same `withSystemContext` call.
  - The history and summary writes are unchanged.
- **Backfill goes through the change.** `PipelineRunBackfill.scala:159` calls `nodeSnapshotRepo.overwriteRows`, which reaches `overwriteRowsAction`. CR3 is covered by construction, as design.md "Cycle 4" says.
- **The round-2 shape is fixed.** I re-ran my round-2 probe at HEAD:
  - Setup: the scratch `backend/src` is identical to HEAD (`diff -rq` shows only the probe file added), the `RunPathHeapSpec` harness is copied verbatim, forked `-Xmx768m` (`maxMemory MB: 768`), 2 repeats, under the sbtfull lock, sbt exit 0.
  - `heavy-utf16` real: 102.5 / 102.0 MB, down from 211. Dry: 98.5 / 97.9 MB.
  - These match the executor's `green-utf16-heap.summary.txt`.
- **NEW: another accepted shape breaches 192 MB, at 294 MB.** This is the deciding check.
  - The batch is bounded by row count (200 rows), not by text size. So a node with at most 200 rows is written as a single batch, and the write still builds a second full copy of the node's text at once. That is exactly the round-2 defect, now limited to short, text-heavy nodes.
  - Shape (`fewrows-utf16-200`): the same total text as `heavy-utf16`, spread over 200 rows instead of 7,000.
    - Source: a 200 x 2 CSV of 35,000-character text. That is about 14.0 MB, inside every `CsvLimits` cap: 15 MB, 50,000 rows and 300,000 cells.
    - Steps: the same 3 `concat($a, $b, "ж")` compute steps (`textHeavySteps(MaxLiveCells)`).
    - Outputs: one Output, on the terminal.
    - This is an ordinary document-style pipeline: a few hundred long non-English texts.
  - The walk prices text by length, so it accepts this shape like the 7,000-row one. `postWalkCells` charges only `columns + 6` cells per row, about 200 x 11 x 2 cells, so its check cannot see the shape.
  - Result (stable, swing 0.7 MB):
    ```
    shape fewrows-utf16-200   real delta MB  294.7  succeeded, 200 rows
    shape fewrows-utf16-200   dry  delta MB   93.6  succeeded, 200 rows
    shape fewrows-utf16-200   real delta MB  294.0  succeeded, 200 rows
    shape fewrows-utf16-200   dry  delta MB   93.6  succeeded, 200 rows
    max over shapes MB: 294.7 (bound 192.0); largest swing between repeats of one shape: 0.7 MB (repeats: 2)
    ```
  - The run is accepted and succeeds at 294 MB. That is 53% over the owner's 192 MB (ruling 3, AC3), and worse than the 211 MB that was refuted in round 2.
  - The dry run, which writes no snapshot, peaks at 93.6 MB. So the extra roughly 200 MB is the snapshot write.
  - Persisted evidence (self-authenticating log numbers, no mtime reasoning):
    - Summary: `/home/matt/Development/helio/.concertino/runs/HEL-1660/evidence/.concertino/scratch/HEL-1660/skeptic-final-probe/probe-round3-summary.txt`
    - Probe source: `/home/matt/Development/helio/.concertino/runs/HEL-1660/evidence/.concertino/scratch/HEL-1660/skeptic-final-probe/backend/src/test/scala/com/helio/services/pipelines/SkepticRound3HeapProbe.scala`
- **The guard does not pin the behaviour.**
  - `NodeSnapshotBatchedWriteSpec` asserts `SnapshotInsertBatchSize <= 200` and that rows round-trip. Its recorded mutation (`snapshot-write-unbatched`) only changes the constant.
  - Moving `compactPrint` back out of the deferred `flatMap` would bring back the eager full copy with the constant still at 200. Both spec cases would stay green.
  - The only check that would catch that regression is `RunPathHeapSpec`. It is opt-in (`HELIO_MEASURE=1`), so it does not run in CI.
- **Prior points.** The round-1 and round-2 findings, apart from CR1-CR3, were not reopened: no other main-code file changed in this round. The atomicity and backfill points above hold.

### Verdict: REFUTE

This is a NEW finding: a different accepted shape over 192 MB. Per the owner's instruction, this should be escalated, not looped.

### Change Requests

1. **NEW: AC3 / owner ruling 3 is not held for nodes of 200 rows or fewer. An accepted run peaks at 294 MB.**
   - The shape: a 200 x 2 CSV of 35,000-character text, 3 `concat($a, $b, "ж")` steps and an Output on the terminal.
   - The cause: `NodeSnapshotRepository.scala` `SnapshotInsertBatchSize = 200` bounds a batch by rows, while the copy it is meant to bound is text.
   - Possible fixes, or one of equal effect:
     - Bound each batch by accumulated JSON text (or by row count AND text size). For example, flush a batch once its `compactPrint` length passes a fixed character budget, always with at least one row, so a batch's copy is small whatever the row width.
     - Or write each row's text in its own deferred action.
   - Re-measure `fewrows-utf16-200`, plus a 1-row and a ~20-row variant of the same total text, under the same rules (forked `-Xmx768m`, repeats).
2. **Pin the deferral, not just the constant.** Add a deterministic guard that fails if every row's JSON text is built before the first insert runs. For example, count `compactPrint`/insert-statement construction against executed batches through a test seam, or assert the size of a batch's text. Record a mutation that moves `compactPrint` out of the deferred `flatMap` and turns that guard red. Today only the constant is mutated.

### Non-blocking notes
- The scaladoc for `overwriteRowsAction` ("The replace as a composable `DBIO`…") now sits above `SnapshotInsertBatchSize`, so it documents the `val`, not the method.
- No gate defect to record: nothing here, or in the reports I drilled into, relies on mtime ordering.
