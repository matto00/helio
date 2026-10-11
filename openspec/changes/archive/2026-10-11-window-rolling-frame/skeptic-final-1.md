## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `09f57f7ce38582ff3ee996380724dc7938e424ee`. The base was resolved live by `resolve-review-base.sh` as `e8161b17bdb969eae5b844f7cdd0b753ab1023ac`. `origin/main` is now `5f0b679ef`, and `git merge-tree --write-tree origin/main HEAD` is clean.

Evidence dir (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1316/evidence/skeptic-final-evidence/`. The `ref` lines below are relative to it.

The previous final-gate skeptic died without a verdict. I did not rely on it: everything below is re-derived.

### What I verified (with evidence)

**AC1 — 7-row moving average, hand fixture, leading partial frames (documented)**
- Code:
  - `WindowRolling.scala:47` frames rows mode as `(max(0, p - size + 1), p)`.
  - `slideFrames` emits `sum/count` whenever `count > 0`, so leading partial frames get a value.
- Test: `WindowStepRollingSpec` "match the hand-computed 7-row fixture" asserts `1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0`. I recomputed these by hand: correct.
- Documented in three places: the spec delta scenario, the `WindowStep` scaladoc, and the MCP `write.ts` text ("Leading partial frames emit a value over the rows available").
- Mutation B (`p - size + 1` → `p - size`) turns 5 tests red, including this fixture: `Vector(...4.5, 5.5, 6.5) was not equal to List(...5.0, 6.0, 7.0)`. ref `mut-B-diff.txt`, `mut-B-red.txt`.

**AC2 — Partitioning**
- `compute` runs per partition (`WindowStep.apply` stage 2, where `partitioned.values` feeds `WindowRolling.compute`).
- Tests cover rows mode (interleaved teams) and days mode.
- Live: the real run on the gappy fixture gives team b `10, 30` and team a independent values (see the real-run section below).

**AC3 — apply/infer parity**
- `ReshapeSchemaInference` maps `rolling_count` to `integer` and the other rolling functions to `float`.
- `WindowRollingAnalyzeSpec` asserts that apply emits `java.lang.Integer` or `Double` to match.
- Mutation D (`rolling_count` → float) turns both parity tests red: `1 was not an instance of java.lang.Double, but an instance of java.lang.Integer`. ref `mut-D-*`.
- Live analyze on 9655 reported `rolling_v: float` for `rolling_sum`.

**AC3 — Step editor**
- Read `WindowConfig.tsx`, `stepCardFieldHandlers.ts` and `stepNarrowing.ts`.
- My own frontend mutations, in a throwaway worktree:
  - `usesField` reverted to the old 3-function list: 2 jest tests red.
  - Frame-size guard loosened (`>= 0`, upper bound dropped): 1 test red.
- Baseline: `jest --testPathPatterns=WindowConfig` gives 28/28 pass.

**End-to-end real run on a gappy fixture (live dev servers 6748/9655)**
- Steps: `apply-proposal` with the fixture config (rolling_sum, 3 days, partitioned by team), then `POST /pipelines/:id/outputs`, then `POST /pipelines/:id/run`, then `GET /outputs/:id/rows`.
- Result: `materialized=True`, rows `1, 6, 10, 6, 4, 9, 30, null, 9`. This matches my hand computation:
  - the gap 01-03..01-04 is not filled;
  - the two 01-02 peers share 6;
  - `"nope"` gives null;
  - the null `v` on 01-07 is skipped, giving 4+5=9.
- ref `real-run-output-rows.txt`.
- Backend seam spec `WindowRollingSeamSpec` (real routes, `VerifiedEmbeddedPostgres`, a real run plus the Output rows) passes. Mutation C (peers do not share their frame end) turns it red at the run assertion (`WindowRollingSeamSpec.scala:156`), which shows the seam's run half really exercises the compute path. ref `mut-C-*`.

**Write-time rejection on every write surface named in the spec delta (live, with positive controls)**
- I tested these invalid values: frameSize `7.5`, `5000000000`, `0`, `1001`, `"7"`; frameUnit `weeks`; `days` with a desc key; `days` with 2 keys.
- I sent each value to every surface:
  - REST step create;
  - REST step update (`PATCH /pipeline-steps/:id`);
  - `apply-proposal`;
  - single-call `POST /pipelines`;
  - patch-set `pipelineStep` create, apply and preview;
  - patch-set `pipelineStep` update, apply and preview;
  - patch-set `pipeline` create, apply and preview.
- **All 80 combinations returned 422.** Afterwards the stored steps were unchanged and no `skf2-bad` pipeline existed. ref `write-surfaces.txt`.
- Positive controls: the same surfaces accept the valid config (200/201), so the 422s come from the frame rule and not from a malformed probe. The messages name the problem, e.g. `edit 0: window function 'rolling_sum' requires 'frameSize' to be an integer in 1..1000, got 5000000000`. ref `write-surfaces-controls.txt`.
- A draft (no `field`, no `frameSize`) is still accepted with 201.
- Every surface routes through `PipelineStep.rawConfigProblem` on raw JSON (`compactPrint` of a `JsValue`), so `7.5` cannot be truncated by a typed decode first.
- Mutation A (drop `rawFrameSizeProblem`) turns the unit test and the seam 422 test red: `frameSize 7.5 → 201 Created was not equal to 422`. ref `mut-A-*`.

**Constraints**
- C8:
  - no inline FQNs in the code diff (the only grep hits are quotes inside `evaluation-1.md`);
  - `VerifiedEmbeddedPostgres.start` is used in `WindowRollingSeamSpec`;
  - `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` appears in my targeted baseline run (4 suites, 33 tests, all passed; ref `baseline.txt`);
  - no migration file in the diff.
- C7:
  - no compute or ExpressionEvaluator file is touched;
  - `RefinementEditShape.scala` has exactly 1 hunk, and it is the doc string;
  - main's HEL-1482 `RefinementEditShapeSpec` does not assert on that string, and the merge is clean.
- C6: `red-backend-unit.txt` shows the new specs failing before the implementation. The executor's mutation record plus my mutations A–D and the two frontend mutations show the guards are failable.
- C10: `WindowConfig.seam.test.tsx` asserts that the mocked `updatePipelineStep` body equals the fixture config with an exact key set. It does not inspect editor state.
- C11:
  - the raw check lives in `validateRawConfig`, and `null` counts as absent (`filterNot(_ == JsNull)`);
  - the typed range check is in `enumProblems`;
  - the `apply` signature is unchanged;
  - the persisted body uses conditional spreads;
  - the frame-size input can be cleared and accepts only 1..1000.

**UI / design judgment (DESIGN.md)**
- Screenshots come from an isolated headless Chromium context logged in as my own throwaway user. I did not use the shared MCP browser, so no `.playwright-mcp` files were created.
- Frame size and Frame unit use the same `pipeline-detail-page__compute-field` / `__compute-label` structure, shared `TextField` and `Select`, uppercase label and full-width control as the sibling Offset, Source field and Output column controls. I compared them side by side against a `lag` step in the same pipeline. ref `full-light-1280.png`, `lag-light-1280.png`.
- Dark parity holds: inputs, labels and the error text all use theme tokens. ref `full-dark-1280.png`.
- At 390px the controls stack correctly. ref `rolling-light-390.png`.
- The stored draft with no frameSize shows an empty input next to the analyze error "requires 'field'", as the spec requires.
- The function list shows all 11 functions in order. ref `fn-options-light.png`.
- The only console error is a 404 on `/schedule`, which is expected for a pipeline with no schedule and is not related to this change.

### Verdict: CONFIRM

### Non-blocking notes
- No test in the diff covers the rolling frame rejection on the patch-set and proposal surfaces. It is proven live above, and those surfaces share `rawConfigProblem`. A route-level test on `PatchSetStepCreateConfigRoutesSpec` would pin it.
- The frame-size input id `window-frame-size-input` is hard-coded, so two expanded window cards share one id. The pre-existing `window-output-column` has the same problem, so I am noting it rather than requiring a fix.
- `WindowStep.scala:220`: the `case` arrows are misaligned (the evaluator noted this too). There is also a stray blank line at about line 240.
- Housekeeping: I deleted, by exact id, my throwaway user `f316856e-89ce-45b3-8fe9-18b35aae5266` and the dead previous skeptic's HEL-1316 throwaway user `0de65a7e-9d43-48cd-86b6-3bf44655918e` (`skeptic-hel1316-…@helio.test`), together with the rows they owned. My dev servers were stopped by exact PID (both ports are free), and my throwaway worktree was removed.
