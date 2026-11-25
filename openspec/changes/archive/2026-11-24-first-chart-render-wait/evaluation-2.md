## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `a4e4087f8876b54bf3d3ccf5f7bdc750465e9aa0` against the live base `7292f77d60ff9f46cf3fc94ce83c1f110b92139f`.

Binding constraints:
- C2 (`preload-plus-state-wait`) and C3 (`drop-preload-ship-state-wait+fix-172-273-in-pr`) are both
  `escalation.answered` with `answer_source: human` (events.jsonl lines 23 and 39).
- C1 is retired in workflow-state.md.

Evaluator evidence for this cycle, all persisted under
`/home/matt/Development/helio/.concertino/runs/HEL-1651/evidence/.concertino/scratch/HEL-1651/eval2/`:
- `file-6x-a.txt`: whole spec file, `HEL1651_CPU_THROTTLE=6`, `--repeat-each=5`, 2 workers: **20 passed**.
- `file-6x-b.txt`: a second, separate batch with the same settings: **20 passed**.
- `chart-10x.txt`: the chart test at `HEL1651_CPU_THROTTLE=10`, `--repeat-each=10`, 2 workers: **10 passed**.

### Phase 1: Spec Review — PASS

- **The preload is dropped (C3).** `git diff <base>...HEAD -- frontend/src` is empty (0 lines).
  - The hook, its call sites and both jest files are gone.
  - HEL-1760's Output-metadata preload is untouched.
  - The cycle-1 CR1/CR2 are moot.
- **Preload measurements are kept as evidence (C3).**
  - `probe-findings.md` "Cycle 3" states why the preload was tried (C1) and why it was dropped.
  - Production 6x on-mount cost: Table +225 ms, Metric +222 ms, no canvas gain.
  - Dev cost (evaluator, cycle 1): +730 ms Table, +900 ms Metric.
  - The after-first-data variant gained nothing measurable.
  - Download size: about 224 kB gzip.
  - `design.md` now records C1, C2 and C3 and the implemented outcome (CR3 from cycle 1 is resolved).
- **State wait (C2).** The Table-cell wait has a 15 s ceiling, and the canvas assertion is unchanged at the 5 s default.
  This is consistent with the ruling and with the `waitForPanelGrid` precedent (cycle-1 judgment stands).
- **`:273`: fixed by probe-first root cause (C3).** Judged below. It is red at 6x:
  - `c3-final-6x-n10-a.txt`: 2 of 10 runs fail at `:273`.
  - 2 of 70 probe runs captured the failure with recorder data.
  - Both mutations are recorded at 6x.
- **`:172`: not fixed, not reproduced.** Judged below. Acceptable under C3's own "probe root cause first" clause and the
  systematic-debugging law, provided the PR states it.
- **C3 acceptance runs:**

  | Requirement | Evidence | Result |
  |---|---|---|
  | Whole file 6x, two batches of 10 | Executor's `c3-fixed-6x-n10-a/b.txt` ran the chart test only (`Running 10 tests`, all `:105`), not the whole file. Evaluator's own whole-file runs (`file-6x-a/b`) | 40/40, so met |
  | 4x | `c3-fixed-4x-n5.txt` | 5/5 |
  | Unthrottled, 2 workers | `c3-fixed-full-40.txt` (whole file, 4 tests) | 40/40 |
  | seedWorld callers | `c3-callers.txt` | 68/68 |
  | Production build | `c3-prod-build.txt` | 6/6 |
  | Also run | chart test 6x n40 (`c3-fixed-6x-n40.txt`) | 40/40 |

- **Siblings.** hel1573:405 and hel1584 already wait on `waitForPanelGrid`. They are unchanged apart from the env-gated
  throttle, as C2 directs.
- **Scope.** No creep. The non-openspec diff is three e2e files (+34/−1).

### Phase 2: Code Review — PASS

**Gates:**
- `frontend/**` is no longer changed, so the jest and build gates do not apply to this diff.
- The changed files are `e2e/**`. Fresh runs of `npm run lint`, `npm run format:check` and `npm run typecheck` all
  returned 0.

**`:273` fix** (`e2e/hel1573-motion-grid-chart.spec.ts:250-281`):
- **Mechanism.** It takes the last bar-sum sample before `setOption` (`stale`, the line-state render). It then counts
  only samples from the first one that differs from it. A new assertion, `paintedFrames > 0`, means an empty or
  unpainted sample can never pass vacuously.
- **The 0.9 bound is unchanged.** `longestSpanMs < 60`, `appliedAnimationDuration === 0` and the `< 1000` guard are all
  untouched.
- **Root cause.** `flake-273-root-cause.md` shows the failing sequence `293 → 36 → 293` with no intermediate value. The
  bars appeared at full height in one frame. 0.1242 = 36/293 is a single pre-repaint sample: the recorder's rAF tick ran
  before zrender's repaint. `longestSpanMs` was 0 in the same runs. This is a sampling artifact, not a replay.
- **Does it weaken HEL-1573 C1?** No. C1 here is "a refresh or recreated view does not replay the entrance". A real
  replay grows bars from about 0, so its first repainted frame differs from the line sum and is counted. That is shown by:
  - `c3-mutation-273-replay-real-6x.txt`: 4/4 red at the span assertion (294.7 and 303.8 ms).
  - `c3-mutation-273-bars-assertion-alone-6x.txt`: with the span assertion removed, 4/4 red at the bars assertion
    (ratio 0.13).
  - The second mutation exercises exactly the new slicing branch with real growth frames. Reverting the fix is the
    `c3-final-6x-n10-a` red.
- **Theoretical blind spot (negligible).** A replay whose first repainted frame had a sum exactly equal to the line sum
  would skip that one frame. Every later growth frame would still be counted and fail the bound.
- **Is the change in meaning stated honestly?** Yes. The code comment, `design.md` and `probe-findings.md` all say it
  changes what is sampled ("frames painted after the replayed option"), not what is guarded.
- **Statistical support.** Before the fix: about 4 failures in 80 runs (2/10 plus 2/70). After the fix: 0 in 60 executor
  chart runs at 6x, plus 0 in 20 evaluator chart-test runs at 6x and 10 at 10x. Moderate on its own. Strong combined
  with the captured mechanism.

**`cpuThrottle.ts`.** Validated integer; unset or `1` is a no-op with no CDP session. Unchanged since cycle 1.

**Readability, DRY, dead code.** Fine. No leftover preload code.

**Evidence hygiene:**
- Scratch specs are committed only as `.spec.ts.txt`: `hel1651-probe`, `-longtask`, `-timing` and `-flake-probe`.
- `git ls-files e2e | grep -i 1651` returns nothing, and no untracked file is in `e2e/`.
- Every tracked file in the change dir is `.md`, `.txt` or `.yaml`.

### Phase 3: UI Review — N/A

No file matching the UI triggers changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The
diff is e2e-only plus the change's own openspec dir. The dashboard happy path was still exercised: the evaluator's 50
runs above rendered the Table, Metric and chart.

### Judgments requested by the orchestrator

1. **`:273` fix:** sound. The 0.9 bound and the replay contract are intact. The meaning change ("first painted frame
   after the replayed option") is stated in code, design and evidence. Both mutations go red at 6x and exercise the
   fixed branch.
2. **`:172` decision:** an acceptable, evidenced outcome. It is not a defect to send back to the executor.
   - All three sightings (148.4, 131.7, 59.8) came from runs with the early preload present.
   - With the preload dropped: executor about 150 chart-test runs at 4x, 6x and 10x (`c3-nopreload-*`, `c3-fixed-*`);
     evaluator 0 failures in 20 chart-test runs at 6x and 10 at 10x. The 6x runs were whole-file batches, so the other
     worker was running the other tests at the same time, which is closer to CI contention.
   - C3 itself says "probe root cause first". With no red there is nothing to probe, and the law forbids a speculative
     fix (and forbids loosening the bound).
   - **Residual risk:** the mechanism is unproven ("a starved first rAF tick sees the entrance mid-way" is a hypothesis).
     The comment at `:171` ("a slow host only lengthens a span, so a lower bound is not exposed") is contradicted by the
     preload-era 59.8, which shows main-thread contention can shorten a span. CI's 4-vCPU runner could in principle
     produce such contention without the preload.
   - **Recommendation:** an owner escalation is not required, because the outcome follows C3's own probe-first clause.
     But C3 literally said "fix :172 in this PR", so the orchestrator should tell the owner (PR body plus the delivery
     report) that `:172` was not reproducible without the preload and so was not changed. If it ever appears in CI, it
     should be captured with `hel1651-flake-probe.spec.ts.txt` rather than rerun. If the owner wants a hard guarantee,
     that becomes a new ruling.
3. **C3 whole-file AC:** met.
   - 6x 40/40 in two separate whole-file batches: the evaluator's runs. The executor's "6x 20/20" files were chart-only.
   - 4x 5/5, unthrottled 40/40, callers 68/68 and prod-build 6/6 come from the executor's committed evidence.
4. **Evidence hygiene:** clean. Scratch specs exist only as `.txt`, and no live scratch spec is in `e2e/`.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- In the PR body, label the executor's `c3-fixed-6x-n10-a/b.txt` as chart-test-only. Cite the evaluator's whole-file
  6x batches for the "file-level 6x 20/20" requirement, or commit a whole-file 6x run.
- Correct the comment at `e2e/hel1573-motion-grid-chart.spec.ts:171`. A starved host can shorten a sampled span (59.8
  was seen with the preload), so "a lower bound is not exposed" is not true in general. Point it at this change's
  evidence.
- PR body: state plainly that `:172` was not reproduced without the preload and was not changed, and that `:273`'s
  meaning is now "frames painted after the replayed option". C3 asks for any meaning change to be stated.
