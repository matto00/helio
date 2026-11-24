## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD b895d955cf68b4c7c850ec1258deb1f348ea59b0 against the live-resolved base b2da43a3d02ba1b84eb8296b9bd9ed742623a353
(`resolve-review-base.sh`, exit 0). Spawn-cwd guard: READY.

### What I verified (with evidence)

**Scope and premise.**
- `ticket.md` restates the scope after the premise was refuted. `events.jsonl` line 2 records `escalation.answered`
  `proceed-with-restated-scope`, and line 20 records `accept-as-accepted-risk`. Both have `answer_source: human`. Line 19
  is an `answer_discarded` for the same escalation id, and line 20 then answers that id.
- The diff touches only `regexInputCost.ts`, two evaluator test files, one allowlist entry and openspec artifacts.
- `REGEX_WORK_BUDGET` is still `4_000_000` (line 13, not in the diff). No parity-corpus file is in the diff.

**Charge identity (read by hand, regexInputCost.ts:58-93).** The new `perPositionWork` reads code units.
- A non-surrogate unit is 1 unit, with membership from `table[c]`.
- A valid high/low pair is 2 units, with membership from `inRanges` on the combined code point. Main also charged a pair 2 units.
- Any other surrogate is unpaired. It is charged `LONE_SURROGATE_UNITS` and adds 1 to `extra`. Its membership is `table[c]`, which is what main's `codePointAt` returned for it.
- `bmpTable` fills `[lo, min(hi, 0xFFFF)]` for every range with `lo <= 0xFFFF`. That agrees with `inRanges` on every BMP value, surrogate values included.
- The run accumulation and the final `f*(A*(n+extra)+total)` are the same integer operations, in the same order, as main.

**True upper bound.**
- For unanchored patterns, `cellWorkBound` is now `boundAt(unitLength(text))`, and `unitLength` is the exact `len` that `perPositionWork` sums.
- Runs sum to at most `len`, and the run term is monotone, so this is a true upper bound. It is never above main's doubled bound.
- The anchored bound did not change.

**Decision identity.**
- Unanchored stage 1 returns `false` only when the bound sum is at most the budget, which is a true upper-bound sum. Otherwise the exact scan decides.
- The `lengthBound` pre-check only chooses whether stage 1 runs. It cannot change the result.
- The anchored branch is a pure restructuring of main's condition.

**Red first, reproduced on main.**
- I copied the two changed test files into a detached scratch worktree at b2da43a3d and ran `jest --maxWorkers=3` on the three regex specs.
- Result: 5 failed / 72 passed.
  - The 3 zero-`codePointAt` tests received 3,999,000, 4,000,000 and 3,999,000 reads.
  - The stage-1-skip test received 501.
  - The edited `cellWorkBound("a\ud800")` expectation received 8 where 6 was expected.
- On HEAD, the same specs plus `sessionResetGuard` give 85/85 passed.

**Mutations.** Each was run in a scratch HEAD worktree, then reverted (`diff` clean):
- S1, unanchored bound reads `text.length` instead of `unitLength`: 11 failed. A bound that understates the charge is caught.
- S3, a valid pair does not consume its low unit: 14 failed. My first attempt was syntactically invalid; I re-ran it properly.
- S4, the D2 length pre-check is removed: 1 failed. This matches the executor's M8.
- S2, `lo <= 0xffff` changed to `lo < 0xffff` (a class range that starts exactly at U+FFFF): **survived**, 77/77. See the non-blocking notes.
- The executor's recorded M1-M9 and the evaluator's M5/M8/M10/M11 are consistent with what I saw.

**Calibration, re-measured fresh on HEAD and on main.** Same script, `nice -n 19`, run serially on a quiet machine.
- Group H, change: 248 rows, 0 over 20 ms. Worst row 17.62 ms (anchored, 64 ranges). Worst unanchored row 10.75 ms. 0 DIFF/MISMATCH.
- Group H, main: 16 rows over 20 ms, worst 25.0 ms (unanchored `(x)` on cyr). The ticket's rows are fixed.
- Group H decision time: no row is slower than main by more than 1 ms.
- Group J, change, two runs: 3 rows over 20 ms in each run, max 20.65 ms. 0 DIFF/MISMATCH.
- Group J, main: 112 rows over 20 ms, max 47.11 ms.
- Group J, best of my two runs: 2 rows over 20 ms. Both appear in the accepted-risk table.
- I also ran H and J once while jest was running at the same time. That run was contaminated and over-reads; I discarded it and re-ran clean.

**Accepted-risk record is honest.** I parsed the calibration.md table against the raw evidence files.
- All 19 rows match `J-main-run1.txt`, `J-new-run2.txt` and `J-new-run3.txt` exactly for main, run 2 and run 3: decision, exec and total.
- The union of rows over 20 ms in run 2 or run 3 is exactly 19.
- No J row is slower than main by more than 3 ms.

**Groups A-I in the raw files (`*-new.txt`).**
- No timed row is over 20 ms. My first parse appeared to show some; those were group C/D extrapolation and cost columns, read on each file's own metric.
- Group D's `(.{16})x` exec-only control is 18.6 ms on the change and 19.0 ms on main.
- Group I: change 17.74 ms, main 17.81 ms.
- No A-I row moved from under 20 ms on main to over 20 ms on the change. I confirmed this freshly for H; for A-G it rests on the raw files.

**Cost no higher than main.**
- The charge (`cellWork`) is identical, so no pattern is declined more often.
- In runtime, the only regressions I measured are tiny: `(\d+)` on digits takes 0.08 ms against 0.01 ms, and 0.26 ms against 0.20 ms. The cause is that stage 1 now makes two passes (`lengthBound`, then `cellWorkBound`) when the length-only sum is under budget.

**Prod-build e2e (AC3).**
- `e2e-green-run.txt` shows 6/6 passed with longest long tasks of 0.0 ms.
- The run's throwaway-user timestamp (1795546542240) is later than the escalation answer (1795546294624), so the run happened after fa87bad26.
- `git diff fa87bad26 HEAD -- frontend backend e2e package.json` is empty, so the code under test is HEAD's. I did not re-run it.

**UI.** No view changed (evaluator logic plus a module-state allowlist entry), so there was no visual review and no servers were started.

**AC4 (PR scope note).** Not verifiable before the PR exists. calibration.md supplies the wording. The orchestrator must include it and cite `premise-validation.md`.

### Verdict: CONFIRM

### Non-blocking notes
- **Mutation S2 survives.** Changing the table-fill guard to `lo < 0xffff`, which drops a class range that starts exactly at U+FFFF, passes every test. The shipped code is correct. The (c) guard has a "straddling U+FFFF" class starting at U+FFF0 but none starting at U+FFFF. Adding `([\x{FFFF}-\x{10010}]+)` to its pattern list would close this gap.
- **Owner was told 10-18 rows; the record lists 19.** The escalation context told the owner "10-18 rows" (that is, 10 in run 2 and 18 in run 3). The record lists 19, the union of both runs. The record is the more complete number, and the owner's ruling covers the shape class. Worth one line in the PR body.
- **64 KiB table per scanned pattern, never freed.** Each distinct pattern that reaches the exact scan now keeps a 64 KiB `Uint8Array` alive for the session. `javaRegex.ts`'s `cache` is an unbounded `Map` and keeps `work.chars` alive, so the `WeakMap` entry never frees. Editing a regex keystroke by keystroke over a large frame therefore grows memory by about 64 KiB per variant. This is small but new; a bounded cache or a lazy, shared table for common classes would cap it.
- **Pairs use the lone-surrogate constant.** `regexInputCost.ts:82`, `const units = LONE_SURROGATE_UNITS;`, is also used for valid pairs (the evaluator raised the same point). It is correct only while that constant is 2.
