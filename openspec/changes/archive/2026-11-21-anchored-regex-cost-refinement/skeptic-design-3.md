## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` READY (branch `feature/anchored-regex-cost-refinement/HEL-1807`, HEAD
  590474dcd1122e6625d3ddc7bc387599b028b3a3; the change dir is untracked, so no code has changed).
- I read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-client-evaluator/spec.md and workflow-state.md
  (C1, C2). I read skeptic-design-1.md and skeptic-design-2.md, `regexInputCost.ts` (all 85 lines), `javaRegexCost.ts`
  (`flatten`, `weightOf`, `regexWorkModel`) and `compileJavaRegex`. `A = paths >= 1`, `W >= 1` and `f >= 1`
  (`classFactor`), so `f x A x len >= len`. `workExceedsBudget` is the only production caller of `cellWork` and
  `cellWorkBound` (`steps/stringOps.ts:103`).

**Does the C2 invariant bound the characters read? Yes, by construction.**

- Exact phase. For an anchored cell, the scan reads at most `R0 + 1` code points, and
  `anchoredCost = f(A(1+W) + R0(A+m)) >= R0 + 1`. When `anchoredCost <= f x A x text.length`, the value is exactly
  `min(anchoredCost, perPosition)`, because `perPosition >= f x A x units >= f x A x text.length`. So the decision is
  identical to the plain `min`. Otherwise the scan reads `text.length < anchoredCost/(fA)`, and the charge added is
  `min(...) >= len`. Characters read therefore stay within about the charge (at most about 2x when the first-run
  scan and `cellWork` re-read the cell), and the exact loop stops once the total passes the budget.
- Bound phase. The anchored bound `min(today, f(A(1+W) + L(A+m)))` is at least `f x A x L >= text.length`. The bound
  loop therefore stops after reading about budget-many characters plus the last cell, the same as today. The
  `LONE_SURROGATE` test is bounded either way. The `L = 2 x text.length` fallback is a constant-factor choice, not a
  correctness need.
- Probe (`scan3.mjs`, `scan3.out` in `/home/matt/Development/helio/.concertino/scratch/HEL-1807/skeptic-design-3/`).
  It copies `cellWork`, `inRanges` and `cellWorkBound` verbatim and implements D2 round 3 as written, with the
  `L = 2len` fallback off (`sf=0`) and on (`sf=1`). Two decision measures were taken:
  - Round-2 frames. `^(a*)b` on `c`+`a...` dropped from 80-89 ms to 0.01-0.36 ms. `^(\d+)` on ASCII prose dropped
    from 103-120 ms to 0.02-0.94 ms.
  - Characters read. No frame read more than 6.07M characters in total (bound plus exact), at any of 1,000 x 500,
    1,990, 2,000 or 20,000, 10,000 x 2,000, or 20,000 x 200.
- The round-2 failure is resolved. The Jest scan-bound test on `^(a*)b`, cell `c` + 20,000 `a` (`R0 = 0`, so at most 1
  code point is read) goes red under the "always run the full scan" mutation, since that mutation reads 20,001.
  Tasks 1.2, 2.1, 3.2 and 4.2 name the C2 work.

**Do the planned calibration rows make the C2 timing claim checkable? No.**

- The listed decision-scan rows are `^(a*)b` on `c`+`a...`, `^(\d+)` on prose and the AC frame. On these, the revised
  scan does almost nothing:
  - `R0 = 0`, or the bound stays under budget.
  - The cells are ASCII. V8 stores them as one-byte strings, so the `LONE_SURROGATE` test costs about 0 ms.
    `^(\d+)` on ASCII prose read 4.0M characters in 0.02-0.94 ms.
- The decision's real worst case is outside those rows: two-byte cells whose first run covers almost the whole cell,
  with the bound just over budget and the exact charge just under it. Those frames read about 4-6M characters across
  both phases, then run `exec`. Measurements are best of 3, `nice -n 19`, decision plus `exec`; I ran them twice
  (`worst3.out`, `worst3-rerun.out`):

  | frame | sf=0 total | sf=1 total |
  |---|---|---|
  | `^([^x]*)x`, Cyrillic `ж...` + `x`, 1,000 x 2,000 | 30.5 / 36.3 ms | 25.9 / 22.4 ms |
  | `^([^x]*)x`, same cells, 20,000 x 100 | 31.7 / 33.4 ms | 23.4 / 28.4 ms |
  | `^([а-я]*)x`, Cyrillic + `!!!!!!`, 20,000 x 100 | 29.4 / 24.6 ms | 22.8 / 21.4 ms |
  | `^(\d+)` on Cyrillic prose, 20,000 x 200 (`scan3.out`) | 18.6 ms | 0.6 ms |

  Today the same frames are declined at about 0 ms decision cost, because the per-position `R^2` term overflows on
  the first cell. Under D2 they become 21-36 ms of new main-thread work. That is inside owner ruling C2's 50 ms limit,
  but above 20 ms, so under D3's own rule it must be recorded as accepted risk.
- Two gaps follow:
  - Calibration rows that read 0-1 ms would certify C2 against benign frames only, and the binding rule "every case
    backed by recorded calibration" would be met in letter only.
  - D2's conditional ("if the lone-surrogate test dominates the decision-scan rows, use `L = 2 x text.length`") is
    judged on ASCII rows, where it cannot show. On my frames, the fallback helped on two-byte prose (18.6 to 0.6 ms)
    and sometimes hurt (`^([а-я]*)x` 1,000 x 1,990: 10.0 to 19.5 ms).

**Round-1 resolutions re-checked against the current text:**

- CR1 holds. `min` is in both the charge and the bound, the spec delta says "never more than the per-position charge",
  and the `^(a{1000})b` 10,000 x 10 guard and its "drop the min" mutation are in place.
- CR2 holds. `()^a` qualifies on the flattened tree, `(a)^b` and `(.*)^(x)` are negatives, and the "any anchor in the
  sequence" mutation is listed.
- CR3 holds. The anchored form puts `^` before every alternative, and the 64-alternative r=8 row,
  `(a?)(b?)(c?)(d?)`, `(a*)bcd` and the Cyrillic `(.{8})(.{8})x` row are all listed.
- CR4 holds. `^(.*)x` 1,000 x 2,000 gives 4.003e6 and is labelled a guard.
- CR5 holds. Per-call rows are judged by measured time, and the `^()` charge (0 on an empty cell, 1 on a one-character
  cell) is correct under the `min`. I recomputed it: per-position 1, anchored `1 x (1 + 1) = 2`.
- Round-2 notes adopted: the `(^(a*)|^(c))b` row and the row-value assertion in the AC test.
- AC arithmetic re-checked. `^(.*)$` on 1,000 x 500 gives an anchored bound of 1,504 per cell, total 1.504e6, so the
  bound phase alone decides `ok`. Today's charge is 502,000 per cell, so the test is genuinely red now.

No other soundness gap found. The eligibility, the charge's upper-bound argument (rounds 1 and 2) and the
decision-identity of the short-circuit all hold.

### Verdict: REFUTE

### Change Requests

1. **D3 decision-scan rows (C2): cover the scan's actual worst case, and decide the `L = 2 x text.length` fallback on
   those rows.** Add these rows, timing `workExceedsBudget` plus `exec` together:
   - Two-byte cells whose first `U`-run covers almost the whole cell, with the frame sized so that the anchored bound
     exceeds 4.00e6 while the exact anchored charge stays at or under it. For example, `^([^x]*)x` on `ж...` + `x`
     cells (`R0 = len - 5`) at 1,000 x 2,000 and 20,000 x 100, and `^([а-я]*)x` on `ж...` + `!!!!!!` at 20,000 x 100.
   - `^(\d+)` on two-byte (Cyrillic or CJK) prose at 1,000 x 20,000 and 20,000 x 200, alongside the ASCII row.

   I measured these at 21-36 ms. Record each one over 20 ms as accepted risk under the existing 50 ms rule. If any
   row is over 50 ms, fix the scan, for example with a single pass instead of the first-run scan followed by a full
   `cellWork` re-read, or with the surrogate-free bound. Never change the budget. Decide the D2 fallback on these
   rows, not on the ASCII ones, where the surrogate test costs nothing. Update task 1.2.

### Non-blocking notes

- Make the scan-bound Jest test count reads through the function `workExceedsBudget` actually calls. If the counting
  helper is a sibling of `cellWork` rather than the anchored path inside it, wiring `workExceedsBudget` back to a full
  scan would leave the test green, because the value is identical. Have the "always run the full scan" mutation edit
  that production path.
- In the else branch, a single pass that collects `R0` and the per-position total together avoids re-reading the
  cell. It is the cheapest fix if the CR1 rows come in near 50 ms.
