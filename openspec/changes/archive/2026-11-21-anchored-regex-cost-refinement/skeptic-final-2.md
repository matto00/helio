## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `72da8983135e9f46ddd571343adc24588a68bc61`. The diff is against the live review base `590474dcd`
(`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/anchored-regex-cost-refinement/HEL-1807`.
This change has no UI (a cost model plus an e2e test), so the visual design step does not apply. All measurements used
`nice -n 19` and node on the 7600X, one process at a time. The shipped `frontend/src` was transpiled with the frontend's
own TypeScript into `.concertino/scratch/HEL-1807/skeptic-final-2/js/`. The only addition is a test-only export of `testedBound`.

### What I verified (with evidence)

- **Soundness of the staged decision, by reading the code.**
  - `workExceedsBudget` returns `false` at stage 1 or stage 2 only when a sum of per-cell values is at or under the
    budget. It never returns `true` without the exact scan. So the staged decision equals the exact decision iff each stage
    is a per-cell upper bound of `cellWork`.
  - Stage 2 (`testedBound`): when a cell has no lone surrogate, `L = text.length`, and that equals the exact unit count
    (a pair is 2 units for 2 code units). So `R0 <= L`, and `anchoredCost(R0) <= f(A(1+W) + L(A+m))`.
  - The per-position part is bounded by HEL-1697's own argument. The early-return value is at most
    `f*A*text.length <= f*A*L`.
  - When a cell has a lone surrogate, `L = 2*text.length`, which is at least the unit count.
  - Stage 1 uses `L = 2*text.length`. It is monotone in L, so it is at least stage 2.
  - Result: sound. No admit/decline flips in either direction.
- **Soundness, fuzzed.** `fuzz.cjs` ran 8,400 random cells (lone high/low, astral, CJK, Cyrillic, `\n`, em dash) over 14
  anchored and 1 unanchored accepted pattern:
  - `cellWorkBound < cellWork`: 0 cases.
  - `testedBound < cellWork`: 0 cases.
  - `workExceedsBudget` versus `sum(cellWork) > budget` on frames scaled to straddle the budget (k and k+1 copies,
    up to 20,000 rows): 0 mismatches.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-2/fuzz.txt`
- **Round 1's frames are fixed.** I re-ran round 1's `decision2.cjs` against the shipped code on the same shapes
  (cyr/cjk/lone/astral/a) and patterns. The 1,000-row no-tail frames that were 29-34 ms are now 13-19 ms. For example,
  `^([^<64r>]+)` on Cyrillic 1,000 x 1,998 is decision 4.82 + exec 13.81 = 18.63 ms, against 33.67 ms in round 1.
  - Evidence: `.../skeptic-final-2/decision-rerun.txt`. The 20,000-row half of that run hit my 280 s timeout partway; the
    rows it printed are recorded.
  - One reading was anomalous: 25.34 ms for 64r Cyrillic 20,000 x 98. I re-ran it 3 times and got 19.49, 19.62 and
    19.54 ms (`.../decision-20000-cyr-repro.txt`). It was noise, so it is not a finding.
- **Gates (fresh):**
  - `npx jest --maxWorkers=3 src/features/pipelines/evaluator`: 12 suites, 925 tests passed.
  - `npm run typecheck`: exit 0.
  - eslint `--max-warnings=0` on the changed files: exit 0.
  - prettier `--check`: clean.
  - `git diff 590474dcd...HEAD -- shared-test-fixtures`: 0 lines.
- **AC1 (calibration committed):** `calibration.md` and `calibrate-anchored.mjs` are committed, including the new group G.
- **AC2 (red first):** unchanged since round 1 (`red-run.txt`, commit `d3fb4618f` before `bd1c9412c`). For cycle 2,
  `red-run-cycle2.txt` shows the new reads-0 test failing on the cycle-1 code (3,998,000 reads), and mutation M7 is
  recorded red. Note that the red output was committed in the same commit as the fix (`72da89831`), not before it.
- **AC3 (HEL-1697 shapes):** the non-anchored path is unchanged. `boundAt` with `anchored=false` is the old formula, and
  `cellWorkBound` keeps the per-cell lone-surrogate test for unanchored patterns.

### Finding: a new worst case on the staged path

Stage 2 doubles `L` for the whole cell as soon as the cell contains a single unpaired surrogate. The exact charge counts
2 units for that surrogate alone.

So take a near-budget no-tail frame of two-byte cells (Cyrillic or CJK) with **one** lone surrogate per cell:
- the tested bound is about twice the exact charge (7.99e6 against 4.00e6);
- stage 2 fails, so the full exact scan runs, exactly as in round 1;
- on top of that, the new per-cell `LONE_SURROGATE.test` pass also runs.

The result is the round-1 case plus extra work. Probe: `lone-mixed.cjs`, shipped `workExceedsBudget` + `exec`, best of 7,
distinct cells, every frame admitted (`declined=false`). It reproduced across three runs: surrogate at the end (twice) and
at the start.

| pattern | cells (1,000 rows) | exact / tested | decision + exec ms (end, end run 2, start) |
|---|---|---|---|
| `^([^<64 ranges>]+)` | Cyrillic x1,996 + one `\ud800` | 4.000e6 / 7.992e6 | **35.92, 35.62, 33.26** |
| `^([^<64 ranges>]*)` | CJK x1,996 + one `\ud800` | 4.000e6 / 7.992e6 | **35.81, 35.78, 33.88** |
| `^([^<32 ranges>]+)` | Cyrillic, same | 4.000e6 / 7.992e6 | **31.50, 31.18, 28.86** |
| `^([^<16 ranges>]+)` | CJK x2,281 + one `\ud800` | 3.999e6 / 7.991e6 | **31.20, 30.98, 28.13** |
| `^(.+)` | CJK x3,996 + one `\ud800` | 4.000e6 / 7.996e6 | **30.80, 30.51, 26.17** |
| `^(\S+)` | Cyrillic/CJK, same | 4.000e6 / 7.996e6 | **24.58-25.23, 24.44-24.54, 20.01-20.05** |

The decision alone, with exec subtracted, is about 22 ms on the 64-range rows. That is over C2's 20 ms target even before
`exec` is added.

Evidence:
- `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-2/lone-mixed-1000-end.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-2/lone-mixed-1000-end-run2.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-2/lone-mixed-1000-start.txt`
- Script: `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-2/lone-mixed.cjs`

All of these are under 50 ms, so owner ruling C2 accepts them as risk, and this is not a latency blocker. But
`calibration.md` is again untrue about the worst case:
- "Accepted risk (20-50 ms)" lists one row at 20.25 ms.
- "The 20-50 ms rows of the cycle-1 code (21-33 ms) no longer exist" is false. They still exist, at up to 36 ms, behind one
  lone surrogate per cell.
- The PR-body headroom of "about 19-20 ms ... i.e. 2.5x" is really about 1.4x.

Group G's cells are uniform (all-Cyrillic or all-lone), so it never mixes the two. This is the same defect class round 1
refuted: the recorded worst case is not the real worst case of the shipped decision path. The HEL-1697 binding rule
("every change backed by recorded calibration") is not met.

### Verdict: REFUTE

### Change Requests

1. **Measure the mixed-cell rows.** Add group G (or new group H) rows to `calibrate-anchored.mjs` and `calibration.md`:
   - no-tail anchored frames at the budget (`^([^<N ranges>]+)` and `*` for N = 16/32/64, `^(.+)`, `^(\S+)`);
   - cells are two-byte (Cyrillic, CJK) or astral, plus **one** unpaired surrogate (at the start and at the end);
   - 1,000 and 20,000 rows;
   - timed as shipped `workExceedsBudget` + `exec`.

   `lone-mixed.cjs` above is a ready probe.
2. **Then either:**
   - **(a) Record the rows truthfully.** Put every row over 20 ms in "Accepted risk (20-50 ms)". Correct the "Verdicts"
     bullet, the sentence "The 20-50 ms rows ... no longer exist", the round-1 "Change" paragraph ("frames at the budget are
     decided by stage 2 and never scanned" holds only for surrogate-free cells), and the PR-body headroom line, using the
     measured worst case.
   - **(b) Remove the case with a model change, never a budget change.** For example, a stage-2 `L` that adds one unit per
     unpaired surrogate instead of doubling the whole cell, if that can be computed without a JS-level scan (it must stay an
     upper bound; re-fuzz it for `>= cellWork`). Then re-run groups A-G plus the new rows on the shipped code and record
     them, with a Jest test reading 0 characters on a mixed cell and a mutation that turns it red.

   Either way, no admitted row may exceed 50 ms.
3. **Write down the lesson** in calibration.md's "What was missed" section: a staged bound must be calibrated on the inputs
   where each stage is loosest. For the tested bound, that is the cell with exactly one surrogate. Sizing rows only at
   uniform shapes misses it.

### Non-blocking notes

- C12 asks for the red run to be committed before the implementation. Cycle 2 committed `red-run-cycle2.txt` in the same
  commit as the fix. The red output is real (3,998,000 reads on the cycle-1 code), so this is a process note only.
- Comments still cite `openspec/changes/archive/2026-11-21-anchored-regex-cost-refinement/calibration.md`. Check that the
  date matches the actual archive step.
