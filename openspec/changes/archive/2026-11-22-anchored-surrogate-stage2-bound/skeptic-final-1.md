## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `0d1d09c4883293f3db1afc1015fd51ec03ca20c0`. The diff base is `d3059b6114f7735e210a4a1675737585d8dae5c8`, resolved live with `resolve-review-base.sh` (exit 0). I checked everything below myself, fresh. I did not take the executor's or the evaluator's reports on trust.

Skeptic scratch:
- `/home/matt/Development/helio/.concertino/scratch/HEL-1823/skeptic/`
- `/home/matt/Development/helio/.concertino/scratch/HEL-1823/skeptic-cal/`

### What I verified (with evidence)

**Scope of the diff.** Only two source files changed:
- `frontend/src/features/pipelines/evaluator/regexInputCost.ts`
- `frontend/src/features/pipelines/evaluator/regexInputCost.test.ts`

The rest of the diff is change-dir artifacts. Some things did not change at all:
- `REGEX_WORK_BUDGET` is still `4_000_000` (line 13, untouched).
- `cellWork`, `anchoredCellWork`, `perPositionWork`, the stage-1 `cellWorkBound` and the constants are untouched.
- No parity-corpus file appears in the diff.

**Bound soundness (decision identity).** I read the code; I did not rely on the narrative.
- Stage 2 is now `boundAt(work, unitLength(text))`.
- `unitLength` returns `text.length + (LONE_SURROGATE_UNITS - 1) * lone`, which is the `len` that `cellWork` sums.
- `boundAt` is monotone in `L`, and it computes the same float expression as `anchoredCost` with `r0 = L`. So for every cell, stage 2 is at least `cellWork`, with the same float operations.
- `lengthBound` (`L = text.length`) is at most `testedBound`. If its sum is over the budget, the tested sum is too, so going straight to the exact scan is decision-identical.
- Every path is either "an upper bound is within budget" or the exact sum. The decision equals "sum of cellWork > budget".

**Exhaustive probe** (`skeptic/unitlen-exhaustive.mjs`):
- It compares `unitLength` (copied verbatim) with `cellWork`'s `codePointAt` walk, and `isWellFormed()` with `!LONE_SURROGATE.test`.
- It covers every string of length 0 to 7 over {a, U+D7FF, U+D800, U+DBFF, U+DC00, U+DFFF, U+E000}: 960,800 strings.
- Result: 0 mismatches and 0 gate disagreements.

**Jest.** I ran `regexInputCost` and `regexCellWork` with 3 workers, `nice -n 19`: 2 suites, 57/57 tests pass in 4.1 s.

**Red first.** I put main's `regexInputCost.ts` (`git checkout d3059b611 -- <file>`) under HEAD's tests and restored it afterwards; the tree was clean.
- 2 failed: "BMP body" and "astral body: admits the frame at the budget without reading a code point, declines one more".
- This matches `red-run.txt` (commit a3affec3a, before the implementation).

**Mutations.** I re-ran four myself, each against both full spec files, restoring the file after each:
- Surrogate pairs counted as lone: red, 1 failed ("astral body").
- Count only the first lone surrogate: red, 2 failed (the mixed pair/lone property test, and "doubles an unpaired surrogate…").
- `lengthBound` stage removed: red, 1 failed ("does not count the unpaired surrogates…").
- Gate inverted (an extra mutation of my own): red, 3 failed.

These agree with `mutations.txt`.

**Calibration, spot-reproduced.** Each run used `nice -n 19`, one group per call, with output in `skeptic-cal/`.

Group H on HEAD (`after-H.log`):
- 200 anchored rows: 0 over 20 ms, worst 17.66 ms.
- 0 MISMATCH and 0 DECISION-DIFF.
- The worst row overall is 25.1 ms, an unanchored `(x)` row. Its code is unchanged and it is out of scope as a design non-goal.

Group H on main's implementation (`main-H.log`, reproduced by me):
- 157 anchored rows over 20 ms, worst 41.3 ms.
- Same machine as the HEAD run, but measured in a separate pass, so the 41.3 ms partly reflects the noisy desktop.

The columns for row, parameters, cells and cost are byte-identical across main-H, after-H and the executor's `before-H.log` (one md5 across all three). So no cost changed.

**AC1 is met: the group-H worst shape now measures under 20 ms, and a deterministic test pins it at 0 code-point reads.**

Group I, dense unpaired surrogates (`after-I.log` against my own `main-I.log`):
- 64 rows: 0 over 20 ms, worst 17.74 ms, 0 DECISION-DIFF.
- No row is more than +1.47 ms slower than main. The extra time is in `exec`, not the decision: 0.08 versus 0.17 ms. That is noise.
- The cost columns are identical.

Group G (`after-G.log` against the executor's `before-G.log`):
- 84 rows: 0 over 20 ms, worst 18.83 ms. calibration.md says 15.1; my run was noisier but still under 20.
- No row is more than +1.25 ms slower than before, again in `exec`.
- 0 MISMATCH/DIFF, and the cost columns are identical.

I did not re-run groups A to F. Their code paths are either unchanged (the unanchored path) or covered by the structural identity argument and the exhaustive probe above.

**AC3, e2e.** I used the sanctioned lane flow:
1. `stop-servers.sh`
2. `e2e-backend.sh lane-start` on 7255/10162, using DB `helio_hel1823` and an empty `ANTHROPIC_API_KEY`
3. `npm run e2e:prod-build -- e2e/hel1683-regex-main-thread.spec.ts`
4. `stop-servers.sh`

Result: exit 0, 4 passed (the guard plus 3 tests). The longest long task was 0.0 ms in the probe, overrun, long-cell and anchored checks, and the 3 throwaway users were deleted. After the stop, nothing listens on 7255 or 10162. Transcript: `skeptic/e2e-run.txt`.

**Gates on the changed files.**
- `eslint --max-warnings=0` on both files: exit 0.
- `prettier --check`: clean.
- `npm run typecheck`: exit 0.

**UI.** There is no UI change, so the design review is skipped.

### Verdict: CONFIRM

### Non-blocking notes
- The `calibration-logs/*.log` files that `calibration.md` cites are gitignored (`.gitignore:27 *.log`). They are not committed and not in `.concertino/runs/HEL-1823/evidence/`. The orchestrator should persist them with `persist-evidence.sh` before `cleanup.sh --phase4`, or `calibration.md`'s citations will dangle.
- The `!LONE_SURROGATE.test` fallback (runtimes without `String.prototype.isWellFormed`) is not exercised by jest, which runs on Node 22. My exhaustive probe shows the two gates agree, so this has no effect on correctness.
- None of my evidence depends on mtime ordering.
