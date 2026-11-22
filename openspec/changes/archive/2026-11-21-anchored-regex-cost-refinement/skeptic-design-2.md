## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` READY (branch `feature/anchored-regex-cost-refinement/HEL-1807`, HEAD
  590474dcd1122e6625d3ddc7bc387599b028b3a3; the change dir is untracked, so no code has changed).
- I read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-client-evaluator/spec.md and skeptic-design-1.md,
  plus the code: `javaRegex.ts` (tokenizer, `compileJavaRegex`), `javaRegexCost.ts` (`flatten`, `regexWorkModel`),
  `regexInputCost.ts` (`cellWork`, `cellWorkBound`, `workExceedsBudget`), `steps/stringOps.ts` (`overBudget`, a single
  `exec` per cell), `services/draftPreviewCaps.ts` (`frameRows: 10_000`). I also read the HEL-1697 calibration
  (cycle 2, the anchor section, and the final-gate decision-scan section).

**Round-1 change requests**

1. CR1 is resolved. D2 now charges `min(anchoredCost, perPositionCost)`, and `cellWorkBound` is `min(today's bound,
   f x (A(1+W) + L(A+m)))`. Both are sound. Today's per-position charge includes index 0, so it is an upper bound
   under anchoring. `R0 <= L` in units: lone surrogates count 2 in both, and `L` doubles when a lone surrogate is
   present. So `min(a, b) <= min(A', B')`. The spec delta says "never more than the per-position charge". The guard
   `^(a{1000})b` uses 10,000 x 10 `a` cells. After flatten the pattern is anchor, `a{1000}` (not a choice, so weight
   1000) and `b`, which gives W = 1001, A = 1 and m = 0. Today's charge is 110 per cell (1.1e6). Without the `min` it
   is 1,012 per cell (1.01e7). So the "drop the min" mutation turns this guard red.
2. CR2 is resolved. Eligibility is decided on the flattened tree only. `()^a` qualifies, and `(a)^b` and `(.*)^(x)`
   are negatives that make the "any anchor in the sequence" mutation fail. The tokenizer emits anchors only for `^`
   and `$` (`javaRegex.ts:111,114`). A quantifier after `^` declines (`last !== "atom"`), and groups cannot be
   quantified. So "first item is a non-dollar anchor" means exactly an unquantified `^`.
3. CR3 is resolved. The anchored form now puts `^` before every top-level alternative. The 64-alternative r=8
   negated-class row on two-byte excluded characters, `(a?)(b?)(c?)(d?)`, `(a*)bcd` and the Cyrillic
   `(.{8})(.{8})x` row are all listed.
4. CR4 is resolved. For `^(.*)x`, A = 1, W = 2 (0 + max(1,0) + 1) and m = 1 (tail weight 1). Over 1,000 x 2,000
   cells that is 3 + 4,000 = 4,003 per cell, or 4.003e6 > 4.00e6. It is labelled a guard, and the "R0 -> 0" mutation
   turns it red. I recomputed the AC arithmetic: `^(.*)$` gives A = 1, W = 3, m = 2 and 1,504 per cell, or 1.504e6.
   Today's charge is 502,000 per cell, so the test is genuinely red now. The partly anchored guard `^(.*)x|y` costs
   5.03e8 today and 2.006e6 when wrongly treated as anchored, so its mutation goes red.
5. CR5 is resolved. Per-call rows are now judged by the measured time at 10,000 and 20,000 rows (<= 20 ms), not
   extrapolated. `^()` is added.

**Independent probes** (node, `nice -n 19`; output in
`/home/matt/Development/helio/.concertino/scratch/HEL-1807/skeptic-design-2/`)

- **The decision scan of D2 is a new main-thread cost (`scan.mjs`, `scan.out`, reproduced in `scan-rerun.out`).**
  The probe copies `cellWork`, `inRanges` and `cellWorkBound` verbatim and implements D2 as written: the anchored
  bound first, then a full per-cell scan for the `min`. It times the decision on frames where an anchored pattern's
  exact charge is far below the cell length. Two runs:

  | pattern / frame | today: decision, scan | D2: decision, scan | `exec` |
  |---|---|---|---|
  | `^(a*)b`, cells `c` + `a...`, 1,000 x 20,000 | decline, 0.1 ms | client, 80.3 / 81.5 ms | 0.03 ms |
  | `^(a*)b`, same cells, 10,000 x 2,000 | decline, 0.0 ms | client, 82.1 / 88.8 ms | 0.3 ms |
  | `^(\d+)` on prose, 1,000 x 20,000 | decline, 17.6 / 16.5 ms | client, 109.9 / 108.8 ms | 0.01 ms |
  | `^(\d+)` on prose, 10,000 x 2,000 | decline, 16.0 / 16.0 ms | client, 119.8 / 103.3 ms | 0.12-0.19 ms |

  Today, the exact scan's per-cell charge is at least `f x A x len`. The scan therefore exits after reading about
  budget-many characters (HEL-1697 recorded about 21 ms as accepted risk). Under D2 the per-cell charge can be
  `A(1+W)`, which is constant. The bound (which includes `L(A+m)`) still overflows, so the full frame is scanned, and
  then the cheap regex runs. That makes a single main-thread task of 80-120 ms. It breaks the 50 ms rule of owner
  ruling C2 and the 100 ms long-task line. The design's claim that "the bound-first ordering of `workExceedsBudget`
  keeps it rare" is false here. `^(\d+)` on ordinary text is a natural anchored pattern, not a contrived one. None of
  the D3 calibration rows or D4 tests measure the decision scan, so the plan as written would ship this.
- **Nested anchored alternation (`nested.mjs`, `nested.out`).** `((a*)|(c))b` takes 2,117 ms. Its anchored forms
  `(^(a*)|^(c))b`, `((^a*)|(^c))b` and `((^(a*)|^(c)))b` take 2.1-2.4 ms. So V8 anchors D1's group branch, the only
  eligible form that `flatten` keeps as a multi-alternative group. The D3 list has no row for that form with a
  quadratic-capable quantifier (see the notes).

### Verdict: REFUTE

### Change Requests

1. **Bound the exact anchored decision scan (design D2 and D3, `regexInputCost.ts` task 3.2).** D2's "exact anchored
   scan keeps the full per-cell scan" makes `workExceedsBudget` read the whole frame on anchored frames whose charge
   per cell is far below the cell length. The measurement is 80-120 ms of main-thread work, reproduced twice, against
   0-18 ms today (table above). That breaks the 50 ms rule and the 100 ms long-task line.

   Required fix: scan an anchored cell only to the end of its first run, which gives `R0` and `anchoredCost`. Then
   use the lower bound `perPositionCost >= f x A x text.length`, which holds because units are at least the
   code-unit length. If `anchoredCost <= f x A x text.length`, the `min` is `anchoredCost` with no further scan.
   Otherwise run the full `cellWork`. That only happens when `text.length < anchoredCost / (f x A)`, so the characters
   read stay within the charge, and HEL-1697's "scan length is about the budget" invariant holds again. Any other
   form that restores that invariant is acceptable; state the invariant in design D2.

   Also:
   - Add decision-scan calibration rows to D3. Time `workExceedsBudget` plus `exec` together, the way HEL-1697's
     final-gate section did, for `^(a*)b` on `c` + `a...` cells and `^(\d+)` on prose. Use 1,000 x 20,000 and
     10,000 x 2,000 frames. Each row must be <= 20 ms, or accepted risk up to 50 ms.
   - Add a Jest test that does not depend on timing. For example, count `codePointAt` reads or calls through an
     exported scan helper, or assert that the anchored exact path reads at most `R0 + 1` code points on a cell whose
     `anchoredCost <= f x A x len`.
   - Add the mutation "always run the full scan" to D4, and make that test go red under it.
   - Update tasks 1.2, 2.1, 3.2 and 4.2 to cover these.

### Non-blocking notes

- D3 has no calibration row for an all-anchored alternation nested in a group with a wide quantifier, such as
  `(^(a*)|^(c))b` on `a...` cells. That form stays a multi-alternative group after `flatten`, and it is D1's group
  branch. I measured it at 2.4 ms against 2,117 ms unanchored (`nested.out`), so it is safe. Recording it alongside
  `(^a*)b` and `()^(a*)b` would back every eligibility branch with a row.
- D3 says `^()` is charged "2 units per empty cell". Under the D2 `min`, an empty cell costs 0 per-position units (the
  same as today), and a 1-character cell costs 1. The per-call rows are judged by measured time, so the verdict rule
  still works. Correct the charge figure so the calibration table does not report a wrong cost.
- The AC test checks `{status: "ok"}`. The spec scenario also says "the same rows as the server engine". For
  `^(.*)$` on `a` cells the rows are the cell itself. Asserting one returned row value costs nothing.
