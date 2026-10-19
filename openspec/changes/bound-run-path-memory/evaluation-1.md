## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: d21a78a86cb16f36fef9a2edff6647cfa680e464. Diff base resolved live: 069afd36d5c69d245c0f3c779b9a4fc6d160b52b.
Scope: backend + Dockerfile + openspec change dir. No `frontend/**` change, so the frontend gates and Phase 3 do not apply.

### Phase 1: Spec Review — PASS
- AC1: the red evidence exists (`red-run-limits-xmx768m.log`, `red-fatal-errors-xmx768m.log`, `heap-sweep-xmx768m.log`).
- AC2–AC5: limits are applied in one place, `InProcessExecutionBackend.execute` via `RunLimits.contextTransform`. Every run trigger, the saved preview and backfill go through it. The per-kind guards take `ctx.limitLabel`. `PipelineRunLimitsServiceSpec` asserts the failed run, an `error_log` naming the step, its kind and "pipeline run limit", no snapshot, and the saved-preview error.
- AC6: a 50,000 x 6 CSV, a 10-step chain, and Outputs on the middle node, a tail and the terminal. All three snapshots are written.
- AC7: the `NonFatal` catch, the SOE arm and the boxed-fatal pass-through are in place, and `-XX:+ExitOnOutOfMemoryError` is in the Dockerfile. The 4 D7 cases are covered.
- AC8 / C6: the draft wording stays byte-identical through the `LimitLabel.Draft` defaults. `DraftPreviewService` now sets `leafFirst = true` explicitly. Draft specs pass in the full suite.
- C1–C6 are honoured. The ruled numbers are 100,000, 1,048,576 and the 25%-of-768 MB bound. `MaxLiveCells` is the executor's measured value inside ruling 3, not an owner-ruled number.
- Tasks are all checked and match the diff. There is one plan deviation, the `jsRows` reuse, and it is recorded in design.md "Measured Budget".

### Phase 2: Code Review — FAIL
Gates (fresh, run by me):
- `sbt testFull` (under the sbtfull lock, forked JVM default 3g): **Tests: succeeded 9365, failed 0, canceled 4**, EXIT=0. This matches the executor's claim.
- `npm run check:scala-quality`: clean (soft size warnings only).

Claims verified:
- **`PipelineRunSucceededWrites` `jsRows` reuse: correct.** `jsRows` (PipelineRunExecutor.scala:294) is built from `resultRows` with the exact same per-row conversion as the `else` branch. When `outcome.rows eq resultRows`, reference equality means the content is identical, so the persisted rows are byte-identical.
  - Multi-root: another root's terminal has a distinct frame, so it is converted as before.
  - A root-bound Output on the lowest root with no trunk steps: `trunkRows` is that root frame, and the reuse gives the same content.
  - A disabled step passes its parent's `Seq` through, so a parent-bound Output may also hit `eq`. The content is still identical, so this is harmless.
- **`LateFinisherSpecBase.HookOutputRepo` change: a legitimate seam retarget, not a fixture fudge.** The run now calls `listByPipelineInternal` once before the walk (D3). That call consumed the one-shot `beforeOutputList`/`beforeNodeFold` hooks, which the four specs aim at the success chain's listing. The change defers the hooks until the engine has returned for that pipeline, so each spec still exercises the same race it asserts (delete before or after the success-chain list). The pre-walk listing failing is a pre-walk failure path, not the late-finisher race.
- **Mutations: genuine, but 22, not 23.** `mutations.md` lists 22 entries and there are 22 `mutation-*.log` files. I spot-checked memory-budget, d7-drop-soe-exemption and empty-retain-from-executor: each records the exact source edit and a real `*** FAILED ***` on the named spec.
- **`RunPathHeapSpec` headroom: not safe as an asserting CI gate. See CR1.**

Issues:
1. **`RunPathHeapSpec` can flake in CI.** It runs in `testFull`, which means CI and the pre-merge gate. It asserts `maxPeak <= 192.0` (RunPathHeapSpec.scala, `maxPeak should be <= 192.0`) with 6.5 MB (3.4%) headroom over the measured worst shape (185.5 MB). The measurement noise per shape is larger than that headroom. Same commit, my `testFull` run against the executor's `evidence/green-heap-report-3000000.txt`:
   - `ac6-ordinary` real: **173.0 MB** (mine) vs 150.4 MB (executor), a +22.6 MB swing.
   - `just-under-light@3000000` dry: 151.8 vs 141.8, +10.0 MB.
   - `splittext-fan-out` real: 21.1 vs 64.6, -43.5 MB.
   - `just-under-light@3000000` real happened to reproduce at 185.5 MB in both runs.

   The background sampler (every 150 ms) catches transient peaks at nondeterministic moments, and the first-measured shape absorbs warm-up allocations. A swing of the size already observed, landing on the worst shape, crosses 192 MB.

   There is a second weakness: CI's forked JVM is not `-Xmx768m`. My run reported `maxMemory MB: 3072`, and CI uses the JVM default. G1 region sizing and GC behaviour therefore differ from the measured configuration, and the CI number is not the 768 MB-heap measurement the assertion claims to protect.

   The design's own Planner Notes allowed for this: "heap spec in `testFull` only if it fits the forked-group pattern, else opt-in and recorded."

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change.

### Overall: FAIL

### Change Requests
1. **`backend/src/test/scala/com/helio/services/pipelines/RunPathHeapSpec.scala`: make the 192 MB heap assertion robust against measurement noise.** Do one of the following, and record the choice and the numbers in design.md "Measured Budget":
   - (a) **Preferred.** Make `RunPathHeapSpec` an opt-in measurement, gated like `OutputFilteredMetricMeasurementSpec` (`HELIO_MEASURE=1`, `assume`/cancel otherwise), and run it under `-Xmx768m` when recording evidence. Keep a deterministic CI guard in its place: for example, assert `RunLimits.MaxLiveCells` equals the recorded measured value, and/or a tally-level spec that the just-under shapes hold under `MaxLiveCells` cells. The guarded property then cannot flake on GC timing.
   - (b) Keep it in `testFull`, but lower `RunLimits.MaxLiveCells` until the worst shape leaves headroom at least as large as the observed per-shape variance (about 25 MB). Per the executor's own sweep, 2,600,000 measured 158.5 MB, and AC6 holds 2,400,000 cells, so AC6 still fits. This stays inside owner ruling 3 (at most 25% of 768 MB). Re-run `PipelineRunLimitsServiceSpec` (AC6) and the heap sweep, and record both.

   Either way, do not widen the 192 MB bound; it is ruling 3.

### Non-blocking Suggestions
- `evidence/README.md` and `mutations.md` (committed) cite `*.log` files that `.gitignore:27` (`*.log`) keeps out of git. They will dangle once `cleanup.sh --phase4` removes the worktree. Persist them with `persist-evidence.sh`, or commit a filtered `.summary.txt`, as was already done for testFull.
- `mutations.md` says "23 mutations" in the hand-off; the index has 22. Correct the count wherever it is stated.
- `InProcessPipelineEngine.scala` grew from 960 to 1006 lines, well over the ~400-line "propose a split" threshold in CONTRIBUTING.md. Note a split proposal in the PR description.
- Behaviour note for the PR body: an Output created mid-run no longer gets a snapshot or alert evaluation from that run (its frame is released). This is accepted by D3, logged at `warn`, and deserves one line in the PR.
