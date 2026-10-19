## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: 437f325c86202b5f2982231ccd2d327d1ae37780. Base resolved live with `resolve-review-base.sh`: 25aca36601d8c10a3d098f0354549d2af0342230.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/run-path-memory-bounds/HEL-1660`.
- **Cycle-3 diff** (`git diff 25e718d49..HEAD -- backend/src/main`). Only two files changed:
  - `RunLimits.scala` adds `RowCostCells`, `MaxPostWalkCells` and `postWalkCells`.
  - `PipelineRunExecutor.scala` adds `refuseOverPostWalkBudget`, which is called only when `!isDry`, inside the `backend.execute(...).map`.
  - It throws a `StepExecutionException`, which becomes a failed future. That goes to `executeRunFailure`, so nothing is written.
  - No draft-preview file, no D7 code and no `jsRows` reuse code changed since round 1, so my round-1 findings on AC8, D7 and the `jsRows` reuse still hold.
- **Round-1 refutation shape is now refused.** I re-ran it at HEAD: a scratch copy of `backend/` at HEAD with the harness copied verbatim from `RunPathHeapSpec`, forked `-Xmx768m` (`maxMemory MB: 768`), 2 repeats, under the sbtfull lock.
  - `adjacent-outputs` real: 116.4 / 115.6 MB, both refused with "Pipeline execution failed at step … (compute): Pipeline run memory limit re…".
  - `adjacent-outputs` dry: 115.6 / 115.8 MB, succeeded.
  - The check is effective for the cell-heavy shape it was built for.
- **A different accepted shape breaches 192 MB (the deciding check).** `postWalkCells` prices each row as `columns + 6`. It never looks at text length.
  - The copy it misses is in `NodeSnapshotRepository.overwriteRowsAction` (lines 157-158). It runs `row.compactPrint` for every row eagerly (`rows.zipWithIndex.map`) before `DBIO.seq`.
  - So the whole node's JSON text exists at once as new Strings: a second full copy of every character the Output holds.
  - The executor's own Latin-1 `just-under-heavy` control shows this doubling: dry 57.7 MB, real 115.0 / 115.1 MB.
  - The walk budget (`CellWeight.BytesPerChar = 2`) explicitly prices text as UTF-16, the worst case. A run whose text is not Latin-1 is therefore accepted by the walk at the same cell count, and all of its copies are twice as large.
  - The shape: the executor's text-heavy shape (7,000 x 2 CSV of 1,000-character text, `textHeavySteps(MaxLiveCells)` = 3 compute steps), except each step is `concat($a, $b, "ж")`. That is one Cyrillic character, so the new text is UTF-16. There is one Output, on the terminal. This is an ordinary non-English-text pipeline.
  - Result (stable, swing 0.6 MB):
    ```
    shape heavy-utf16        real delta MB   211.0 / 211.3  succeeded, 7000 rows
    shape heavy-utf16        dry  delta MB    98.5 /  97.9  succeeded
    shape heavy-utf16-2out   real delta MB   210.7 / 210.6  succeeded   (plus an Output on the parent)
    shape heavy-utf16-2out   dry  delta MB    97.9 /  97.9  succeeded
    max over shapes MB: 211.3 (bound 192.0); largest swing 0.6 MB
    ```
  - The run is accepted and succeeds at 211 MB, 10% over the owner's 192 MB (ruling 3, AC3). The breach does not depend on the margin rule the executor disclosed: it is over 192 MB outright, on every repeat.
  - The post-walk check computes about 7000 x (5 + 6) x 2 ≈ 154,000 cells for this run, against a limit of 3,900,000, so it cannot see it.
  - Persisted evidence:
    - `/home/matt/Development/helio/.concertino/runs/HEL-1660/evidence/.concertino/scratch/HEL-1660/skeptic-final-probe/probe-round2-summary.txt`
    - The probe source: `/home/matt/Development/helio/.concertino/runs/HEL-1660/evidence/.concertino/scratch/HEL-1660/skeptic-final-probe/backend/src/test/scala/com/helio/services/pipelines/SkepticRound2HeapProbe.scala`
    - These are self-authenticating numbers from the log. There is no mtime reasoning.
- **Coverage of success-path consumers.**
  - `PipelineRunExecutor` is the only run-path caller of `backend.execute` with a post-walk check.
  - `PipelineRunBackfill` (lines 121 and 138) is listed by the ticket as a real-run path ("manual, scheduled, hook, auto-run, backfill"). It builds `nodeJsRows` and calls `overwriteRows` (the same eager `compactPrint`) with no post-walk check.
  - Backfill holds fewer copies (one frame plus one JSON copy), so in cells it is below the run case. The text-copy gap above applies to it equally.
- **Dry runs:** they write nothing and build no snapshot text. The measured dry peaks are 98.5 MB worst here and 149.4 MB worst in the executor's table, so leaving the check off dry runs is safe.

### Verdict: REFUTE

### Change Requests

1. **AC3 / owner ruling 3 is not held: an accepted run peaks at 211 MB.** The shape is a 7,000 x 2 CSV of 1,000-character text with 3 `concat($a, $b, "ж")` steps and an Output on the terminal (evidence above). The post-walk accounting has to price what the snapshot write actually allocates, including text by length. Either option works, or one of equal effect:
   - (a) Make `RunLimits.postWalkCells` charge text by length with `CellWeight` (as the walk does), for the held frames and for each JSON or `compactPrint` copy. Then re-check `MaxPostWalkCells` against AC6.
   - (b) Stop `NodeSnapshotRepository.overwriteRowsAction` (`NodeSnapshotRepository.scala:157-158`) from materialising every row's `compactPrint` String at once. For example, build each statement's text lazily per insert, or batch the inserts, so the snapshot write's copy is bounded rather than a full second copy of the node's text.
   - Re-measure under the same rules (forked `-Xmx768m`, 3 repeats).
2. **Add the UTF-16 text-heavy shapes to `RunPathHeapSpec`:** `heavy-utf16`, terminal only, and `heavy-utf16-2out`. Then:
   - Correct the class doc and design.md, which say text-heavy is covered by the Latin-1 variant. Latin-1 storage halves the real cost the budget is priced for.
   - Pin the chosen fix in `RunLimitsGuardSpec`, with a mutation that turns it red.
3. **Cover backfill (`PipelineRunBackfill.persistBackfilledRows`),** or record measured evidence that its peak is under 192 MB for the worst text shape. The ticket names backfill as a real-run path. If you take CR1(b), the fix lands in the shared repository method and covers backfill too; say so explicitly.

### Non-blocking notes
- The cycle-3 margin shortfall (the 4-copy shape is bimodal, 164.4 MB worst against a "192 − swing" rule of 160.7) is moot until CR1 is fixed. Re-state it against the new measurements.
- No gate defect to record: no claim here, or in the reports I drilled into, relies on mtime ordering.
