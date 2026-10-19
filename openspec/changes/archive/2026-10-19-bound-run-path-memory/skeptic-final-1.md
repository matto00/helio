## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 25e718d49900038c293b38f2e6cd7a42d7e2b6ff. Base resolved live with `resolve-review-base.sh`: 25aca36601d8c10a3d098f0354549d2af0342230.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/run-path-memory-bounds/HEL-1660`.
- **Diff read in full** (`git diff 25aca3660...HEAD` over `Dockerfile` and `backend/src/main`). The things I checked:
  - `RunLimits` (100,000 rows, 1,048,576 chars, 2,600,000 cells, `LimitLabel.Run`). It is applied once, in `InProcessExecutionBackend.execute`.
  - `retain` is required on the trait. `PipelineRunExecutor` lists the Outputs before the walk.
  - `runRetention` keeps the terminal, and the roots and upsertsource inputs stay charged.
  - D7 (`try` arms plus the `isBoxedFatal`/`unboxStackOverflow` guard).
  - The Dockerfile flag `-XX:+ExitOnOutOfMemoryError`.
- **Draft preview unchanged (AC8):** every label parameter defaults to `LimitLabel.Draft`, and its strings are the old text. `DraftPreviewService` now passes `leafFirst = true`. Before this change, leaf-first was inferred from `maxLiveCells.isDefined`, which the draft always sets, so the draft's walk order is the same. The draft never sets `runRetention`. By inspection, no behaviour change.
- **`jsRows` reuse:** `outcome.rows eq resultRows` is a reference check, and `jsRows` is built from `resultRows` with the same per-row conversion. The persisted rows are identical, so this is correct.
- **`LateFinisherSpecBase` seam:** the `engineReturned` set leaves the pre-walk Output listing alone, so the late-finisher hooks still target the listing in the success chain. It is keyed by pipeline id, so it is sound.
- **D7:** matches the design that was CONFIRMed at round 4, including the disclosed hang of a non-OOM fatal error on a later node. No new finding.
- **Measured `MaxLiveCells` and its margin argument (the deciding check).** I re-ran the heap measurement myself.
  - Setup: a scratch copy of `backend/` at HEAD, outside the worktree (no worktree file changed). Forked JVM `-Xmx768m` (`maxMemory MB: 768`), under the sbtfull lock, 2 repeats, with `RunPathHeapSpec`'s own harness and sampling unchanged.
  - The only addition is one shape. It is the executor's own `just-under-light@2600000` chain (50,000 x 6 CSV, `textLightSteps(2,600,000)` = 17 `concat($a, $f)` steps, Output on the terminal) plus **one more Output on the terminal's parent**.
  - That is a legal two-Output pipeline of the same class as AC6 ("Outputs on a middle node and the terminal"). The live-cell budget accepts it: held cells at the last step are 300,000 + 1,100,000 + 1,150,000 = 2,550,000 ≤ 2,600,000.
  - Result:
    ```
    shape just-under-light@2600000   real delta MB   159.1 / 158.6   succeeded   (control; executor recorded 158.5)
    shape just-under-light@2600000   dry  delta MB   116.0 / 115.7   succeeded
    shape adjacent-outputs@2600000   real delta MB   258.9 / 259.0   succeeded, 50000 rows
    shape adjacent-outputs@2600000   dry  delta MB   115.6 / 115.6   succeeded
    max over shapes MB: 259.0 (bound 192.0); largest swing between repeats of one shape: 0.5 MB
    ```
  - The result is stable: the swing is 0.5 MB and the control reproduces the executor's number exactly.
  - Persisted evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1660/evidence/.concertino/scratch/HEL-1660/skeptic-final-probe/probe-summary.txt`. The probe source is `.../skeptic-final-probe/backend/src/test/scala/com/helio/services/pipelines/SkepticAdjacentOutputsHeapProbe.scala` under the same evidence root.
  - These are self-authenticating numbers, not mtime ordering.
- **Why it breaches:** the dry run is identical (115.6 MB), so the walk itself is bounded. The extra 100 MB is the post-walk success path, which the cell budget does not price:
  - The non-terminal Output's frame stays retained (`nodeOutcomes`).
  - The success path builds that frame's full `nodeJsRows` JSON copy (`PipelineRunSucceededWrites.scala`, the `else` branch of the `jsRows` reuse).
  - The terminal's `jsRows` copy (`PipelineRunExecutor.scala`, `executeRunSuccess`) is alive at the same time.
  - The design's premise (design.md D6, lines 93-95) is that the terminal-only text-light shape "is the worst case for the per-cell JSON copies". That premise is false: a large non-terminal Output doubles the unpriced JSON. The AC6 shape only fits because its middle Output is small (550,000 cells).

### Verdict: REFUTE

### Change Requests

1. **The run budget does not hold a run to 25% of the 768 MB heap (owner ruling 3, AC3).** A pipeline the run accepts uses 259 MB, 35% over 192 MB. It is a 50,000 x 6 CSV with an Output on the terminal and an Output on the terminal's parent (evidence above).
   - Make the post-walk peak bounded by the budget. Either option works, or one of equal effect:
     - (a) Do not hold a non-terminal Output's JSON copy and its retained frame and the terminal's `jsRows` all at once. For example, release an Output node's frame from the outcome map once its snapshot and alert writes are done, or stream or convert per write rather than materialising a full `nodeJsRows`.
     - (b) Price the copies the success path will make. For example, charge every retained Output frame's JSON conversion against `MaxLiveCells`, then re-size the constant.
   - Whichever you choose, add the measured shape. Re-measure under the same rules (forked `-Xmx768m`, 3 repeats, worst budget-dependent shape ≤ 192 − largest swing).
2. **Add the adjacent-large-Output shape to `RunPathHeapSpec`.** That is `just-under-light` plus an Output on the terminal's parent. A variant with several large non-terminal Outputs held up to the budget is also worth adding. Record the result in design.md "Measured Budget".
   - Correct the D6 sentence that calls the terminal-only text-light shape the worst case for the JSON copies.
   - Extend `RunLimitsGuardSpec` (the deterministic CI guard) so the post-walk accounting chosen in CR1 is pinned and a mutation turns it red.
3. **Update the capacity disclosure** (evaluation-2 Point 1, "a third non-terminal Output is refused") after CR1. Its statement of what fits at the largest accepted CSV depends on the accounting chosen there.

### Non-blocking notes
- The evaluator's notes still stand: the `RunLimitsGuardSpec` test name "one 50,000-cell column wider" is inaccurate at 2.6M, and `mutations.md` lacks the old/new edit text.
- `evaluation-2.md` is untracked in the worktree; commit it with the next cycle.
- No gate defect to record: no mtime-ordering claim was relied on.
