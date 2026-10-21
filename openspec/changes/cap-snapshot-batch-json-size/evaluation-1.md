## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `d3b27663cd633c3b9cc8e5c33a0955ad7888c72f` (diff base `e88acadb9a833755cf15e6e6b6e49d3ae97f5aa7`, resolved live with `resolve-review-base.sh`). The change is backend only, so Phase 3 does not apply.

### Phase 1: Spec Review — FAIL

| Check | Result |
|---|---|
| AC1: listed shapes at or under 192 MB | 200-row, 20-row and 1-row shapes: PASS (green 96.9-97.7 / 142.4 / refused). D3 boundary shape: **FAIL**, see the independent probe under Phase 2 (189.9 MB, 2.1 MB of margin, in the production-representative configuration). |
| AC2: red-first measurement | PASS (`evidence/red-fewrows-xmx768m.summary.txt`: 294.8 / 294.8 and 256.4 / 256.4 MB on unchanged code) |
| AC3: deterministic guard, mutation-checked | PASS. `NodeSnapshotBatchedWriteSpec` size-ahead cases; M1-M4 red in `evidence/mutation-run.txt`. |
| AC4: backfill covered | PASS (`PipelineRunBackfill.persistBackfilledRows`; 2 service specs; M9) |
| No AC silently reinterpreted | PASS |
| Tasks done and matching | PASS, except 2.10 (see C3) |
| Scope creep | None. D4 (payload) was self-approved in the design. |
| Regressions | None found. `sbt testFull` is green (below). |
| Planning artifacts reflect final behavior | **FAIL**. `proposal.md:13-14` says "The post-walk price charges a row's rendered JSON beyond the batch budget", and the Impact section at `proposal.md:34` says "`RunLimits.scala` (post-walk price)". That is the D3 alternative the design gate rejected in round 2. What was built is a separate `MaxRowRenderChars` limit, independent of `postWalkCells`. |
| CONSTRAINTS C1 | **FAIL**. See the C1 judgement below. |
| CONSTRAINTS C2 | PASS. `RunPathHeapSpec.wideRowPipeline` builds the cell from `中`. |
| CONSTRAINTS C3 | **FAIL as recorded**. No artifact in the change dir names both reproducers. `design.md:111` and `tasks.md:35` (2.10) name only the 200-row shape. The `rowwidth-at-limit` D3 shape is not named, and the wide-row refusal is not disclosed in any follow-up text. The executor's hand-back message may carry this, but I cannot verify that, so it must be on disk. |

### Phase 2: Code Review — FAIL

**Gates (my own fresh runs):**
- `sbt testFull` was run under the sbtfull flock with `nice -n 19`. Result: 674 suites, 9406 succeeded, 0 failed, 5 canceled. The 5 cancellations are the pre-existing opt-in `HELIO_MEASURE` specs. Exit 0. Log: `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/eval1679/testfull.log`.
- `npm run check:scala-quality` is clean (soft size warnings only). `check:openspec` is clean, `check:spec-structure` passed, and `format:check` is clean.

**Code (diff + targeted reads).** `JsonTextLength` mirrors spray's printer: `"`, `\`, short escapes, `\u00XX` for other characters below 0x20, surrogate pairs at 4 bytes and lone surrogates at 1 byte. An adversarial equality spec pins it. `batchesOf` is correct and has boundary tests. Rendering stays inside the deferred `flatMap`. The run check runs before any write, and backfill writes nothing on refusal. The payload is measured before it is rendered, and `bytes.toInt` is safe because `bytes <= maxBytes: Int` at that point. The mutation table matches the raw transcript.

Findings:
1. **[mechanical] Imports & Qualifiers (CONTRIBUTING.md:70).** `backend/src/test/scala/com/helio/services/pipelines/PipelineRunLimitsServiceSpec.scala:143` inlines `java.nio.file.Files.writeString(java.nio.file.Paths.get(path), ...)`. `backend/src/test/scala/com/helio/domain/engine/JsonTextLengthSpec.scala:64` inlines `new java.math.BigDecimal("3.25")`. The checker misses both because `java.nio`/`java.math` are not on its prefix list, but the rule itself ("never inline a fully-qualified name when an import would do") covers them.
2. **DRY / drift risk.** `RunLimits.widestRetainedRowChars` (`RunLimits.scala:56-58`) re-implements the frame-selection lines of `postWalkCells` (`RunLimits.scala:42-43`). The two must select the same frames, as the scaladoc itself says ("those `postWalkCells` prices"). If one drifts, the bound silently stops covering a frame.
3. **D3 certification (the item I was asked to judge).** `MaxRowRenderChars = 4,000,000` is **not** credibly within the 192 MB share. Evidence follows.

**C1 / D3 judgement: not credibly held at 4,000,000.**

- **Which configuration matters.** Production runs Cloud Run with `--cpu=1` (`infra/deploy-backend.sh:113`) and sets no GC flag (`Dockerfile:45-48`). On 1 CPU, JVM ergonomics select SerialGC. Every single-CPU run reports `maxMemory MB: 742`, while the 12-CPU G1 runs report 768, which confirms the collector differs. So the executor's single-CPU "stress" run is the **production-representative** configuration. The "canonical" G1 runs, with their tight 2-3 MB swing, are not.
- **Independent probe.** Same spec, `HELIO_RUN_HEAP_ONLY=rowwidth-at-limit,rowwidth-base`, 10 repeats, forked `-Xmx768m`, sbt pinned to one CPU with `taskset -c 5`, under the flock, `nice -n 19`. Log: `.../scratchpad/eval1679/probe-1cpu.log`. Verbatim:
  ```
  repeats rowwidth-at-limit  real MB 154.2, 146.1, 170.5, 189.8, 146.0, 168.5, 173.9, 189.9, 178.4, 170.5
  repeats rowwidth-base      real MB 131.7, 140.6, 138.3, 122.3, 150.7, 128.0, 138.4, 154.9, 138.4, 142.5
  max over shapes MB: 189.9 (bound 192.0); maxMemory MB: 742
  ```
  Two boundary repeats reach 189.8 and 189.9 MB, 2.1 MB under the share. Six of the ten land in the ≥160 MB mode. The executor's own single-CPU run peaked at 170.5. Its 10 samples simply did not hit this tail.
- **The wide row's real cost is about 30 MB, not 5-10 MB.** The mean shift between the two distributions is 168.8 - 138.6 = 30.2 MB, and the max-vs-max shift is 189.9 - 154.9 = 35.0 MB. Both fit the analytic cost of rendering one 4M-character non-Latin-1 row: an 8 MB UTF-16 rendered string, plus StringBuilder growth copies, plus about 12 MB of UTF-8 for the driver. The canonical G1 deltas (5-10 MB) understate this cost.
- **Rule (ii) in honest form also fails.** The highest recorded high-mode baseline (164.4 MB, from HEL-1660) plus the measured mean shift (30.2) is 194.6 MB, which is over 192.
- **About the executor's argument.** The executor is right that the *index-paired* delta in a noisy run is invalid. Repeats of one shape run back to back, so "pair i" is not a pairing. The executor's own observation shows this: the same arithmetic gives 35.8 MB at 2,000,000. But the conclusion drawn from it, that the unpaired stress maximum of 170.5 MB is safely under 192, does not survive more samples of the same configuration.
- **What 2,000,000 looks like.** The executor's single-CPU run at 2,000,000 (`evidence/sweep-2m-singlecpu-xmx768m.summary.txt`) has a boundary maximum of 158.8 against a base maximum of 154.6, with a mean shift of about 9.6 MB. Halving the row roughly halves the render transient. That is the credible region.

This is not an owner question. Ruling 3 (the 192 MB share) and the clean-failure ruling already decide it. The fix is a measurement-sized constant inside the design's own self-approval (D3, Planner Notes), and 2,000,000 stays well above the 1,048,584-character floor, so the ESCALATE condition does not apply.

### Phase 3: UI Review — N/A
Backend-only diff. No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed.

### Overall: FAIL

### Change Requests
1. **Lower `RunLimits.MaxRowRenderChars` and re-certify it in the production-representative configuration** (`RunLimits.scala:35`; tripwire `RunLimitsGuardSpec.scala` `MeasuredRowRenderChars`).
   - Start at **2,000,000**. Never go below the 1,048,584 floor; if you would have to, ESCALATE.
   - Certify with the forked JVM pinned to one CPU (`TASKSET="taskset -c N"` in your `heap.sh`, `maxMemory MB: 742`). Run at least **20** repeats each of `rowwidth-base` and `rowwidth-at-limit` (`HELIO_RUN_ROW_CHARS=<limit>`), across at least 2 separate JVM invocations.
   - Certified only if (a) every boundary repeat is ≤ 192 MB, **and** (b) 164.4 MB (or the highest baseline measured, if higher) plus max(mean shift, boundary max minus baseline max) is ≤ 192 MB. State the margin.
   - The index-paired delta is replaced by this distributional delta because pairs are not interleaved. Your own 2,000,000 run already shows the paired arithmetic is noise.
   - On C1's high-mode clause: if no boundary repeat reaches 160 MB at the lower limit, record that the 164.4 MB anchor in (b) is what covers the high mode, and that (b) is strictly more conservative than the observed tail.
   - If (b) fails at 2,000,000, step down (e.g. 1,500,000) and repeat.
   - Update `design.md` "Measured Results" with the new numbers. Also record there that the G1 "canonical" runs are not production-representative (Cloud Run `--cpu=1` gives SerialGC), and persist the new sweep summaries under `evidence/`.
2. **Remove the inline FQNs:**
   - `PipelineRunLimitsServiceSpec.scala:143`: add `import java.nio.file.{Files, Paths}` at the top and call `Files.writeString(Paths.get(path), ...)`.
   - `JsonTextLengthSpec.scala:64`: add `import java.math.{BigDecimal => JBigDecimal}` and use `new JBigDecimal("3.25")`.
3. **De-duplicate frame selection in `RunLimits.scala`.** Extract the shared "retained frames, de-duplicated by identity, terminal first" computation (lines 42-43 and 56-57) into one private `retainedFrames(nodeOutcomes, retain, terminalRows): Vector[Seq[Row]]`. Use it in both `postWalkCells` and `widestRetainedRowChars`, with no behavior change. M7/M8 and the AC6 pin must stay green.
4. **Fix `proposal.md`.**
   - `proposal.md:13-14`: replace the "post-walk price charges a row's rendered JSON beyond the batch budget" bullet with what shipped. That is a separate measured `RunLimits.MaxRowRenderChars` row-render limit, checked in `refuseOverPostWalkBudget` and in backfill, independent of `postWalkCells`.
   - `proposal.md:34`: change "(post-walk price)" to "(`MaxRowRenderChars`, row-width check)".
5. **Honor C3 on disk.** Update `design.md:111` and `tasks.md:35` (2.10) so the HTTP-response follow-up candidate names **both** reproducers: `fewrows-utf16-200` and the D3 wide-row boundary shape (`rowwidth-at-limit`). Also state there that a row whose rendered JSON is wider than the certified `MaxRowRenderChars` is now refused with the run-limit step error. That way the hand-back's disclosure has a durable source.

### Non-blocking Suggestions
- **Follow-up candidate for the orchestrator/driver (outside this ticket).** HEL-1660's limits (`MaxLiveCells`, `MaxPostWalkCells`) were certified under 12-CPU G1. In the executor's single-CPU run, `post-wide-4@3.9M` measured up to 152.6 MB, against 130-133 MB under G1 (`.concertino/scratch/HEL-1679/sweep-4m-e.summary.txt`). The other HEL-1660 shapes may sit closer to 192 MB in production than their certification says, so a single-CPU re-measurement of them is worth filing.
- `PipelineRunBackfill.persistBackfilledRows` converts every row through `anyToJsValue` twice: once to measure it, once to write it. This is acceptable for backfill. A comment noting it was deliberate would help.
- The backfill failure message carries a `HEL-1679:` prefix in a runtime string. Other backfill failures do not use a ticket prefix, so consider dropping it.
