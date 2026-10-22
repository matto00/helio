## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `7781503060d9fca0c539a7ff4e222c559710d4e0`. The base was resolved live with `resolve-review-base.sh`: `e88acadb9a833755cf15e6e6b6e49d3ae97f5aa7`. The diff is backend only (6 main files, 6 test files, change dir), so there is no UI step.

### What I verified (with evidence)

**Code read in full (diff `e88acadb9...HEAD`)**

- **`JsonTextLength`**
  - It mirrors spray's `printString` rules: escapes for `"`, `\`, `\b \f \n \r \t` and `\u00XX` below 0x20; numbers via `toString`; separators and colons counted.
  - Surrogate handling matches what `getBytes(UTF_8)` does.
  - It builds no text.
- **`NodeSnapshotRepository.batchesOf`**
  - Batch boundaries are computed up front with no rendering. Each batch still renders inside the deferred `DBIO.successful(()).flatMap`.
  - `SnapshotBatchMaxChars = min(1,048,576, MaxRowRenderChars)`.
- **Run path:** `PipelineRunExecutor.scala:259` calls `refuseOverPostWalkBudget` for every non-dry run before the success chain. The width check walks `retainedFrames`, which are the same frames the success writes render (`PipelineRunSucceededWrites.scala:119/146`).
- **Payload:** the payload is measured with `JsonTextLength.utf8Bytes` before `render`.

**AC1: every listed shape at or under 192 MB.** I ran a fresh single-CPU probe on the unmodified worktree: `taskset -c 4`, forked `-Xmx768m`, `maxMemory MB: 742`, 3 repeats, under the sbtfull lock. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1679/evidence/.concertino/scratch/HEL-1679/skeptic-mut/skeptic-fewrows-rowwidth-1cpu.summary.txt`.

| Shape | Real MB per repeat | Outcome |
|---|---|---|
| `fewrows-utf16-200` | 97.8, 103.1, 109.7 | succeeds (294.8 on main) |
| `fewrows-utf16-20` | 96.0, 95.9, 95.9 | refused cleanly with "Pipeline run memory limit reached: a finished row would be 2800042 characters wide as JSON, more than 2000000. ..." |
| `fewrows-utf16-1` | 0.0, 0.1, 14.8 | refused by the concat text cap |
| `fewrows-payload-200` | 100.4, 87.5, 105.8 | — |
| `rowwidth-at-limit` | 154.3, 140.5, 151.7 | succeeds |
| `rowwidth-over` | — | refused |

The maximum over all shapes was 154.6 MB. This matches the executor's `green-full-regression-1cpu` summary.

**AC2: red first.** `evidence/red-fewrows-xmx768m.summary.txt` records `fewrows-utf16-200` at 294.8/294.8 MB and `fewrows-utf16-20` at 256.4/256.4 MB.
- The 294.8 figure independently matches HEL-1660 skeptic-final-3's 294.7/294.0 for the same shape. That match is a content corroboration, not reliance on mtime or ordering.
- The red run was on G1, multi-CPU (`maxMemory 768`). That is fine for proving the breach.

**AC3: deterministic, mutation-checked guards.**
- I re-ran the five guard specs on the unmodified worktree (`JsonTextLengthSpec`, `RunLimitsGuardSpec`, `NodeSnapshotBatchedWriteSpec`, `NodePayloadHistoryWriteSpec`, `PipelineRunLimitsServiceSpec`): 50 succeeded, 0 failed, exit 0. Log: `.concertino/scratch/HEL-1679/skeptic-targeted.log`.
- HEL-1660's lazy-render guards are still green: "build at most 200 rows' JSON text per batch" and "never render more than one batch ahead of the inserts (450 rows)".
- I ran two mutations of my own in a scratch copy of the backend, never in the worktree. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1679/evidence/.concertino/scratch/HEL-1679/skeptic-mut/skeptic-mutations.summary.txt`.
  - **M1, eager render** (`acc.andThen(insertBatch(batch))`): 3 failed. They are the 450-row, 12x300k and 3x1.2M render-ahead cases.
  - **A size-cap disable I wrote myself**, textually different from the executor's M2 and freshly compiled (`compiling 1 Scala source`): 4 failed, including "never hold more rendered text than the batch budget ahead".
- I read the executor's `mut.py`: all 14 mutations are real single-site source replacements. The raw transcript `mutation-run.txt` shows each one red.

**AC4: backfill.**
- `PipelineRunBackfill.persistBackfilledRows` (both callers, lines 123 and 145) applies the same `rowTooWide(JsonTextLength.ofRow)` check, then writes through `nodeSnapshotRepo.overwriteRows`. That leads to `overwriteRowsAction`, then to `batchesOf`: the same size-capped path.
- Backfill specs: one shows an under-limit backfill writes, the other shows an over-limit backfill writes nothing. Both are green in my run. M9 reddens the second.

**Is the 192 MB share credibly held at 2,000,000 single-CPU?**
- The C1 arithmetic is correct: 24 + 24 repeats, boundary maximum 158.8, giving 164.4 + 4.40 = 168.8 MB. The evaluator reproduced it with 12 more repeats.
- The C1 anchor (164.4, a G1-era number for `post-wide-4`) is not the heaviest single-CPU retained state. `just-under-light@2600000` reaches 169.9 MB single-CPU in the executor's own regression. I measured that joint worst directly with an added probe shape in the scratch copy:
  - The shape: `just-under-light` at 16 steps, terminal Output, and one row of exactly 2,000,000 rendered characters of `中` in the untouched column.
  - Setup: 8 repeats, single CPU, `maxMemory 742`.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1679/evidence/.concertino/scratch/HEL-1679/skeptic-mut/skeptic-jul16-1cpu.summary.txt`.

  | Shape | Mode | MB per repeat | Max |
  |---|---|---|---|
  | `jul-wide@16` | real | 152.5, 173.0, 152.4, 152.9, 152.5, 152.5, 137.9, 152.5 | 173.0 |
  | `jul-base@16` | real | — | 169.5 |
  | `jul-wide@16` | dry | — | 184.4 |
  | `jul-base@16` | dry | — | 161.5 |

- **Conclusion:** the share holds at this joint worst for real runs. The worst real repeat (173.0) is about 4 MB over the C1 formula's 168.8, which shows the formula's anchor is not the true worst, but there is still about 19 MB of measured headroom. The evaluator's pessimistic analytic estimate (about 182 MB) is also under 192.
- The 184.4 MB dry reading is a walk peak. A dry run writes and renders nothing, so it is governed by HEL-1660's walk limits, not by anything in this change. That is a HEL-1660 calibration matter.

**Refusing the ~20-row shape: within the rulings, not an owner question.**
- AC1 says "stays at or under 192 MB peak". The refused shape peaks at 96 MB, and the ticket already planned a refused 1-row shape.
- The refusal uses the ruled mechanism: a step error worded as a pipeline run limit, before any write. Clean failures are accepted.
- The design's ESCALATE triggers (a new env var, a changed existing constant or the AC6 pin, a limit below the 1,048,584 floor) do not apply. 2,000,000 is above the floor, and `RunLimitsGuardSpec` pins the existing constants unchanged (green).
- The ticket's own note anticipates this ("so new shapes are refused instead of discovered").
- Ruling 4 is respected: a row holding one ruling-4 value (1,048,584 rendered characters) is writable, and that is pinned by the tripwire test.

**Standing constraints**
- **C1 (amended):** met as written. Verified from the cert summaries and the evaluator's reproduction. See the note below on the anchor.
- **C2:** met. `wideRowPipeline` builds the cell from `中`.
- **C3:** met on disk. design.md Risks, tasks.md 2.10 and design.md "Disclosure (C3)" name both reproducers and the wide-row refusal. The hand-back itself is the orchestrator's to deliver.

**Gate defects (CON-160):** none. No report I drilled into disclosed unsound mtimes. Nothing here rests on mtime ordering; the red-first claim is corroborated by content (it matches HEL-1660's independent 294.x measurement).

### Verdict: CONFIRM

### Non-blocking notes

- **design.md "Measured Results" overstates the margin.** "margin 23.2 MB" uses the G1-era 164.4 anchor. Single-CPU, the heavier `just-under-light` retained state plus a 2,000,000-character row measured 173.0 MB real (my probe above). The honest measured margin is about 19 MB on the observed maximum, or about 10 MB under the evaluator's analytic worst case. I suggest stating that next to the formula result.
- **The HTTP run response still renders the whole terminal frame** (`RunResultResponse(jsRows, ...)`, `PipelineRunExecutor.scala:344`). A manual run of `fewrows-utf16-200` through the route will still render about 56M characters at once. This is a scoped-out Non-Goal and already listed as a follow-up candidate. The driver should prioritise it, because it is the same defect class on the interactive path.
- **HEL-1660's walk limits under single-CPU SerialGC need re-measurement.** A dry `jul-wide@16` repeat reached 184.4 MB, and `just-under-light` real reached 169.9 MB. This is already a listed follow-up and is now supported by a measured number.
- **`evidence/README.md` header is stale.** It says `maxMemory MB: 768` for every heap run; the cycle-2 single-CPU runs report 742.
- **A test name overstates its input.** `PipelineRunLimitsServiceSpec` "accept a row just under the limit" uses a cell of `MaxRowRenderChars / 2`, which is half the limit. The exact-limit acceptance is covered deterministically in `RunLimitsGuardSpec`, so this is only naming.
