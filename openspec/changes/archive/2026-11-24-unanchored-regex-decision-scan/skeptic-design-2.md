## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD b2da43a3d02ba1b84eb8296b9bd9ed742623a353 (planning artifacts untracked in the change dir). My probes are in
`/home/matt/Development/helio/.concertino/scratch/HEL-1836/skeptic-design-2/`: probe-wide.cjs/.txt, probe-wide2.cjs/.txt
and seam.cjs/.txt. They run against main's transpiled modules in `.concertino/scratch/HEL-1836/cal-main`, with
`nice -n 19` and best of 8. The probes reuse probe-lever.cjs's D1+D2 `decide`/`fast` code unchanged and only add cases.

### What I verified (with evidence)

1. **D1: the table scan charges the same as today.** I read the code; this holds.
   - `chars = unionSets(sets)`, which goes through `normalize` (javaRegexSets.ts L10-19, javaRegexCost.ts L207). The
     ranges are sorted, merged and disjoint, so `table[c] == inRanges(chars, c)` for every BMP value, D800-DFFF included.
   - `codePointAt` returns a value above 0xFFFF only for a valid high+low pair. Every other surrogate comes back as the
     code unit itself, so D1's case split (pair / other surrogate / other) reproduces `perPositionWork`
     (regexInputCost.ts L38-59).
   - Every frame in my probes reports `same=true`: the fast charge equals `cellWork`.
2. **D2 gives the same decision as today.** This holds. The unanchored `boundAt` is
   `f(AL + L*A*min(L,W) + mL^2)` with all coefficients >= 0, so it does not decrease as `L` grows. Stage 1's `L` is always
   at least `text.length`. If the length-only sum is over budget, the stage-1 sum is too, and stage 1 would have fallen
   through to the exact scan anyway (L191-205).
   - For anchored patterns the order also cannot change a decision, because today's path already falls to the scan once
     `lengthBound` is over budget. But D2 does not say it is unanchored-only, while the Non-Goals freeze the anchored
     stage order. See CR3.
3. **D3 is a true upper bound and never looser than today.** This holds. `unitLength` (L141-152) counts lone surrogates
   the way `codePointAt` pairs them, so it equals the `len` that `perPositionWork` sums. It is also at most `2 x length`,
   which is today's `L`.
4. **D2's (b) test seam is vacuous once D3 lands, and no test catches D2 being deleted.** Reproduced; this is a defect.
   - `hasNoLoneSurrogate` captures `String.prototype.isWellFormed` when the module loads (L130-133).
   - seam.txt: I installed a counting override after loading the module and ran a frame that calls `unitLength` 1000
     times. The override recorded **0 calls**.
   - With D3, stage 1 makes no `RegExp.prototype.test` call either, because Node 22 has `isWellFormed`. So (b) passes
     whether or not D2 exists.
   - (a) counts `codePointAt` calls, (c) compares charges and decisions, and (d) checks that a frame stage 1 admits is not
     scanned. None of these fails when the D2 pre-check is removed entirely, and the mutation list does not include that
     mutation.
   - Result: the lever that takes about 5 ms off every non-member row (probe-lever.txt) has no test pinning it.
5. **D5's claim that group J is "the loosest set" is false.** Reproduced twice (probe-wide.txt, probe-wide2.txt).
   - The cost model charges f=1 for up to 8 ranges (`classFactor`, javaRegexCost.ts L138-144).
   - A negated class with 7 excluded points therefore has r=8 and f=1, and its non-members still fit 4e6 characters at the
     budget. V8 execs it slower than `[^a]` (r=2).
   - D5 lists `[^a]`, `.`, `\S` and the 64-range class (f=2, which halves the characters per unit), but no class at the
     f=1 maximum. The r=9/10 f=1.75 classes measure 11.0-11.6 ms, so f=1 with r=8 is the worst case.

   | shape (exact 4.000e6, decision false) | main decision + exec | D1+D2 decision + exec |
   |---|---|---|
   | `([^a]+)` on `a` + CJK tag, 1000 / 20000 rows | 27.8 + 11.9 / 29.5 + 12.3 (40-42 ms) | 18.6 / 19.2 ms |
   | `([^acegikm]+)` (r=8, f=1) on `a` + CJK, 1000 rows | 33.0 + 12.7 = **45.7 ms** | **19.4 ms** |
   | `([^acegikm]+)` same, 20000x199 | 33.0 + 13.1 = **46.1 ms** | **19.9 ms** (run 1: 19.8) |
   | `([^жикморт]+)` (r=8) on `ж` (two-byte throughout) | 33.2-33.3 + 11.2-11.6 | 18.0-18.4 ms |

   Two consequences:
   - The real worst row after the planned levers is about 19.9 ms, within noise of 20 ms. That is exactly the row D6's
     escalation rule depends on measuring, and group J as written would not measure it.
   - Main's worst unrecorded row is about 46 ms, not the "40-44.5 ms" that D5, task 3.2 and task 3.5 tell the owner.
6. **The 20 ms target is realistic but marginal.** On every shape probed, D1+D2 puts the decision at 6.7-6.8 ms. Exec
   (10.4-13.1 ms) dominates and none of these levers touch it, so the worst rows land at 19-20 ms. D6 already covers this:
   one rerun, then tighten the loop, then escalate with numbers. With the r=8 row added, D6 is adequate. Expect D6 to
   trigger on noise.
7. **Can the D4 tests fail first?**
   - (a) fails on main: main's stage 2 calls `codePointAt` about 4e6 times.
   - (d) catches the listed `2 x text.length` D2 mutation. On the cyr `(x)` frame at exact 2e6, the length-only sum is
     exactly 4e6, so stage 1 admits the frame. The mutated sum is 8e6, which forces a scan and its `charCodeAt` calls.
   - (c) catches the table, pair and lone-unit mutations only if the generator hits range endpoints. See the notes.
   - (b) is covered in finding 4.
8. **Scope and AC coverage.**
   - Round-1 CR1-CR5 were addressed in the text.
   - No TBDs or placeholders.
   - AC1 maps to tasks 1.1/1.2, AC2 to 3.1/3.2, AC3 to 3.3 and AC4 to 3.5.

### Verdict: REFUTE

### Change Requests

1. **design.md D5 / tasks 3.1: add the f=1 maximum-width negated class to group J.** Add an unanchored 8-range negated
   class (7 excluded points, e.g. `([^acegikm]+)`). Measure it:
   - on its non-members made two-byte by a CJK tag;
   - on a two-byte non-member body (e.g. `([^жикморт]+)` on `ж`);
   - on a one-byte control;
   - at 1,000 and 20,000 rows, with and without a lone surrogate.

   Then rewrite the "why this is the loosest set" rationale. The worst case is f = A = 1 at the **largest range count
   that still has f = 1** (r = 8, per `classFactor`), not `[^a]`. The 64-range class (f = 2) is not the loosest.
2. **design.md D5, tasks 3.2 and 3.5: correct main's unrecorded maximum.** It is about 46 ms (45.7-46.1 ms, r=8 class,
   probe-wide.txt and probe-wide2.txt), not 40-44.5 ms. Either cite the r=8 row or say "measured in calibration.md" instead
   of hard-coding the range.
3. **design.md D2: state the scope.** Say whether the length-only pre-check applies to unanchored patterns only. The
   Non-Goals freeze the anchored stage order, and as written D2 would be inserted ahead of the anchored stages as well.
4. **design.md D4 (b) and the mutation list: make the D2 test failable.**
   - Add the mutation "delete the D2 pre-check (keep D3)". It must turn a test red.
   - Give (b) a seam that the shipped stage 1 actually goes through after D3. `hasNoLoneSurrogate` captures
     `isWellFormed` at module load, so an override installed after import counts nothing (seam.txt: 0 calls).
     Acceptable fixes:
     - install the counting override before the module is loaded (`jest.isolateModules` / a dynamic import after the
       override);
     - or assert on a seam that stage 1 does call per cell.
   - Record the mutation's red run in mutations.txt like the others.

### Non-blocking notes

- D4 (c): the table mutations "exclusive range end" and "skip the first range" are caught only if a generated cell
  contains a range's endpoint, for example `` ` `` / `b` around `[^a]`, `9` for `\d`, or U+FFFF / U+10000 for the class
  straddling U+FFFF. Random ASCII/two-byte mixing may not hit those reliably. Seed the generator with each range's
  `lo-1, lo, hi, hi+1` per pattern so the mutation run is deterministic.
- D1 keeps the anchored path on `codePointAt`. That is fine and out of scope, but test (a) must not run an anchored
  pattern.
- The rows land at 19-20 ms, so D6's single rerun will probably be used. Record both runs.
