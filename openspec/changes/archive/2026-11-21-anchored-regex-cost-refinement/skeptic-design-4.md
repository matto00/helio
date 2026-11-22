## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` READY (branch `feature/anchored-regex-cost-refinement/HEL-1807`, HEAD
  590474dcd1122e6625d3ddc7bc387599b028b3a3). The change dir is untracked, so no code has changed yet.
- I read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-client-evaluator/spec.md, workflow-state.md
  (standing constraints C1 and C2) and skeptic-design-3.md. I also read `javaRegex.ts` `translate`/`quantifierAt`,
  `javaRegexCost.ts` (item types, `flatten`) and the `regexInputCost.ts` scan entry points (`cellWork` :31,
  `cellWorkBound` :62 with the `LONE_SURROGATE` test at :64, `workExceedsBudget` :72).

**Round 3, CR1 (decision-scan worst-case rows, and where the `L = 2 x text.length` fallback is decided): resolved.**
- D3 now lists the two-byte worst-case rows by name: `^([^x]*)x` on `ж...`+`x` at 1,000 x 2,000 and 20,000 x 100,
  `^([а-я]*)x` on `ж...`+`!!!!!!` at 20,000 x 100, and `^(\d+)` on Cyrillic and CJK prose at 1,000 x 20,000 and
  20,000 x 200. Each is timed as `workExceedsBudget` plus `exec`.
- Rows over 20 ms are recorded as accepted risk. A row over 50 ms is fixed in the scan (one pass, or the
  surrogate-free bound), never by changing the budget.
- D3 says the fallback is decided "on these two-byte rows, not the ASCII ones".
- Task 1.2 names "the two-byte worst-case rows of design D3".
- Round 3's two non-blocking notes are now in D2: reads are counted through the production path `workExceedsBudget`
  calls, the "always run the full scan" mutation edits that path, and one pass is preferred in the else branch.
- I took no new measurements. Round 3 measured these frames twice at 21-36 ms. The design now plans to re-measure
  them and has a fix rule for anything over 50 ms, so the checkable claim is in place.
- I recomputed `^(\d+)` at 1,000 x 20,000, the one size round 3 did not time:
  - The bound per cell is about 20,000, so the bound loop passes 4.00e6 after about 200 cells (about 4M characters
    surrogate-tested).
  - The exact phase then reads 1 code point per cell (`R0 = 0`, `anchoredCost = 2`).
  - That is the same order of characters read as the measured 20,000 x 200 row.

**Earlier rounds still hold in the current text:**
- R1 CR1 (`min`): the `min` is in D2's charge and bound and in the spec ("never more than the per-position charge").
  The `^(a{1000})b` guard and its "drop the min" mutation are in D4.
- R1 CR2 (eligibility): `()^a` qualifies, `(a)^b` and `(.*)^(x)` do not, and the "any anchor in the sequence"
  mutation is listed.
- R1 CR3/CR4/CR5: the anchored form puts `^` before every alternative, and the Rule N and outlier rows, the
  `^(.*)x` 4.003e6 guard and the per-call-overhead rule (judged by measured time) are all present.
- R2 (C2 scan invariant): the exact path reads only to the end of the first run unless `anchoredCost > f x A x len`.
  The scan-bound Jest test (`^(a*)b`, `c`+20,000 `a`, at most `R0+1` reads) is in D4. Mutation 4.2 covers it.

**New probes for gaps (none found):**
- Eligibility cannot be fooled by quantified or zero-width constructs. Five parser facts show this:
  - The only anchor kinds are `^` and `$`. `\b` and every `(?...)` are declined (`javaRegex.ts`, javaRegex.test.ts:49).
  - A quantifier is accepted only after an atom (`if (last !== "atom") throw`). So `(^a)?b` and `^*` cannot be
    written, and a group is never optional.
  - An empty alternative (`^a|`) has no first item, so D1 makes it non-anchored. That is correct, since V8 retries it
    at every position.
  - `(|)^a` keeps a two-empty-alternative group, so D1 makes it non-anchored. That is conservative.
  - `()^a` flattens to `^a`.
  "Non-dollar anchor" therefore means exactly `^`.
- Multiline: `RegExp(source, "u")` has no `m` flag and `(?m)` declines. The design pins this with a guard test.
- AC arithmetic is robust to the fallback choice. `^(.*)$` at 1,000 x 500 charges 1.504e6, or 3.004e6 with
  `L = 2 x len` in the bound. Both are under 4.00e6, so the red AC test does not depend on the D2 conditional.
- AC coverage: AC1 is covered by D3/calibration.md and tasks 1.1-1.3. AC2 by D4's red Jest test and `red-run.txt`
  (task 2.3). AC3 by "non-anchored path byte-identical" plus the unchanged HEL-1697 tests. The driver rules (e2e
  100 ms, parity corpus diff empty, frontend only) are covered by tasks 2.2, 4.3 and 4.4.
- Spec delta: it is consistent with D1/D2 and names the partly anchored and e2e scenarios. No API or schema contract
  is affected.

### Verdict: CONFIRM

### Non-blocking notes

- The D2 fallback rule says "if the lone-surrogate test dominates". Make it concrete when writing calibration.md, for
  example: "use `L = 2 x len` iff it lowers the maximum `workExceedsBudget + exec` time over the two-byte
  decision-scan rows". Round 3 saw it help one row (18.6 to 0.6 ms) and hurt another (10.0 to 19.5 ms), so record
  both variants' numbers, not just the winner.
- If the fallback is adopted, add the `L = 2 x len` bound to the `cellWorkBound >= cellWork` property test's anchored
  cases. Include a lone-surrogate cell so the bound stays an upper bound where the test is skipped.
