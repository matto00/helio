## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` READY (branch `feature/anchored-regex-cost-refinement/HEL-1807`, HEAD 590474dcd).
- Read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-client-evaluator/spec.md; code `javaRegex.ts`,
  `javaRegexCost.ts`, `regexInputCost.ts`, `steps/stringOps.ts`, `regexInputCost.test.ts`, `regexWorkModel.test.ts`;
  HEL-1697 evidence `regex-work-calibration.md`.
- Evaluation is one non-global, non-sticky `compiled.regex.exec(cell)` per cell (`steps/stringOps.ts:78`, flag `u`
  only, `javaRegex.ts:198`), so a V8-anchored pattern makes exactly one attempt at index 0. Inline flags (`(?`) decline
  (`javaRegex.ts:118`), so `m` is unreachable. The premise holds.
- D1 against V8 (node, `nice -n 19`; script and output in
  `/home/matt/Development/helio/.concertino/scratch/HEL-1807/skeptic-design-1/anchor.mjs`, `anchor.out`). 1,000 rows of
  2,000 `a` plus a 4-digit suffix: `(a*)b` 1868 ms. Anchored, all 0.01-2.6 ms: `^(a*)b` 1.9, `(^a*)b` 2.0, `((^a*))b` 1.9,
  `^(a*)b|^(c)` 2.2, `(^(a)|^(b))c` 0.01, `(^(.*))$` 0.8, `()^(a*)b` 2.2. `^(.*)x` 2.2 vs `(.*)x` 1878 (Cyrillic: 9.3 vs
  8195). Partly anchored `^(a*)b|(c)`: 2.55 ms, so V8 does not anchor it, but it is not quadratic either, and the per-position
  charge is conservative. Multiline `^(a*)b` with the `m` flag over 50 lines: 3.2 ms vs 0.05 without `m`, so the cost is per
  line start (non-goal confirmed). V8's `IsAnchoredAtStart` is at least as permissive as D1, so D1 never charges a
  pattern V8 does not anchor.
- Per-call overhead (`percall.mjs`, `percall.out`): about 21 ns per exec on empty or 1-character cells (20,000 rows,
  0.42 ms). `^(.*)$` charged under D2 at 4 units (empty) / 7 units (1 char): 5.2 / 3.0 ns/unit, 21 / 12 ms at 4.00e6. That is
  inside the 50 ms rule. The minimal pattern `^()` (charge 2 units) is about 10.5 ns/unit, 42 ms at 4.00e6. The unanchored
  `()` on 1-character cells is already about 84 ms "at budget" under today's model, so a per-call row cannot be
  extrapolated: reaching the budget would take millions of rows, but the frame cap is 10,000 (`draftPreviewCaps.ts:8`).
- D2 upper bound, traced by hand. Every character an attempt at index 0 consumes is in `chars`, so it is within `R0`. Each
  path pays at most `W` mandatory work and at most `R0` consumption (`A x R0`). Each give-back of the single permitted
  unfenced wide re-runs a tail of weight at most `MAX_TAIL_COST`, and `m` already includes `paths` (`m x R0`). Counted
  atoms and a wide `min` are in `W` (BY_MIN). The `$` lookarounds are constant. Lone surrogates count 2 units, as today.
  `f` is unchanged. Rule W (at most one wide with alternation) keeps this sound for alternatives. AC arithmetic checked:
  `^(.*)$`: A=1, W=3, m=2, so 1,000 x (4 + 1,500) = 1.504e6.
- Red-first: today `^(.*)$` over 1,000 x 500 costs 500 + 1,500 + 2 x 250,000 = 502,000 per cell, so it is declined and
  the AC test is genuinely red. Today `^(.*)x|y` over the same frame is also declined, so that test is a guard, made failable
  by the "partly anchored treated as anchored" mutation (A=2, W=2, m=2: 2,006 per cell = 2.0e6, OK). Checked.

### Verdict: REFUTE

### Change Requests

1. **D2 charges some anchored patterns more than today, which contradicts the ticket ("charge anchored patterns less").**
   The constant `A x (1 + W)` is charged in full even when `R0 < W`. Example: `^(a{1000})b` (A=1, W=1001, m=0) over
   10,000 rows of 10-character `a` cells. Today the charge is 10 + 10 x 10 = 110 per cell, so 1.1e6 (client-side). Under D2
   it is 1,002 + 10 = 1,012 per cell, so 1.01e7 (newly declined). Smaller-W case: `^(.{500})` over 10,000 rows of
   15-character cells is 2.4e6 today and 5.16e6 under D2. No test or calibration row covers this regression.
   Required: charge an anchored cell `min(anchored charge, today's per-position charge)`. Both are true upper bounds,
   because today's formula charges index 0 among all positions. Use `min` of the two bounds in `cellWorkBound` too. As an
   alternative, change the formula and prove it is never above today's charge. Add a Jest case, a guard labelled as such:
   an anchored large-W pattern over many short cells keeps today's decision (`{status:"ok"}`). Make it failable by the
   mutation "drop the min". Update the spec delta wording to match.
2. **D1 contradicts itself on `()^a`.** D1 says eligibility is computed on the `flatten`ed tree. `flatten`
   (`javaRegexCost.ts:41-49`) inlines the single-alternative empty group `()` to nothing, so `()^a` flattens to `^a` and
   *qualifies*. D1 lists it as not qualifying. V8 anchors it (`()^(a*)b` 2.2 ms above), so qualifying is safe. Fix the
   example list. Either state that `()^a` qualifies (V8-confirmed), or state that eligibility runs on the unflattened tree,
   not both. Add one negative eligibility case where a consuming item precedes `^`, for example `(.*)^(x)` or `(a)^b`, with
   `anchored === false`. A careless "any anchor in the sequence" implementation must fail some test, and D4 has none today.
3. **D3 "anchored forms ... with `^` prepended" does not anchor alternations.** Prepending `^` to
   `(.{16})x|(.{16})y|(.{16})z` or to the HEL-1697 64-alternative accepted-risk row gives a *partly* anchored pattern,
   which is not the shape under test. Define the anchored form as `^` before every top-level alternative. List the
   64-alternative r=8 negated-class row on two-byte excluded characters explicitly: it has the highest `A` and is the
   HEL-1697 accepted-risk outlier. The `(a?)(b?)(c?)(d?)` and `(a*)bcd` edges and the `(.{8})(.{8})x` Cyrillic risk row
   must also appear among the anchored rows.
4. **D4's over-budget example does not decline.** `^(a{1000})b` over 1,000 x 2,000 costs 1 x 1,002 + 2,000 x 1 = 3,002 per
   cell, 3.0e6, under D2 (lower still with CR1's `min`). So the "`^(a{1000})b`-shaped" test would be green for the wrong
   reason, or it gets rewritten ad hoc. Name the exact frame and its computed charge. For example, `^(.*)x` (A=1, W=2, m=1)
   over 1,000 x 2,000 `a` costs 3 + 4,000 = 4,003 per cell, 4.003e6 > 4.00e6. That frame is the one the "`R0` -> 0" mutation
   turns red. State that it is a guard, because it is declined today too.
5. **D3 per-call-overhead verdict rule.** Today's model already exceeds "50 ms at budget" for per-call rows (for example
   `()` on 1-character cells is about 84 ms extrapolated), so applying the "> 50 ms is a defect, raise the constants" rule
   to them is ill-posed. State how per-call rows are judged: measured time at the frame cap of 10,000 rows (and 20,000
   draft-node rows), not extrapolated to 4.00e6. Add the minimal-charge pattern `^()` (charge 2 units per empty cell). The
   chosen `^(.*)$` and `^(a{0,7})b` are not the worst case.

### Non-blocking notes

- The e2e anchored case is planned in task 4.4, after implementation. Running it once on the pre-change code (it should
  show a draft-preview request) and recording that output would make it red-first like the Jest test.
- An anchored `cellWork` only needs `R0`, so the exact scan could stop at the end of the first run. With CR1's `min`, the
  full scan is still needed, and the bound-first ordering keeps it rare. Either is fine; say which.
- The task 4.3 diff should use the live review base (`resolve-review-base.sh`), not a bare `main`.
