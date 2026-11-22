## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `39ad31aeb1d04ea49aa77af202664413d2da1b7e`, diff against the live review base `590474dcd` (from
`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/anchored-regex-cost-refinement/HEL-1807`.
There are no UI changes (cost model plus an e2e test), so the visual design step does not apply.

### What I verified (with evidence)

- **AC1, calibration committed.** `calibration.md` and `calibrate-anchored.mjs` are committed in the change dir (commit
  `55349e05d`, before any test or model code).
- **AC2, red first.** The order is calibration `55349e05d`, then the red tests plus `red-run.txt`/`red-run-e2e.txt` in
  `d3fb4618f` (no source file in its stat), then the implementation `bd1c9412c`. `red-run.txt` line 82 shows the AC test
  (`^(.*)$` over 1,000 x 500) failing on the pre-change model. `red-run-e2e.txt` shows the e2e anchored case making a
  draft-preview request. The AC test is in `regexInputCost.test.ts` and also checks `out === cell` on every row.
- **AC3, HEL-1697 shapes.** For non-anchored work, `cellWork` now delegates to `perPositionWork`, whose body is
  byte-identical to the old `cellWork`, and the non-anchored `cellWorkBound` lines are unchanged (read in the diff). So
  every HEL-1697 decision for an unanchored pattern is unchanged. I re-ran the anchored forms myself (all six groups A-F of
  `calibrate-anchored.mjs`, `nice -n 19`, output under `.concertino/scratch/HEL-1807/skeptic-final-1/group-*.txt`): 0
  `MISMATCH` and 0 `REJECTED`. The worst rows reproduce the recorded ones: A 7.7 ms (recorded 8.6), B 9.2 (9.0), C 10.0
  (10.2), D 18.5 (18.5, the unanchored control), E 13.03 ms shipped `workExceedsBudget` (recorded 13.05), F 0.7 (0.7).
- **Soundness of `cellWorkBound >= cellWork` (anchored).** By reading the code:
  - Early return: `attempt <= f*A*text.length <= first bound`, and `R0 <= 2*text.length` units, so `attempt <=` the
    second bound.
  - Final return: `min(attempt, perPos)` is at most each bound, because today's bound is monotone in L and
    `L = 2*text.length` is at least the lone-surrogate L.
  - Fuzz (`probe/probe.cjs`): 76,000 random cells (lone high/low, astral, CJK, Cyrillic, `\n`, em dash) over 19 anchored
    patterns. Zero cases of `bound < exact` or `exact > per-position`.
  - Independent recomputation of `min(f(A(1+W)+R0(A+m)), perPos)` (`probe/time.cjs`): zero mismatches.
- **Characters-read invariant.** The early return reads R0 plus 1 code points, and `attempt >= f*A*(R0+2)`. The else
  branch reads `text.length` and adds at least `f*A*text.length`. Jest's `codePointAt` counter tests cover this, and
  mutation M6 (always do the full scan) turns them red.
- **Eligibility on the flattened tree.** `startAnchored(alts)` takes `alts = flatten(root)`. Groups and anchors cannot be
  quantified: `translate` declines a quantifier unless `last === "atom"`. So `(^a)?x`-style bypasses cannot exist.
  `(|^a)b` and `()|^a` correctly come out false. `(?` is declined, so multiline is unreachable, and the Jest guard pins
  `(?m)^(.*)$`. Only `exec` is used, with no `g`/`y`/split, so V8 makes one attempt per cell.
- **Gates (fresh):**
  - `npx jest --maxWorkers=3 src/features/pipelines/evaluator`: 12 suites, 923 tests passed, exit 0 (includes the parity
    test).
  - `npm run typecheck`: no errors.
  - eslint `--max-warnings=0` on the changed files: exit 0.
  - prettier `--check`: clean.
  - `git diff 590474dcd...HEAD -- shared-test-fixtures`: 0 lines.
- **e2e.** I did not re-run it. `e2e-green-run.txt` shows all 3 tests passing on lane ports 7239/10146, with no
  draft-preview request for the anchored case and a longest task of 0.0 ms. I accepted this because the pasted output is
  unambiguous and my node measurements below are far from 100 ms.
- **Mutations.** `mutations.txt` lists M1-M6, each red on the named tests. I did not re-run them (that would need code
  edits). They match the design D4 list.

### Finding: admitted anchored frames over 20 ms that the calibration does not record

The calibration says every row is at or under 20 ms and the 20-50 ms accepted-risk band is empty. Its "Shipped-code
confirmation" says "Nothing is over 20 ms". Standing constraint C2 and design D3 require that every row over 20 ms be
recorded as accepted risk.

The decision-scan rows miss the worst case for the new model. That case is an anchored wide class with no tail
(`m = 0`, `W = 1`), so the charge is `f x (2A + R0 x A)`: one unit per character. The exact scan then reads about
`4.00e6 / f` code points before the budget is reached. That is twice what the per-position charge allowed for the same
class (`([^<16>]+)` on Cyrillic at the budget: 8.3 ms). And V8's exec on two-byte cells is at its slowest per unit there.

The calibration's own `^(\d+)` on digits row at 1,000 x 2,000 costs 2.0e6, half the budget, so it never reached this
case.

I measured the shipped `workExceedsBudget` plus `exec` on frames at or just under 4.00e6, all client-admitted
(`declined=false`). Method: best of 7, distinct cells, `nice -n 19`, node.

| pattern | cells | decision + exec |
|---|---|---|
| `^([^<64 ranges>]+)` | Cyrillic 1,000 x 1,998 | 19.84 + 13.83 = **33.67 ms** |
| `^([^<64 ranges>]+)` | CJK 1,000 x 1,998 | **33.67 ms** |
| `^([^<64 ranges>]+)` | Cyrillic 20,000 x 98 | **33.35 ms** |
| `^([^<64 ranges>]*)` | Cyrillic / CJK 1,000 x 1,998 | **33.67 / 33.75 ms** |
| `^([^<16 ranges>]+)` | Cyrillic 1,000 x 2,283 | **29.86 ms** (20,000 x 112: 29.32) |
| `^([^<32 ranges>]+)` | CJK 1,000 x 1,998 | **29.23 ms** |
| positive 63-range class `^([ĀĂ...ż]+)` | its own characters | **29.23 ms** |
| `^(.+)` | CJK 1,000 x 3,998 | **26.53 ms** (Cyrillic 22.97) |
| `^(\S+)` | Cyrillic / CJK 1,000 x 3,998 | **21.21 ms** |

The table reproduced across three separate runs (33.67, 33.67 and 33.85 ms for the 64-range Cyrillic row). Persisted
evidence:
- `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-1/probe/decision-2.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-1/probe/decision-4.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-1/probe/decision-1.txt`
- Script: `/home/matt/Development/helio/.concertino/runs/HEL-1807/evidence/.concertino/scratch/HEL-1807/skeptic-final-1/probe/decision2.cjs`.
  Its `shapes` line was later switched to a `SHAPES` env variable for the decision-4 run; decision-2 used the hardcoded
  cyr/cjk/lone/astral/a shapes.

All of these are under 50 ms, so owner ruling C2 would accept them as risk. This is not a latency blocker. HEL-1697
recorded its own 21-34 ms rows the same way. But the shipped evidence states a worst case of 19 ms when the real worst
case is about 34 ms. A V8 constant-factor slowdown of 1.5x puts this shape at the 50 ms line, and the 2.5x headroom the
PR will claim is really about 1.5x. That is the evidence-shaped non-evidence the HEL-1697 binding rule ("every change
backed by recorded calibration") exists to prevent.

### Verdict: REFUTE

### Change Requests

1. **Add the missing rows.** In `calibrate-anchored.mjs` group E, and in `calibration.md`, add decision-scan rows for the
   anchored no-tail wide-class form (`m = 0`):
   - `^([^<N ranges>]+)` and `^([^<N ranges>]*)` for N = 16/32/64, `^(.+)`, `^(\S+)` and `^(\d+)`;
   - on Cyrillic, CJK, astral, lone-surrogate and one-byte cells;
   - each sized so the frame's exact charge is at or just under 4.00e6, at 1,000 rows and at 20,000 rows;
   - timed as shipped `workExceedsBudget` plus `exec` together.

   Also size the existing `^(\d+) on digits` rows at the budget (1,000 x 3,998, not 1,000 x 2,000, which is 2.0e6).
2. **Record the result truthfully.** Either:
   - (a) record every row over 20 ms in "Accepted risk (20-50 ms)", and correct the "Verdicts", "Accepted risk" and
     "Shipped-code confirmation" statements that say no row is over 20 ms or that the band is empty. Also correct the
     headroom wording that goes into the PR body. Or
   - (b) bring those rows to 20 ms or under by a change to the model, never the budget: for example a higher per-unit
     constant for anchored `m = 0` wide classes, or a cheaper exact scan. Then re-run groups A-F on the shipped code and
     record the results.

   Either way, no admitted row may exceed 50 ms.
3. **Write down why these rows were missed.** In `calibration.md`, note that the worst decision-scan case of the anchored
   model is the `m = 0` one-unit-per-character charge, not only the two-byte first-run rows of skeptic-design-3.md. A
   future refinement should then size its decision rows at the budget.

### Non-blocking notes

- The e2e anchored frame (12 x 10,000, about 3.6e5 units) is a browser tripwire for anchoring, not a near-budget
  measurement. That is fine as designed. The 100 ms bound is far from any number measured here.
- Comments cite `openspec/changes/archive/2026-11-21-anchored-regex-cost-refinement/calibration.md`. Make sure the archive
  date matches the actual archive step.
