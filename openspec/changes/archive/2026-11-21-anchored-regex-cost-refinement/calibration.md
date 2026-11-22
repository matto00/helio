# HEL-1807 anchored regex cost calibration

Script: `calibrate-anchored.mjs` in this directory (run `nice -n 19 node calibrate-anchored.mjs <A|B|C|D|E|F|G|H>`, one group per
run, each under 30 s). Reference machine (Ryzen 5 7600X), node/V8, `nice -n 19`, one process at a time, best of 5 `RegExp.exec`
passes (best of 2 above 0.8 s), distinct flat cells (a 4-digit suffix per row so no result cache applies). Cost comes from the
real `compileJavaRegex(...).work` (`A W m f`) and the anchored charge of design D2; every pattern was confirmed accepted
(no row is `REJECTED`) and its `anchored` value is the last-but-one column group of each row (`Y` / `n`).

Two method points differ from HEL-1697, both to measure the budget directly instead of extrapolating:
- Rows per case = clamp(4.00e6 / the cost of one cell, 1,000, 20,000), so a long-cell case is a frame that costs about the budget.
  `ms@4e6` is `best ms x 4.00e6 / cost`.
- A case whose cost stays under 2.00e6 even at the 20,000-row cap (the draft-node cap) is a per-call-overhead case: the model can
  never charge more than that frame, so the verdict is the measured time itself, not the extrapolation (extrapolating a 0.2 ms
  frame of 20,000 cells to 4.00e6 units is ill-posed; those `ms@4e6` values of 10-27 are not measurements of a frame the model
  admits). Group F measures the decision (`workExceedsBudget`) and `exec` together on such frames.
Until `RegexWork.anchored` exists the script charges anchored rows with its reference implementation of D2 (one pass: the first
`U`-run gives `R0` and the anchored charge, returned unless the per-position charge could be lower, `min` of the two otherwise)
and uses the declared eligibility; section "Shipped-code confirmation" at the end reruns it on the shipped code.

## Verdicts

- Every row of groups A-D and F is at or under 20 ms (largest: 19.0 ms for a decision-scan row of group E, 18.5 ms for the
  unanchored HEL-1697 control `(.{16})x` on Cyrillic, 10.2 ms for the largest anchored cost row). Group G (final-gate round 1,
  below) adds the no-tail wide-class rows at the budget on uniform cells: 85 rows, at or under 19.2 ms in the final run (one row
  20.25 ms in an earlier run). Group H (final-gate round 2) adds the loosest case of the tested bound, a two-byte or astral cell
  with exactly ONE unpaired surrogate: **161 of its 248 rows are over 20 ms, worst 36.0 ms** (decision + exec, e.g.
  `^([^<64 ranges>]*)` on CJK with a trailing `\ud800`, 1,000 x 1,997), all recorded in "Accepted risk (20-50 ms)". None is
  over 50 ms: **no `anchoredCost` constant needs raising and the budget stays 4.00e6.** (Cycle 1 of this file said "no row over
  20 ms" and cycle 2 said the 21-33 ms rows no longer existed; both were false for the reasons in "What was missed".)
- D1 eligibility is confirmed by the measurements: V8 runs every eligible form in 0.8-3 ms per frame at a charge of about the
  budget (`^(.*)x`, `(^a*)b`, `()^(a*)b`, `(^(.*))$`, `^a*b|^c`, `(^(a*)|^(c))b`, `(^a|^b)c`, and the anchored form of every HEL-1697
  pattern), where the unanchored form of the same pattern costs 0.4-0.5 ns per unit of the per-position charge, e.g. `a*b` 2,055 ms at
  3.99e9 (control row, 0.515 ns/unit; HEL-1697 recorded 0.555), i.e. the unrefined model is quadratic and the anchored one linear.
  No eligible form fails to anchor, so D1 is not narrowed.
- Partly anchored patterns (`^(.*)x|y`, `^a*b|c`, `^(a*)b|(c)`) and `(a)^b`, `(.*)^(x)` keep the per-position charge (cost column
  4.95e8 / 5.03e8 / 2.52e8 on 500-character cells), as designed. (`(a)^b` is cheap in practice, 0.19 ms: V8 fails it at position 0,
  but the model cannot know that for `(.*)^(x)`, 119.7 ms measured at the per-position charge 2.52e8.)
- Multiline (JS `m` flag, measurement only, never client-reachable): `^(a*)b` over 50 lines of 40 `a`: 3.09 ms with the `m` flag, 0.05 ms
  without; the anchored charge (8.3e4) would make that 37 ns/unit, i.e. under-charged by two orders of magnitude. This is why
  multiline stays declined (`(?m)` is `unsafeRegex`) and a Jest guard pins it.
- HEL-1697 controls reproduce: `a*b` on `a...` 0.515 ns/unit (HEL-1697: 0.555), `(.{16})x` on Cyrillic 18.5 ms at 3.60e7 (4.62
  ns/unit; HEL-1697: about 5), `(a+)` on `a...` 0.19 ns/unit.

## Decision-scan rows (C2): the lone-surrogate fallback rule

`workExceedsBudget` is main-thread work too, so `workExceedsBudget` + `exec` is timed together (group E). Two bound variants were
timed on every row: **LS** = the closed-form bound with the per-cell lone-surrogate test over the whole cell (HEL-1697's `L`), and
**SF** = the surrogate-free worst case `L = 2 x text.length` (no per-cell test).

Rule (the non-blocking note of skeptic-design-4.md, made concrete): use `L = 2 x text.length` for the anchored bound
**iff it lowers the maximum `workExceedsBudget + exec` time over the two-byte decision-scan rows and no row of either variant
passes 20 ms.** Result: LS max over the two-byte rows 19.03 ms (`^([а-я]*)x` on `ж...` + `!!!!!!`, 20,000 x 100), SF max 14.19 ms;
LS max over all rows 19.03 ms, SF max 14.19 ms. SF also removes the 9.6-10.9 ms decision cost on Cyrillic/CJK/astral prose
(`^(\d+)` at 20,000 x 200: 10.56 ms LS, 0.59 ms SF) and costs at most 7.3 ms where the exact scan newly runs on one-byte cells
(`^(\d+)` on digits 1000 x 2000: 0.62 ms LS, 7.28 ms SF). **SF is adopted**: the anchored bound is
`min(f x (A x L + L x A x min(L, W) + m x L^2), f x (A x (1 + W) + L x (A + m)))` at `L = 2 x text.length`; non-anchored
patterns keep today's bound and its per-cell lone-surrogate test byte for byte. Because SF only loosens an upper bound, no decision
changes (the exact charge decides); the bound `>= cellWork` property test therefore adds an anchored case with a lone-surrogate
cell for the SF bound.

Both variants' numbers (ms, decision + exec) are in the group E table below. This rule was decided on group E rows only and was
superseded in part by final-gate round 1: the pure SF bound made the exact scan run on no-tail wide-class frames (group G, 33 ms),
so the shipped `workExceedsBudget` tests the surrogate-free bound first and the per-cell tested bound second (see below).

## Accepted risk (20-50 ms)

Owner ruling C2 of HEL-1697: a decision + exec time of 20-50 ms for one draft is accepted risk; over 50 ms blocks. None is over 50 ms.

1. **Group H, the mixed-cell rows (the staged decision's worst case).** A no-tail anchored frame at the budget whose cells are
   two-byte (Cyrillic, CJK) or astral with exactly one unpaired surrogate each (high or low, at the start or at the end) fails
   the tested bound (it doubles the whole cell), so the exact scan reads every character, at the speed of `inRanges`.
   161 of 248 rows are over 20 ms; the worst is 36.0 ms (`^([^<64 ranges>]+)`/`*` on Cyrillic or CJK + one `\ud800`/`\udc00`
   at either end, 1,000 x 1,997 and 20,000 x 97; the decision alone is about 22 ms). Per pattern (table from the group H run in
   this file; 1,000 and 20,000 rows, three cell bodies, four surrogate placements each):

| pattern | rows | rows over 20 ms | max decision + exec ms |
|---|---|---|---|
| `^([^<16 ranges>]+)` | 24 | 16 | 31.6 |
| `^([^<16 ranges>]*)` | 24 | 17 | 31.7 |
| `^([^<32 ranges>]+)` | 24 | 16 | 31.4 |
| `^([^<32 ranges>]*)` | 24 | 16 | 31.6 |
| `^([^<64 ranges>]+)` | 24 | 20 | 35.9 |
| `^([^<64 ranges>]*)` | 24 | 20 | 36.0 |
| `^(.+)` | 24 | 20 | 31.3 |
| `^(\S+)` | 24 | 16 | 25.1 |
| `^(\d+) digits+lone` | 8 | 4 | 21.1 |
| `unanchored (x)` | 24 | 16 | 25.2 |
| `unanchored (\d+)` | 24 | 0 | 10.9 |

   Unanchored `(x)` rows (the HEL-1697 path, code unchanged by this ticket, same scan on cells with one lone surrogate) reach
   25.2 ms: pre-existing behaviour of the unrefined model, recorded here because the search found it.
2. `^([^<64 ranges>]+)` on Cyrillic 1,000 x 1,998 (uniform cells, group G): 20.25 ms in one run (later runs 19.2 and 18.6).

Headroom for the PR body: the worst measured admitted anchored decision + exec is 36.0 ms against the 50 ms ruling, i.e. about
1.4x, not 2.5x. A V8 constant-factor slowdown of 1.4x on that single shape (64-range wide class, two-byte cells with one lone
surrogate, a frame exactly at the budget) reaches 50 ms. The cycle-1 rows (33 ms without a lone surrogate) are fixed by the
staged bound; the surrogate-mixed ones are not, by choice (option a of the round-2 change request: no model change; the shape
is rare, and the wall time stays under 50 ms).

## Thresholds (PR body)

Charge of an anchored cell with a first `U`-run `R0` is `f x (A x (1 + W) + R0 x (A + m))`. At 1,000 rows of `a` cells:
`^(.*)$` (`A = 1, W = 3, m = 2`: `4 + 3 x len`) is client-side up to 1,332 characters (it was declined from about 45-60);
`^(.*)x` (`3 + 2 x len`) up to 1,998; `^(a*)b` (`3 + 2 x len`) up to 1,998; `^(\d+)` on digits (`2 + len`) up to 3,998; the same patterns without the
anchor are unchanged. A cell that starts outside the pattern's characters costs the constant only (`A x (1 + W)`).

## Group A: anchored form of every HEL-1697 pattern, one-byte shapes (23 patterns x 7 shapes)

| row | A W m f anch | cells | cost (units) | best ms | ns/unit | ms@4e6 | verdict |
|---|---|---|---|---|---|---|---|
| a... / `^a*b` | 1 2 1 1 Y | 1002x2000 | 4.00e+6 | 2.28 | 0.570 | 2.3 | ok |
| 1... / `^a*b` | 1 2 1 1 Y | 20000x2000 | 6.00e+4 | 0.20 | 3.384 | 13.5 | ok |
| abcd... / `^a*b` | 1 2 1 1 Y | 20000x2000 | 1.40e+5 | 0.37 | 2.663 | 10.7 | ok |
| a..! / `^a*b` | 1 2 1 1 Y | 1002x2000 | 4.00e+6 | 2.24 | 0.559 | 2.2 | ok |
| <a... / `^a*b` | 1 2 1 1 Y | 20000x2000 | 6.00e+4 | 0.21 | 3.515 | 14.1 | ok |
| (a*999!)x2 / `^a*b` | 1 2 1 1 Y | 2000x2000 | 4.00e+6 | 1.89 | 0.473 | 1.9 | ok |
| astral / `^a*b` | 1 2 1 1 Y | 20000x2000 | 6.00e+4 | 0.25 | 4.150 | 16.6 | ok |
| a... / `^([a-z]+)-([a-z]+)` | 1 3 2 1 Y | 1000x2000 | 5.99e+6 | 2.24 | 0.374 | 1.5 | ok |
| 1... / `^([a-z]+)-([a-z]+)` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.20 | 2.482 | 9.9 | ok |
| abcd... / `^([a-z]+)-([a-z]+)` | 1 3 2 1 Y | 1000x2000 | 5.99e+6 | 2.29 | 0.383 | 1.5 | ok |
| a..! / `^([a-z]+)-([a-z]+)` | 1 3 2 1 Y | 1000x2000 | 5.99e+6 | 2.24 | 0.373 | 1.5 | ok |
| <a... / `^([a-z]+)-([a-z]+)` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.20 | 2.543 | 10.2 | ok |
| (a*999!)x2 / `^([a-z]+)-([a-z]+)` | 1 3 2 1 Y | 1333x2000 | 4.00e+6 | 1.39 | 0.349 | 1.4 | ok |
| astral / `^([a-z]+)-([a-z]+)` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.25 | 3.093 | 12.4 | ok |
| a... / `^(\d+\.\d+)` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.19 | 2.392 | 9.6 | ok |
| 1... / `^(\d+\.\d+)` | 1 3 2 1 Y | 1000x2000 | 6.00e+6 | 2.09 | 0.348 | 1.4 | ok |
| abcd... / `^(\d+\.\d+)` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.20 | 2.480 | 9.9 | ok |
| a..! / `^(\d+\.\d+)` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.20 | 2.531 | 10.1 | ok |
| <a... / `^(\d+\.\d+)` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.22 | 2.709 | 10.8 | ok |
| (a*999!)x2 / `^(\d+\.\d+)` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.20 | 2.464 | 9.9 | ok |
| astral / `^(\d+\.\d+)` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.21 | 2.568 | 10.3 | ok |
| a... / `^(a*)abcd` | 1 5 4 1 Y | 1000x2000 | 9.99e+6 | 2.02 | 0.203 | 0.8 | ok |
| 1... / `^(a*)abcd` | 1 5 4 1 Y | 20000x2000 | 1.20e+5 | 0.21 | 1.711 | 6.8 | ok |
| abcd... / `^(a*)abcd` | 1 5 4 1 Y | 1000x2000 | 9.99e+6 | 0.03 | 0.003 | 0.0 | ok |
| a..! / `^(a*)abcd` | 1 5 4 1 Y | 1000x2000 | 9.98e+6 | 2.05 | 0.205 | 0.8 | ok |
| <a... / `^(a*)abcd` | 1 5 4 1 Y | 20000x2000 | 1.20e+5 | 0.21 | 1.748 | 7.0 | ok |
| (a*999!)x2 / `^(a*)abcd` | 1 5 4 1 Y | 1000x2000 | 5.00e+6 | 1.04 | 0.207 | 0.8 | ok |
| astral / `^(a*)abcd` | 1 5 4 1 Y | 20000x2000 | 1.20e+5 | 0.30 | 2.466 | 9.9 | ok |
| a... / `^(a*)$` | 1 3 2 1 Y | 1000x2000 | 5.99e+6 | 4.20 | 0.701 | 2.8 | ok |
| 1... / `^(a*)$` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.28 | 3.465 | 13.9 | ok |
| abcd... / `^(a*)$` | 1 3 2 1 Y | 20000x2000 | 1.40e+5 | 0.34 | 2.413 | 9.7 | ok |
| a..! / `^(a*)$` | 1 3 2 1 Y | 1000x2000 | 5.99e+6 | 4.31 | 0.720 | 2.9 | ok |
| <a... / `^(a*)$` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.51 | 6.374 | 25.5 | ok |
| (a*999!)x2 / `^(a*)$` | 1 3 2 1 Y | 1333x2000 | 4.00e+6 | 2.97 | 0.743 | 3.0 | ok |
| astral / `^(a*)$` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.27 | 3.399 | 13.6 | ok |
| a... / `^<(.+?)>` | 1 3 1 1 Y | 1000x2000 | 4.00e+6 | 0.01 | 0.002 | 0.0 | ok |
| 1... / `^<(.+?)>` | 1 3 1 1 Y | 1000x2000 | 4.00e+6 | 0.01 | 0.002 | 0.0 | ok |
| abcd... / `^<(.+?)>` | 1 3 1 1 Y | 1000x2000 | 4.00e+6 | 0.01 | 0.002 | 0.0 | ok |
| a..! / `^<(.+?)>` | 1 3 1 1 Y | 1000x2000 | 4.00e+6 | 0.01 | 0.002 | 0.0 | ok |
| <a... / `^<(.+?)>` | 1 3 1 1 Y | 1000x2000 | 4.00e+6 | 1.08 | 0.270 | 1.1 | ok |
| (a*999!)x2 / `^<(.+?)>` | 1 3 1 1 Y | 1000x2000 | 4.00e+6 | 0.01 | 0.002 | 0.0 | ok |
| astral / `^<(.+?)>` | 1 3 1 1 Y | 1000x2000 | 4.00e+6 | 0.01 | 0.002 | 0.0 | ok |
| a... / `^(a+)` | 1 1 0 1 Y | 2003x2000 | 4.00e+6 | 1.71 | 0.428 | 1.7 | ok |
| 1... / `^(a+)` | 1 1 0 1 Y | 20000x2000 | 4.00e+4 | 0.27 | 6.779 | 27.1 | ok |
| abcd... / `^(a+)` | 1 1 0 1 Y | 20000x2000 | 6.00e+4 | 0.47 | 7.848 | 31.4 | ok |
| a..! / `^(a+)` | 1 1 0 1 Y | 2004x2000 | 4.00e+6 | 2.31 | 0.578 | 2.3 | ok |
| <a... / `^(a+)` | 1 1 0 1 Y | 20000x2000 | 4.00e+4 | 0.21 | 5.264 | 21.1 | ok |
| (a*999!)x2 / `^(a+)` | 1 1 0 1 Y | 3997x2000 | 4.00e+6 | 2.06 | 0.514 | 2.1 | ok |
| astral / `^(a+)` | 1 1 0 1 Y | 20000x2000 | 4.00e+4 | 0.23 | 5.738 | 23.0 | ok |
| a... / `^(a{1000})b` | 1 1001 0 1 Y | 1335x2000 | 4.00e+6 | 3.01 | 0.753 | 3.0 | ok |
| 1... / `^(a{1000})b` | 1 1001 0 1 Y | 3993x2000 | 4.00e+6 | 0.04 | 0.010 | 0.0 | ok |
| abcd... / `^(a{1000})b` | 1 1001 0 1 Y | 3985x2000 | 4.00e+6 | 0.05 | 0.012 | 0.0 | ok |
| a..! / `^(a{1000})b` | 1 1001 0 1 Y | 1335x2000 | 4.00e+6 | 3.02 | 0.754 | 3.0 | ok |
| <a... / `^(a{1000})b` | 1 1001 0 1 Y | 3993x2000 | 4.00e+6 | 0.04 | 0.010 | 0.0 | ok |
| (a*999!)x2 / `^(a{1000})b` | 1 1001 0 1 Y | 2000x2000 | 4.00e+6 | 4.48 | 1.119 | 4.5 | ok |
| astral / `^(a{1000})b` | 1 1001 0 1 Y | 3993x2000 | 4.00e+6 | 0.04 | 0.010 | 0.0 | ok |
| a... / `^(a{1000,1015})b` | 1 1016 0 1 Y | 1328x2000 | 4.00e+6 | 3.02 | 0.755 | 3.0 | ok |
| 1... / `^(a{1000,1015})b` | 1 1016 0 1 Y | 3934x2000 | 4.00e+6 | 0.04 | 0.010 | 0.0 | ok |
| abcd... / `^(a{1000,1015})b` | 1 1016 0 1 Y | 3926x2000 | 4.00e+6 | 0.05 | 0.011 | 0.0 | ok |
| a..! / `^(a{1000,1015})b` | 1 1016 0 1 Y | 1329x2000 | 4.00e+6 | 3.02 | 0.755 | 3.0 | ok |
| <a... / `^(a{1000,1015})b` | 1 1016 0 1 Y | 3934x2000 | 4.00e+6 | 0.04 | 0.010 | 0.0 | ok |
| (a*999!)x2 / `^(a{1000,1015})b` | 1 1016 0 1 Y | 1985x2000 | 4.00e+6 | 4.53 | 1.131 | 4.5 | ok |
| astral / `^(a{1000,1015})b` | 1 1016 0 1 Y | 3934x2000 | 4.00e+6 | 0.05 | 0.012 | 0.0 | ok |
| a... / `^(.{1000})x` | 1 1001 0 1 Y | 1333x2000 | 4.00e+6 | 3.03 | 0.757 | 3.0 | ok |
| 1... / `^(.{1000})x` | 1 1001 0 1 Y | 1333x2000 | 4.00e+6 | 3.03 | 0.756 | 3.0 | ok |
| abcd... / `^(.{1000})x` | 1 1001 0 1 Y | 1333x2000 | 4.00e+6 | 3.38 | 0.845 | 3.4 | ok |
| a..! / `^(.{1000})x` | 1 1001 0 1 Y | 1333x2000 | 4.00e+6 | 2.88 | 0.720 | 2.9 | ok |
| <a... / `^(.{1000})x` | 1 1001 0 1 Y | 1333x2000 | 4.00e+6 | 3.41 | 0.852 | 3.4 | ok |
| (a*999!)x2 / `^(.{1000})x` | 1 1001 0 1 Y | 1333x2000 | 4.00e+6 | 3.26 | 0.816 | 3.3 | ok |
| astral / `^(.{1000})x` | 1 1001 0 1 Y | 1333x2000 | 4.00e+6 | 8.61 | 2.151 | 8.6 | ok |
| a... / `^(\w{100})x` | 1 101 0 1 Y | 1903x2000 | 4.00e+6 | 0.48 | 0.121 | 0.5 | ok |
| 1... / `^(\w{100})x` | 1 101 0 1 Y | 1903x2000 | 4.00e+6 | 0.51 | 0.127 | 0.5 | ok |
| abcd... / `^(\w{100})x` | 1 101 0 1 Y | 1903x2000 | 4.00e+6 | 0.49 | 0.123 | 0.5 | ok |
| a..! / `^(\w{100})x` | 1 101 0 1 Y | 1908x2000 | 4.00e+6 | 0.48 | 0.120 | 0.5 | ok |
| <a... / `^(\w{100})x` | 1 101 0 1 Y | 20000x2000 | 2.04e+6 | 0.26 | 0.125 | 0.5 | ok |
| (a*999!)x2 / `^(\w{100})x` | 1 101 0 1 Y | 3634x2000 | 4.00e+6 | 0.99 | 0.247 | 1.0 | ok |
| astral / `^(\w{100})x` | 1 101 0 1 Y | 20000x2000 | 2.04e+6 | 0.30 | 0.146 | 0.6 | ok |
| a... / `^(a{1000,})` | 1 1000 0 1 Y | 1335x2000 | 4.00e+6 | 2.02 | 0.506 | 2.0 | ok |
| 1... / `^(a{1000,})` | 1 1000 0 1 Y | 3997x2000 | 4.00e+6 | 0.04 | 0.010 | 0.0 | ok |
| abcd... / `^(a{1000,})` | 1 1000 0 1 Y | 3993x2000 | 4.00e+6 | 0.04 | 0.011 | 0.0 | ok |
| a..! / `^(a{1000,})` | 1 1000 0 1 Y | 1336x2000 | 4.00e+6 | 2.02 | 0.505 | 2.0 | ok |
| <a... / `^(a{1000,})` | 1 1000 0 1 Y | 3997x2000 | 4.00e+6 | 0.04 | 0.010 | 0.0 | ok |
| (a*999!)x2 / `^(a{1000,})` | 1 1000 0 1 Y | 2000x2000 | 4.00e+6 | 3.42 | 0.855 | 3.4 | ok |
| astral / `^(a{1000,})` | 1 1000 0 1 Y | 3997x2000 | 4.00e+6 | 0.04 | 0.011 | 0.0 | ok |
| a... / `^(a{0,7})b` | 1 8 0 1 Y | 1996x2000 | 4.00e+6 | 0.05 | 0.012 | 0.0 | ok |
| 1... / `^(a{0,7})b` | 1 8 0 1 Y | 20000x2000 | 1.80e+5 | 0.21 | 1.178 | 4.7 | ok |
| abcd... / `^(a{0,7})b` | 1 8 0 1 Y | 20000x2000 | 2.20e+5 | 0.45 | 2.058 | 8.2 | ok |
| a..! / `^(a{0,7})b` | 1 8 0 1 Y | 1997x2000 | 4.00e+6 | 0.05 | 0.012 | 0.0 | ok |
| <a... / `^(a{0,7})b` | 1 8 0 1 Y | 20000x2000 | 1.80e+5 | 0.35 | 1.970 | 7.9 | ok |
| (a*999!)x2 / `^(a{0,7})b` | 1 8 0 1 Y | 3969x2000 | 4.00e+6 | 0.10 | 0.025 | 0.1 | ok |
| astral / `^(a{0,7})b` | 1 8 0 1 Y | 20000x2000 | 1.80e+5 | 0.28 | 1.530 | 6.1 | ok |
| a... / `^(\S{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.07 | 0.018 | 0.1 | ok |
| 1... / `^(\S{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.07 | 0.018 | 0.1 | ok |
| abcd... / `^(\S{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.07 | 0.018 | 0.1 | ok |
| a..! / `^(\S{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.07 | 0.018 | 0.1 | ok |
| <a... / `^(\S{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.07 | 0.018 | 0.1 | ok |
| (a*999!)x2 / `^(\S{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.07 | 0.018 | 0.1 | ok |
| astral / `^(\S{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.19 | 0.049 | 0.2 | ok |
| a... / `^(.{500})x` | 1 501 0 1 Y | 1599x2000 | 4.00e+6 | 1.81 | 0.453 | 1.8 | ok |
| 1... / `^(.{500})x` | 1 501 0 1 Y | 1599x2000 | 4.00e+6 | 2.11 | 0.527 | 2.1 | ok |
| abcd... / `^(.{500})x` | 1 501 0 1 Y | 1599x2000 | 4.00e+6 | 1.82 | 0.456 | 1.8 | ok |
| a..! / `^(.{500})x` | 1 501 0 1 Y | 1599x2000 | 4.00e+6 | 1.87 | 0.467 | 1.9 | ok |
| <a... / `^(.{500})x` | 1 501 0 1 Y | 1599x2000 | 4.00e+6 | 1.81 | 0.452 | 1.8 | ok |
| (a*999!)x2 / `^(.{500})x` | 1 501 0 1 Y | 1599x2000 | 4.00e+6 | 2.49 | 0.621 | 2.5 | ok |
| astral / `^(.{500})x` | 1 501 0 1 Y | 1599x2000 | 4.00e+6 | 5.87 | 1.468 | 5.9 | ok |
| a... / `^(a?)(b?)(c?)(d?)` | 16 4 0 1 Y | 1000x2000 | 3.20e+7 | 0.03 | 0.001 | 0.0 | ok |
| 1... / `^(a?)(b?)(c?)(d?)` | 16 4 0 1 Y | 20000x2000 | 1.60e+6 | 0.62 | 0.389 | 1.6 | ok |
| abcd... / `^(a?)(b?)(c?)(d?)` | 16 4 0 1 Y | 1000x2000 | 3.20e+7 | 0.04 | 0.001 | 0.0 | ok |
| a..! / `^(a?)(b?)(c?)(d?)` | 16 4 0 1 Y | 1000x2000 | 3.20e+7 | 0.03 | 0.001 | 0.0 | ok |
| <a... / `^(a?)(b?)(c?)(d?)` | 16 4 0 1 Y | 20000x2000 | 1.60e+6 | 0.60 | 0.373 | 1.5 | ok |
| (a*999!)x2 / `^(a?)(b?)(c?)(d?)` | 16 4 0 1 Y | 1000x2000 | 1.61e+7 | 0.03 | 0.002 | 0.0 | ok |
| astral / `^(a?)(b?)(c?)(d?)` | 16 4 0 1 Y | 20000x2000 | 1.60e+6 | 0.82 | 0.514 | 2.1 | ok |
| a... / `^(a*)bcd` | 1 4 3 1 Y | 1000x2000 | 7.99e+6 | 2.12 | 0.265 | 1.1 | ok |
| 1... / `^(a*)bcd` | 1 4 3 1 Y | 20000x2000 | 1.00e+5 | 0.21 | 2.105 | 8.4 | ok |
| abcd... / `^(a*)bcd` | 1 4 3 1 Y | 1000x2000 | 7.99e+6 | 0.03 | 0.003 | 0.0 | ok |
| a..! / `^(a*)bcd` | 1 4 3 1 Y | 1000x2000 | 7.99e+6 | 1.86 | 0.233 | 0.9 | ok |
| <a... / `^(a*)bcd` | 1 4 3 1 Y | 20000x2000 | 1.00e+5 | 0.21 | 2.101 | 8.4 | ok |
| (a*999!)x2 / `^(a*)bcd` | 1 4 3 1 Y | 1000x2000 | 4.00e+6 | 0.94 | 0.235 | 0.9 | ok |
| astral / `^(a*)bcd` | 1 4 3 1 Y | 20000x2000 | 1.00e+5 | 0.22 | 2.218 | 8.9 | ok |
| a... / `^(a*)b?c` | 1 3 2 1 Y | 1000x2000 | 5.99e+6 | 2.05 | 0.341 | 1.4 | ok |
| 1... / `^(a*)b?c` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.21 | 2.566 | 10.3 | ok |
| abcd... / `^(a*)b?c` | 1 3 2 1 Y | 20000x2000 | 2.60e+5 | 0.51 | 1.968 | 7.9 | ok |
| a..! / `^(a*)b?c` | 1 3 2 1 Y | 1000x2000 | 5.99e+6 | 2.04 | 0.341 | 1.4 | ok |
| <a... / `^(a*)b?c` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.20 | 2.523 | 10.1 | ok |
| (a*999!)x2 / `^(a*)b?c` | 1 3 2 1 Y | 1333x2000 | 4.00e+6 | 1.26 | 0.314 | 1.3 | ok |
| astral / `^(a*)b?c` | 1 3 2 1 Y | 20000x2000 | 8.00e+4 | 0.21 | 2.654 | 10.6 | ok |
| a... / `^(a?)(b?)(c?)(d?)e` | 8 5 0 1 Y | 1000x2000 | 1.60e+7 | 0.01 | 0.001 | 0.0 | ok |
| 1... / `^(a?)(b?)(c?)(d?)e` | 8 5 0 1 Y | 20000x2000 | 9.60e+5 | 0.22 | 0.234 | 0.9 | ok |
| abcd... / `^(a?)(b?)(c?)(d?)e` | 8 5 0 1 Y | 1000x2000 | 1.60e+7 | 0.02 | 0.001 | 0.0 | ok |
| a..! / `^(a?)(b?)(c?)(d?)e` | 8 5 0 1 Y | 1000x2000 | 1.60e+7 | 0.01 | 0.001 | 0.0 | ok |
| <a... / `^(a?)(b?)(c?)(d?)e` | 8 5 0 1 Y | 20000x2000 | 9.60e+5 | 0.22 | 0.225 | 0.9 | ok |
| (a*999!)x2 / `^(a?)(b?)(c?)(d?)e` | 8 5 0 1 Y | 1000x2000 | 8.04e+6 | 0.01 | 0.001 | 0.0 | ok |
| astral / `^(a?)(b?)(c?)(d?)e` | 8 5 0 1 Y | 20000x2000 | 9.60e+5 | 0.26 | 0.269 | 1.1 | ok |
| a... / `^(\d+)` | 1 1 0 1 Y | 20000x2000 | 4.00e+4 | 0.19 | 4.809 | 19.2 | ok |
| 1... / `^(\d+)` | 1 1 0 1 Y | 1999x2000 | 4.00e+6 | 1.22 | 0.304 | 1.2 | ok |
| abcd... / `^(\d+)` | 1 1 0 1 Y | 20000x2000 | 4.00e+4 | 0.21 | 5.260 | 21.0 | ok |
| a..! / `^(\d+)` | 1 1 0 1 Y | 20000x2000 | 4.00e+4 | 0.19 | 4.766 | 19.1 | ok |
| <a... / `^(\d+)` | 1 1 0 1 Y | 20000x2000 | 4.00e+4 | 0.20 | 5.025 | 20.1 | ok |
| (a*999!)x2 / `^(\d+)` | 1 1 0 1 Y | 20000x2000 | 4.00e+4 | 0.20 | 5.066 | 20.3 | ok |
| astral / `^(\d+)` | 1 1 0 1 Y | 20000x2000 | 4.00e+4 | 0.25 | 6.307 | 25.2 | ok |
| a... / `^(.{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.08 | 0.021 | 0.1 | ok |
| 1... / `^(.{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.08 | 0.021 | 0.1 | ok |
| abcd... / `^(.{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.09 | 0.024 | 0.1 | ok |
| a..! / `^(.{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.09 | 0.024 | 0.1 | ok |
| <a... / `^(.{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.09 | 0.024 | 0.1 | ok |
| (a*999!)x2 / `^(.{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.09 | 0.024 | 0.1 | ok |
| astral / `^(.{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.20 | 0.049 | 0.2 | ok |
| a... / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 2.23 | 0.558 | 2.2 | ok |
| 1... / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 2.24 | 0.559 | 2.2 | ok |
| abcd... / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 2.23 | 0.558 | 2.2 | ok |
| a..! / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 2.24 | 0.560 | 2.2 | ok |
| <a... / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 2.23 | 0.557 | 2.2 | ok |
| (a*999!)x2 / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 2.24 | 0.559 | 2.2 | ok |
| astral / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 5.65 | 1.410 | 5.6 | ok |
| a... / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.08 | 0.020 | 0.1 | ok |
| 1... / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.08 | 0.020 | 0.1 | ok |
| abcd... / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.08 | 0.020 | 0.1 | ok |
| a..! / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.08 | 0.020 | 0.1 | ok |
| <a... / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.08 | 0.020 | 0.1 | ok |
| (a*999!)x2 / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.08 | 0.020 | 0.1 | ok |
| astral / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.21 | 0.051 | 0.2 | ok |

WORST row (ms at budget, or measured ms when capped by the row count): 8.6 ms -- astral / ^(.{1000})x

## Group B: anchored forms on two-byte and lone-surrogate shapes

| row | A W m f anch | cells | cost (units) | best ms | ns/unit | ms@4e6 | verdict |
|---|---|---|---|---|---|---|---|
| cyr / `^(.{8})x` | 1 9 0 1 Y | 1991x2000 | 4.00e+6 | 0.15 | 0.036 | 0.1 | ok |
| cjk / `^(.{8})x` | 1 9 0 1 Y | 1991x2000 | 4.00e+6 | 0.08 | 0.021 | 0.1 | ok |
| emdash / `^(.{8})x` | 1 9 0 1 Y | 1991x2000 | 4.00e+6 | 0.08 | 0.020 | 0.1 | ok |
| slice / `^(.{8})x` | 1 9 0 1 Y | 1991x2000 | 4.00e+6 | 0.05 | 0.013 | 0.1 | ok |
| lonehi / `^(.{8})x` | 1 9 0 1 Y | 1000x2000 | 4.01e+6 | 0.05 | 0.013 | 0.1 | ok |
| lonelo / `^(.{8})x` | 1 9 0 1 Y | 1000x2000 | 4.01e+6 | 0.04 | 0.010 | 0.0 | ok |
| mixHa / `^(.{8})x` | 1 9 0 1 Y | 1330x2000 | 4.00e+6 | 0.06 | 0.015 | 0.1 | ok |
| mixaH / `^(.{8})x` | 1 9 0 1 Y | 1330x2000 | 4.00e+6 | 0.06 | 0.015 | 0.1 | ok |
| cyr / `^(.{12})x` | 1 13 0 1 Y | 1987x2000 | 4.00e+6 | 0.12 | 0.029 | 0.1 | ok |
| cjk / `^(.{12})x` | 1 13 0 1 Y | 1987x2000 | 4.00e+6 | 0.12 | 0.029 | 0.1 | ok |
| emdash / `^(.{12})x` | 1 13 0 1 Y | 1987x2000 | 4.00e+6 | 0.11 | 0.027 | 0.1 | ok |
| slice / `^(.{12})x` | 1 13 0 1 Y | 1987x2000 | 4.00e+6 | 0.07 | 0.018 | 0.1 | ok |
| lonehi / `^(.{12})x` | 1 13 0 1 Y | 1000x2000 | 4.01e+6 | 0.07 | 0.019 | 0.1 | ok |
| lonelo / `^(.{12})x` | 1 13 0 1 Y | 1000x2000 | 4.01e+6 | 0.10 | 0.026 | 0.1 | ok |
| mixHa / `^(.{12})x` | 1 13 0 1 Y | 1328x2000 | 4.00e+6 | 0.08 | 0.020 | 0.1 | ok |
| mixaH / `^(.{12})x` | 1 13 0 1 Y | 1328x2000 | 4.00e+6 | 0.08 | 0.020 | 0.1 | ok |
| cyr / `^(.{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.15 | 0.037 | 0.1 | ok |
| cjk / `^(.{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.15 | 0.037 | 0.1 | ok |
| emdash / `^(.{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.14 | 0.034 | 0.1 | ok |
| slice / `^(.{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.08 | 0.021 | 0.1 | ok |
| lonehi / `^(.{16})x` | 1 17 0 1 Y | 1000x2000 | 4.02e+6 | 0.10 | 0.024 | 0.1 | ok |
| lonelo / `^(.{16})x` | 1 17 0 1 Y | 1000x2000 | 4.02e+6 | 0.07 | 0.017 | 0.1 | ok |
| mixHa / `^(.{16})x` | 1 17 0 1 Y | 1326x2000 | 4.00e+6 | 0.11 | 0.026 | 0.1 | ok |
| mixaH / `^(.{16})x` | 1 17 0 1 Y | 1326x2000 | 4.00e+6 | 0.11 | 0.026 | 0.1 | ok |
| cyr / `^(\S{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.14 | 0.035 | 0.1 | ok |
| cjk / `^(\S{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.14 | 0.035 | 0.1 | ok |
| emdash / `^(\S{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.14 | 0.035 | 0.1 | ok |
| slice / `^(\S{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.07 | 0.018 | 0.1 | ok |
| lonehi / `^(\S{16})x` | 1 17 0 1 Y | 1000x2000 | 4.02e+6 | 0.09 | 0.023 | 0.1 | ok |
| lonelo / `^(\S{16})x` | 1 17 0 1 Y | 1000x2000 | 4.02e+6 | 0.07 | 0.017 | 0.1 | ok |
| mixHa / `^(\S{16})x` | 1 17 0 1 Y | 1326x2000 | 4.00e+6 | 0.10 | 0.025 | 0.1 | ok |
| mixaH / `^(\S{16})x` | 1 17 0 1 Y | 1326x2000 | 4.00e+6 | 0.10 | 0.025 | 0.1 | ok |
| cyr / `^(\D{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.14 | 0.034 | 0.1 | ok |
| cjk / `^(\D{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.14 | 0.034 | 0.1 | ok |
| emdash / `^(\D{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.14 | 0.034 | 0.1 | ok |
| slice / `^(\D{16})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.08 | 0.019 | 0.1 | ok |
| lonehi / `^(\D{16})x` | 1 17 0 1 Y | 1000x2000 | 4.02e+6 | 0.09 | 0.023 | 0.1 | ok |
| lonelo / `^(\D{16})x` | 1 17 0 1 Y | 1000x2000 | 4.02e+6 | 0.06 | 0.016 | 0.1 | ok |
| mixHa / `^(\D{16})x` | 1 17 0 1 Y | 1326x2000 | 4.00e+6 | 0.10 | 0.025 | 0.1 | ok |
| mixaH / `^(\D{16})x` | 1 17 0 1 Y | 1326x2000 | 4.00e+6 | 0.10 | 0.025 | 0.1 | ok |
| cyr / `^[^a]{16}x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.14 | 0.034 | 0.1 | ok |
| cjk / `^[^a]{16}x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.14 | 0.034 | 0.1 | ok |
| lonehi / `^[^a]{16}x` | 1 17 0 1 Y | 1000x2000 | 4.02e+6 | 0.10 | 0.024 | 0.1 | ok |
| lonelo / `^[^a]{16}x` | 1 17 0 1 Y | 1000x2000 | 4.02e+6 | 0.07 | 0.016 | 0.1 | ok |
| cyr / `^(.{100})x` | 1 101 0 1 Y | 1903x2000 | 4.00e+6 | 0.80 | 0.200 | 0.8 | ok |
| cjk / `^(.{100})x` | 1 101 0 1 Y | 1903x2000 | 4.00e+6 | 0.80 | 0.200 | 0.8 | ok |
| emdash / `^(.{100})x` | 1 101 0 1 Y | 1903x2000 | 4.00e+6 | 0.73 | 0.182 | 0.7 | ok |
| slice / `^(.{100})x` | 1 101 0 1 Y | 1903x2000 | 4.00e+6 | 0.51 | 0.127 | 0.5 | ok |
| lonehi / `^(.{100})x` | 1 101 0 1 Y | 1000x2000 | 4.10e+6 | 0.61 | 0.148 | 0.6 | ok |
| lonelo / `^(.{100})x` | 1 101 0 1 Y | 1000x2000 | 4.10e+6 | 0.39 | 0.095 | 0.4 | ok |
| mixHa / `^(.{100})x` | 1 101 0 1 Y | 1290x2000 | 4.00e+6 | 0.61 | 0.151 | 0.6 | ok |
| mixaH / `^(.{100})x` | 1 101 0 1 Y | 1290x2000 | 4.00e+6 | 0.61 | 0.152 | 0.6 | ok |
| cyr / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 8.96 | 2.239 | 9.0 | ok |
| cjk / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 8.88 | 2.217 | 8.9 | ok |
| emdash / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 8.87 | 2.217 | 8.9 | ok |
| slice / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 2.24 | 0.559 | 2.2 | ok |
| lonehi / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 8.00e+6 | 9.50 | 1.187 | 4.7 | ok |
| lonelo / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 8.00e+6 | 6.66 | 0.833 | 3.3 | ok |
| mixHa / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 6.00e+6 | 8.33 | 1.387 | 5.5 | ok |
| mixaH / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 6.00e+6 | 8.32 | 1.387 | 5.5 | ok |
| cyr / `^(.{500})x` | 1 501 0 1 Y | 1599x2000 | 4.00e+6 | 3.28 | 0.819 | 3.3 | ok |
| cjk / `^(.{500})x` | 1 501 0 1 Y | 1599x2000 | 4.00e+6 | 3.28 | 0.819 | 3.3 | ok |
| emdash / `^(.{500})x` | 1 501 0 1 Y | 1599x2000 | 4.00e+6 | 3.13 | 0.782 | 3.1 | ok |
| slice / `^(.{500})x` | 1 501 0 1 Y | 1599x2000 | 4.00e+6 | 2.10 | 0.525 | 2.1 | ok |
| lonehi / `^(.{500})x` | 1 501 0 1 Y | 1000x2000 | 4.50e+6 | 2.97 | 0.660 | 2.6 | ok |
| lonelo / `^(.{500})x` | 1 501 0 1 Y | 1000x2000 | 4.50e+6 | 2.08 | 0.463 | 1.9 | ok |
| mixHa / `^(.{500})x` | 1 501 0 1 Y | 1143x2000 | 4.00e+6 | 2.63 | 0.657 | 2.6 | ok |
| mixaH / `^(.{500})x` | 1 501 0 1 Y | 1143x2000 | 4.00e+6 | 2.63 | 0.657 | 2.6 | ok |
| cyr / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.18 | 0.045 | 0.2 | ok |
| cjk / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.18 | 0.045 | 0.2 | ok |
| emdash / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.17 | 0.042 | 0.2 | ok |
| slice / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1983x2000 | 4.00e+6 | 0.08 | 0.020 | 0.1 | ok |
| lonehi / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1000x2000 | 4.02e+6 | 0.10 | 0.025 | 0.1 | ok |
| lonelo / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1000x2000 | 4.02e+6 | 0.08 | 0.020 | 0.1 | ok |
| mixHa / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1326x2000 | 4.00e+6 | 0.12 | 0.029 | 0.1 | ok |
| mixaH / `^(.{8})(.{8})x` | 1 17 0 1 Y | 1326x2000 | 4.00e+6 | 0.12 | 0.030 | 0.1 | ok |

WORST row (ms at budget, or measured ms when capped by the row count): 9.0 ms -- cyr / ^(.*)x

## Group C: class width, short runs, alternatives, characters outside U, the 64-alternative outlier (anchor before every alternative)

| row | A W m f anch | cells | cost (units) | best ms | ns/unit | ms@4e6 | verdict |
|---|---|---|---|---|---|---|---|
| r=16 {16} a `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]{16})x` | 1 17 0 1.75 Y | 1133x2000 | 4.00e+6 | 0.06 | 0.016 | 0.1 | ok |
| r=16 {16} cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]{16})x` | 1 17 0 1.75 Y | 1133x2000 | 4.00e+6 | 0.18 | 0.046 | 0.2 | ok |
| r=16 {16} a+emdash `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]{16})x` | 1 17 0 1.75 Y | 1133x2000 | 4.00e+6 | 0.16 | 0.041 | 0.2 | ok |
| r=16 {16} short R=1 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]{16})x` | 1 17 0 1.75 Y | 20000x2000 | 6.65e+5 | 0.49 | 0.739 | 3.0 | ok |
| r=16 {16} short R=4 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]{16})x` | 1 17 0 1.75 Y | 20000x2000 | 7.70e+5 | 0.93 | 1.209 | 4.8 | ok |
| r=16 {16} short R=16 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]{16})x` | 1 17 0 1.75 Y | 20000x2000 | 1.19e+6 | 2.82 | 2.373 | 9.5 | ok |
| r=16 * a `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]*)x` | 1 2 1 1.75 Y | 1000x2000 | 7.01e+6 | 1.86 | 0.266 | 1.1 | ok |
| r=16 * cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]*)x` | 1 2 1 1.75 Y | 1000x2000 | 7.01e+6 | 16.92 | 2.415 | 9.7 | ok |
| r=16 * a+emdash `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]*)x` | 1 2 1 1.75 Y | 1000x2000 | 7.01e+6 | 17.55 | 2.505 | 10.0 | ok |
| r=16 * short R=1 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]*)x` | 1 2 1 1.75 Y | 20000x2000 | 1.75e+5 | 0.49 | 2.815 | 11.3 | ok |
| r=16 * short R=4 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]*)x` | 1 2 1 1.75 Y | 20000x2000 | 3.85e+5 | 0.93 | 2.409 | 9.6 | ok |
| r=16 * short R=16 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜ]*)x` | 1 2 1 1.75 Y | 20000x2000 | 1.23e+6 | 2.92 | 2.384 | 9.5 | ok |
| r=32 {16} a `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]{16})x` | 1 17 0 2 Y | 1000x2000 | 4.04e+6 | 0.04 | 0.009 | 0.0 | ok |
| r=32 {16} cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]{16})x` | 1 17 0 2 Y | 1000x2000 | 4.04e+6 | 0.15 | 0.037 | 0.1 | ok |
| r=32 {16} a+emdash `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]{16})x` | 1 17 0 2 Y | 1000x2000 | 4.04e+6 | 0.15 | 0.038 | 0.2 | ok |
| r=32 {16} short R=1 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]{16})x` | 1 17 0 2 Y | 20000x2000 | 7.60e+5 | 0.50 | 0.659 | 2.6 | ok |
| r=32 {16} short R=4 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]{16})x` | 1 17 0 2 Y | 20000x2000 | 8.80e+5 | 1.02 | 1.163 | 4.7 | ok |
| r=32 {16} short R=16 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]{16})x` | 1 17 0 2 Y | 20000x2000 | 1.36e+6 | 3.06 | 2.248 | 9.0 | ok |
| r=32 * a `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]*)x` | 1 2 1 2 Y | 1000x2000 | 8.01e+6 | 1.86 | 0.233 | 0.9 | ok |
| r=32 * cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]*)x` | 1 2 1 2 Y | 1000x2000 | 8.01e+6 | 18.46 | 2.306 | 9.2 | ok |
| r=32 * a+emdash `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]*)x` | 1 2 1 2 Y | 1000x2000 | 8.01e+6 | 18.95 | 2.367 | 9.5 | ok |
| r=32 * short R=1 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]*)x` | 1 2 1 2 Y | 20000x2000 | 2.00e+5 | 0.50 | 2.504 | 10.0 | ok |
| r=32 * short R=4 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]*)x` | 1 2 1 2 Y | 20000x2000 | 4.40e+5 | 1.01 | 2.287 | 9.1 | ok |
| r=32 * short R=16 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļ]*)x` | 1 2 1 2 Y | 20000x2000 | 1.40e+6 | 3.32 | 2.374 | 9.5 | ok |
| r=64 {16} a `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16})x (74 chars)` | 1 17 0 2 Y | 1000x2000 | 4.04e+6 | 0.04 | 0.009 | 0.0 | ok |
| r=64 {16} cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16})x (74 chars)` | 1 17 0 2 Y | 1000x2000 | 4.04e+6 | 0.16 | 0.040 | 0.2 | ok |
| r=64 {16} a+emdash `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16})x (74 chars)` | 1 17 0 2 Y | 1000x2000 | 4.04e+6 | 0.16 | 0.040 | 0.2 | ok |
| r=64 {16} short R=1 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16})x (74 chars)` | 1 17 0 2 Y | 20000x2000 | 7.60e+5 | 0.52 | 0.686 | 2.7 | ok |
| r=64 {16} short R=4 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16})x (74 chars)` | 1 17 0 2 Y | 20000x2000 | 8.80e+5 | 1.11 | 1.264 | 5.1 | ok |
| r=64 {16} short R=16 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16})x (74 chars)` | 1 17 0 2 Y | 20000x2000 | 1.36e+6 | 3.39 | 2.492 | 10.0 | ok |
| r=64 * a `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]*)x (71 chars)` | 1 2 1 2 Y | 1000x2000 | 8.01e+6 | 1.87 | 0.233 | 0.9 | ok |
| r=64 * cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]*)x (71 chars)` | 1 2 1 2 Y | 1000x2000 | 8.01e+6 | 18.84 | 2.354 | 9.4 | ok |
| r=64 * a+emdash `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]*)x (71 chars)` | 1 2 1 2 Y | 1000x2000 | 8.01e+6 | 19.00 | 2.373 | 9.5 | ok |
| r=64 * short R=1 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]*)x (71 chars)` | 1 2 1 2 Y | 20000x2000 | 2.00e+5 | 0.51 | 2.555 | 10.2 | ok |
| r=64 * short R=4 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]*)x (71 chars)` | 1 2 1 2 Y | 20000x2000 | 4.40e+5 | 1.05 | 2.383 | 9.5 | ok |
| r=64 * short R=16 cyr `^([^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮ...ŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]*)x (71 chars)` | 1 2 1 2 Y | 20000x2000 | 1.40e+6 | 3.29 | 2.353 | 9.4 | ok |
| 3x[^<64>]{16} R=1 `^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİ...ŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16}z (218 chars)` | 3 17 0 2 Y | 20000x2000 | 2.28e+6 | 1.21 | 0.530 | 2.1 | ok |
| 3x[^<64>]{16} R=4 `^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİ...ŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16}z (218 chars)` | 3 17 0 2 Y | 20000x2000 | 2.64e+6 | 2.87 | 1.088 | 4.4 | ok |
| 3x[^<64>]{16} R=16 `^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİ...ŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16}z (218 chars)` | 3 17 0 2 Y | 19608x2000 | 4.00e+6 | 9.22 | 2.306 | 9.2 | ok |
| 2x[^<64>]{16} R=1 `^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİ...ŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16}y (145 chars)` | 2 17 0 2 Y | 20000x2000 | 1.52e+6 | 0.89 | 0.583 | 2.3 | ok |
| 2x[^<64>]{16} R=4 `^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİ...ŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16}y (145 chars)` | 2 17 0 2 Y | 20000x2000 | 1.76e+6 | 2.01 | 1.144 | 4.6 | ok |
| 2x[^<64>]{16} R=16 `^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİ...ŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16}y (145 chars)` | 2 17 0 2 Y | 20000x2000 | 2.72e+6 | 6.90 | 2.538 | 10.2 | ok |
| 2x[^<64>]{8} R=1 `^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİ...ŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{8}y (143 chars)` | 2 9 0 2 Y | 20000x2000 | 8.80e+5 | 0.91 | 1.039 | 4.2 | ok |
| 2x[^<64>]{8} R=4 `^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİ...ŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{8}y (143 chars)` | 2 9 0 2 Y | 20000x2000 | 1.12e+6 | 1.99 | 1.779 | 7.1 | ok |
| 2x[^<64>]{8} R=16 `^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİ...ŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{8}y (143 chars)` | 2 9 0 2 Y | 20000x2000 | 2.08e+6 | 3.45 | 1.660 | 6.6 | ok |
| (.{16})x|(.{16 R=1 ж L=1000 `^(.{16})x|^(.{16})y|^(.{16})z` | 3 17 0 1 Y | 20000x1000 | 1.14e+6 | 0.71 | 0.622 | 2.5 | ok |
| (.{16})x|(.{16 R=1 ж L=2000 `^(.{16})x|^(.{16})y|^(.{16})z` | 3 17 0 1 Y | 20000x2000 | 1.14e+6 | 0.74 | 0.651 | 2.6 | ok |
| (.{16})x|(.{16 R=4 ж L=1000 `^(.{16})x|^(.{16})y|^(.{16})z` | 3 17 0 1 Y | 20000x1000 | 1.32e+6 | 1.57 | 1.189 | 4.8 | ok |
| (.{16})x|(.{16 R=4 ж L=2000 `^(.{16})x|^(.{16})y|^(.{16})z` | 3 17 0 1 Y | 20000x2000 | 1.32e+6 | 1.61 | 1.219 | 4.9 | ok |
| (.{16})x|(.{16 R=1 b L=1000 `^(.{16})x|^(.{16})y|^(.{16})z` | 3 17 0 1 Y | 20000x1000 | 1.14e+6 | 0.69 | 0.607 | 2.4 | ok |
| (.{16})x|(.{16 R=1 b L=2000 `^(.{16})x|^(.{16})y|^(.{16})z` | 3 17 0 1 Y | 20000x2000 | 1.14e+6 | 0.70 | 0.613 | 2.5 | ok |
| (.{16})x|(.{16 R=4 b L=1000 `^(.{16})x|^(.{16})y|^(.{16})z` | 3 17 0 1 Y | 20000x1000 | 1.32e+6 | 1.51 | 1.147 | 4.6 | ok |
| (.{16})x|(.{16 R=4 b L=2000 `^(.{16})x|^(.{16})y|^(.{16})z` | 3 17 0 1 Y | 20000x2000 | 1.32e+6 | 1.56 | 1.179 | 4.7 | ok |
| .{16}x|.{16}y| R=1 ж L=1000 `^.{16}x|^.{16}y|^.{16}z` | 3 17 0 1 Y | 20000x1000 | 1.14e+6 | 0.70 | 0.610 | 2.4 | ok |
| .{16}x|.{16}y| R=1 ж L=2000 `^.{16}x|^.{16}y|^.{16}z` | 3 17 0 1 Y | 20000x2000 | 1.14e+6 | 0.72 | 0.628 | 2.5 | ok |
| .{16}x|.{16}y| R=4 ж L=1000 `^.{16}x|^.{16}y|^.{16}z` | 3 17 0 1 Y | 20000x1000 | 1.32e+6 | 1.58 | 1.196 | 4.8 | ok |
| .{16}x|.{16}y| R=4 ж L=2000 `^.{16}x|^.{16}y|^.{16}z` | 3 17 0 1 Y | 20000x2000 | 1.32e+6 | 1.55 | 1.177 | 4.7 | ok |
| [^a]{16}x|[^a] R=1 ж L=1000 `^[^a]{16}x|^[^a]{16}y|^[^a]{16}z` | 3 17 0 1 Y | 20000x1000 | 1.14e+6 | 0.59 | 0.515 | 2.1 | ok |
| [^a]{16}x|[^a] R=1 ж L=2000 `^[^a]{16}x|^[^a]{16}y|^[^a]{16}z` | 3 17 0 1 Y | 20000x2000 | 1.14e+6 | 0.60 | 0.529 | 2.1 | ok |
| [^a]{16}x|[^a] R=4 ж L=1000 `^[^a]{16}x|^[^a]{16}y|^[^a]{16}z` | 3 17 0 1 Y | 20000x1000 | 1.32e+6 | 1.25 | 0.950 | 3.8 | ok |
| [^a]{16}x|[^a] R=4 ж L=2000 `^[^a]{16}x|^[^a]{16}y|^[^a]{16}z` | 3 17 0 1 Y | 20000x2000 | 1.32e+6 | 1.30 | 0.983 | 3.9 | ok |
| (\S{16})x|(\S{ R=1 ж L=1000 `^(\S{16})x|^(\S{16})y|^(\S{16})z` | 3 17 0 1 Y | 20000x1000 | 1.14e+6 | 0.67 | 0.589 | 2.4 | ok |
| (\S{16})x|(\S{ R=1 ж L=2000 `^(\S{16})x|^(\S{16})y|^(\S{16})z` | 3 17 0 1 Y | 20000x2000 | 1.14e+6 | 0.68 | 0.598 | 2.4 | ok |
| (\S{16})x|(\S{ R=4 ж L=1000 `^(\S{16})x|^(\S{16})y|^(\S{16})z` | 3 17 0 1 Y | 20000x1000 | 1.32e+6 | 1.48 | 1.122 | 4.5 | ok |
| (\S{16})x|(\S{ R=4 ж L=2000 `^(\S{16})x|^(\S{16})y|^(\S{16})z` | 3 17 0 1 Y | 20000x2000 | 1.32e+6 | 1.50 | 1.137 | 4.5 | ok |
| (\w{16})x|(\w{ R=1 b L=1000 `^(\w{16})x|^(\w{16})y|^(\w{16})z` | 3 17 0 1 Y | 20000x1000 | 1.14e+6 | 0.46 | 0.407 | 1.6 | ok |
| (\w{16})x|(\w{ R=1 b L=2000 `^(\w{16})x|^(\w{16})y|^(\w{16})z` | 3 17 0 1 Y | 20000x2000 | 1.14e+6 | 0.48 | 0.419 | 1.7 | ok |
| (\w{16})x|(\w{ R=4 b L=1000 `^(\w{16})x|^(\w{16})y|^(\w{16})z` | 3 17 0 1 Y | 20000x1000 | 1.32e+6 | 0.86 | 0.652 | 2.6 | ok |
| (\w{16})x|(\w{ R=4 b L=2000 `^(\w{16})x|^(\w{16})y|^(\w{16})z` | 3 17 0 1 Y | 20000x2000 | 1.32e+6 | 0.86 | 0.655 | 2.6 | ok |
| 16x [^<64>]{3}E all-nonU `^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİ...ŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{3}F (1151 chars)` | 16 4 0 2 Y | 20000x2000 | 3.20e+6 | 2.49 | 0.778 | 3.1 | ok |
| 16x [^<8>]{3}E all-nonU `^[^ĀĂĄĆĈĊČ]{3}0|^[^ĀĂĄĆĈĊČ]{...ĈĊČ]{3}E|^[^ĀĂĄĆĈĊČ]{3}F (255 chars)` | 16 4 0 1 Y | 20000x2000 | 1.60e+6 | 0.94 | 0.587 | 2.3 | ok |
| 16x [^a]{3}E cell a `^[^a]{3}0|^[^a]{3}1|^[^a]{3}...{3}D|^[^a]{3}E|^[^a]{3}F (159 chars)` | 16 4 0 1 Y | 20000x2000 | 1.60e+6 | 0.23 | 0.143 | 0.6 | ok |
| 16x \S{3}E cell spaces `^\S{3}0|^\S{3}1|^\S{3}2|^\S{...|^\S{3}D|^\S{3}E|^\S{3}F (127 chars)` | 16 4 0 1 Y | 20000x2000 | 1.60e+6 | 0.22 | 0.135 | 0.5 | ok |
| 32x [^<64>]E all-nonU `^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİ...ŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]V (2207 chars)` | 32 2 0 2 Y | 20000x2000 | 3.84e+6 | 1.59 | 0.414 | 1.7 | ok |
| 32x [^<8>]E all-nonU `^[^ĀĂĄĆĈĊČ]0|^[^ĀĂĄĆĈĊČ]1|^[...[^ĀĂĄĆĈĊČ]U|^[^ĀĂĄĆĈĊČ]V (415 chars)` | 32 2 0 1 Y | 20000x2000 | 1.92e+6 | 0.63 | 0.328 | 1.3 | ok |
| 8x [^a]{7}E cell a `^[^a]{7}0|^[^a]{7}1|^[^a]{7}...{7}5|^[^a]{7}6|^[^a]{7}7 (79 chars)` | 8 8 0 1 Y | 20000x2000 | 1.44e+6 | 0.44 | 0.307 | 1.2 | ok |
| 3x [^a]{16}E cell a `^[^a]{16}0|^[^a]{16}1|^[^a]{16}2` | 3 17 0 1 Y | 20000x2000 | 1.08e+6 | 0.27 | 0.248 | 1.0 | ok |
| 16x \w{3}E spaces `^\w{3}0|^\w{3}1|^\w{3}2|^\w{...|^\w{3}D|^\w{3}E|^\w{3}F (127 chars)` | 16 4 0 1 Y | 20000x2000 | 1.60e+6 | 0.22 | 0.135 | 0.5 | ok |
| 64x ([^<6 pts>k_]) two-byte excluded (accepted-risk outlier) `^([^ĀĂĄĆĈĊkα])|^([^ĀĂĄĆĈĊkβ]...ĂĄĆĈĊkϯ])|^([^ĀĂĄĆĈĊkϰ]) (959 chars)` | 64 1 0 1.75 Y | 17858x2000 | 4.00e+6 | 8.18 | 2.046 | 8.2 | ok |

WORST row (ms at budget, or measured ms when capped by the row count): 10.2 ms -- 2x[^<64>]{16} R=16 ^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļľŀłńņňŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16}x|^[^ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĸĺļľŀłńņňŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸźż]{16}y

## Group D: new anchored shapes, partly anchored, multiline, controls

| row | A W m f anch | cells | cost (units) | best ms | ns/unit | ms@4e6 | verdict |
|---|---|---|---|---|---|---|---|
| a... / `^(.*)$` | 1 3 2 1 Y | 1000x2000 | 6.00e+6 | 0.84 | 0.140 | 0.6 | ok |
| non-U / `^(.*)$` | 1 3 2 1 Y | 1000x2000 | 6.00e+6 | 0.78 | 0.130 | 0.5 | ok |
| 1... / `^(.*)$` | 1 3 2 1 Y | 1000x2000 | 6.00e+6 | 0.77 | 0.129 | 0.5 | ok |
| a... / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 2.25 | 0.561 | 2.2 | ok |
| non-U / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 2.23 | 0.558 | 2.2 | ok |
| 1... / `^(.*)x` | 1 2 1 1 Y | 1000x2000 | 4.00e+6 | 2.25 | 0.561 | 2.2 | ok |
| a... / `(^a*)b` | 1 2 1 1 Y | 1002x2000 | 4.00e+6 | 2.15 | 0.538 | 2.2 | ok |
| non-U / `(^a*)b` | 1 2 1 1 Y | 20000x2000 | 6.00e+4 | 0.21 | 3.431 | 13.7 | ok |
| 1... / `(^a*)b` | 1 2 1 1 Y | 20000x2000 | 6.00e+4 | 0.25 | 4.205 | 16.8 | ok |
| a... / `()^(a*)b` | 1 2 1 1 Y | 1002x2000 | 4.00e+6 | 2.24 | 0.559 | 2.2 | ok |
| non-U / `()^(a*)b` | 1 2 1 1 Y | 20000x2000 | 6.00e+4 | 0.22 | 3.589 | 14.4 | ok |
| 1... / `()^(a*)b` | 1 2 1 1 Y | 20000x2000 | 6.00e+4 | 0.21 | 3.504 | 14.0 | ok |
| a... / `(^(.*))$` | 1 3 2 1 Y | 1000x2000 | 6.00e+6 | 0.77 | 0.129 | 0.5 | ok |
| non-U / `(^(.*))$` | 1 3 2 1 Y | 1000x2000 | 6.00e+6 | 0.78 | 0.129 | 0.5 | ok |
| 1... / `(^(.*))$` | 1 3 2 1 Y | 1000x2000 | 6.00e+6 | 0.77 | 0.129 | 0.5 | ok |
| a... / `^a*b|^c` | 2 2 2 1 Y | 1000x2000 | 7.99e+6 | 1.86 | 0.233 | 0.9 | ok |
| non-U / `^a*b|^c` | 2 2 2 1 Y | 20000x2000 | 1.20e+5 | 0.18 | 1.539 | 6.2 | ok |
| 1... / `^a*b|^c` | 2 2 2 1 Y | 20000x2000 | 1.20e+5 | 0.19 | 1.544 | 6.2 | ok |
| a... / `(^(a*)|^(c))b` | 2 2 2 1 Y | 1000x2000 | 7.99e+6 | 2.23 | 0.279 | 1.1 | ok |
| non-U / `(^(a*)|^(c))b` | 2 2 2 1 Y | 20000x2000 | 1.20e+5 | 0.32 | 2.659 | 10.6 | ok |
| 1... / `(^(a*)|^(c))b` | 2 2 2 1 Y | 20000x2000 | 1.20e+5 | 0.21 | 1.720 | 6.9 | ok |
| a... / `(^a|^b)c` | 2 2 0 1 Y | 1001x2000 | 4.00e+6 | 0.01 | 0.002 | 0.0 | ok |
| non-U / `(^a|^b)c` | 2 2 0 1 Y | 20000x2000 | 1.20e+5 | 0.22 | 1.801 | 7.2 | ok |
| 1... / `(^a|^b)c` | 2 2 0 1 Y | 20000x2000 | 1.20e+5 | 0.20 | 1.643 | 6.6 | ok |
| a... / `^(a*)b` | 1 2 1 1 Y | 1002x2000 | 4.00e+6 | 1.86 | 0.465 | 1.9 | ok |
| non-U / `^(a*)b` | 1 2 1 1 Y | 20000x2000 | 6.00e+4 | 0.20 | 3.370 | 13.5 | ok |
| 1... / `^(a*)b` | 1 2 1 1 Y | 20000x2000 | 6.00e+4 | 0.20 | 3.367 | 13.5 | ok |
| a... / `^(\d+)` | 1 1 0 1 Y | 20000x2000 | 4.00e+4 | 0.19 | 4.788 | 19.2 | ok |
| non-U / `^(\d+)` | 1 1 0 1 Y | 20000x2000 | 4.00e+4 | 0.19 | 4.741 | 19.0 | ok |
| 1... / `^(\d+)` | 1 1 0 1 Y | 1999x2000 | 4.00e+6 | 1.21 | 0.303 | 1.2 | ok |
| AC frame 1000x500 / `^(.*)$` | 1 3 2 1 Y | 1000x500 | 1.50e+6 | 0.22 | 0.148 | 0.6 | ok |
| partly (LEN 500) a... / `^(.*)x|y` | 2 2 2 1 n | 1000x500 | 5.03e+8 | 0.67 | 0.001 | 0.0 | ok |
| partly (LEN 500) a... / `^a*b|c` | 2 2 2 1 n | 1000x500 | 4.95e+8 | 0.76 | 0.002 | 0.0 | ok |
| partly (LEN 500) a... / `^(a*)b|(c)` | 2 2 2 1 n | 1000x500 | 4.95e+8 | 0.62 | 0.001 | 0.0 | ok |
| partly (LEN 500) a... / `(a)^b` | 1 2 0 1 n | 1000x500 | 1.49e+6 | 0.19 | 0.130 | 0.5 | ok |
| partly (LEN 500) a... / `(.*)^(x)` | 1 2 1 1 n | 1000x500 | 2.52e+8 | 121.82 | 0.484 | 1.9 | ok |
| multiline m-flag lines / `^(.*)$` | 1 3 2 1 Y | 1000x2050 | 1.24e+5 | 0.04 | 0.346 | 1.4 | measurement only (m flag) |
| same, no m flag / `^(.*)$` | 1 3 2 1 Y | 1000x2050 | 1.24e+5 | 0.08 | 0.680 | 2.7 | ok |
| same, unanchored form / `(.*)$` | 1 3 2 1 n | 1000x2050 | 1.68e+8 | 82.65 | 0.492 | 2.0 | ok |
| multiline m-flag lines / `^(a*)b` | 1 2 1 1 Y | 1000x2050 | 8.30e+4 | 3.09 | 37.261 | 149.0 | measurement only (m flag) |
| same, no m flag / `^(a*)b` | 1 2 1 1 Y | 1000x2050 | 8.30e+4 | 0.05 | 0.554 | 2.2 | ok |
| same, unanchored form / `(a*)b` | 1 2 1 1 n | 1000x2050 | 8.61e+7 | 35.23 | 0.409 | 1.6 | ok |
| CONTROL a... / `a*b` | 1 2 1 1 n | 1000x2000 | 3.99e+9 | 2102.08 | 0.527 | 2.1 | ok |
| CONTROL cyr / `(.{16})x` | 1 17 0 1 n | 1000x2000 | 3.60e+7 | 166.26 | 4.618 | 18.5 | ok |
| CONTROL a... / `(a+)` | 1 1 0 1 n | 1000x2000 | 4.00e+6 | 0.76 | 0.191 | 0.8 | ok |

WORST row (ms at budget, or measured ms when capped by the row count): 18.5 ms -- CONTROL cyr / (.{16})x

## Group F: per-call overhead (decision + exec, measured time; frame cap 10,000 and draft-node cap 20,000 rows)

| row | A W m f anch | cells | cost (units) | best ms | ns/unit | ms@4e6 | verdict |
|---|---|---|---|---|---|---|---|
| 0-char cells `^()` | 1 1 0 1 Y | 10000 cells | 0.00e+0 | decision 0.12 + exec 0.22 = 0.34 | | | ok |
| 1-char cells `^()` | 1 1 0 1 Y | 10000 cells | 1.00e+4 | decision 0.11 + exec 0.19 = 0.30 | | | ok |
| 2-char cells `^()` | 1 1 0 1 Y | 10000 cells | 2.00e+4 | decision 0.12 + exec 0.18 = 0.30 | | | ok |
| 4-char cells `^()` | 1 1 0 1 Y | 10000 cells | 2.00e+4 | decision 0.11 + exec 0.18 = 0.30 | | | ok |
| 0-char cells `^(.*)$` | 1 3 2 1 Y | 10000 cells | 0.00e+0 | decision 0.12 + exec 0.21 = 0.33 | | | ok |
| 1-char cells `^(.*)$` | 1 3 2 1 Y | 10000 cells | 4.00e+4 | decision 0.12 + exec 0.21 = 0.33 | | | ok |
| 2-char cells `^(.*)$` | 1 3 2 1 Y | 10000 cells | 1.00e+5 | decision 0.11 + exec 0.21 = 0.33 | | | ok |
| 4-char cells `^(.*)$` | 1 3 2 1 Y | 10000 cells | 1.60e+5 | decision 0.11 + exec 0.22 = 0.33 | | | ok |
| 0-char cells `^(a{0,7})b` | 1 8 0 1 Y | 10000 cells | 0.00e+0 | decision 0.12 + exec 0.09 = 0.21 | | | ok |
| 1-char cells `^(a{0,7})b` | 1 8 0 1 Y | 10000 cells | 2.00e+4 | decision 0.11 + exec 0.11 = 0.22 | | | ok |
| 2-char cells `^(a{0,7})b` | 1 8 0 1 Y | 10000 cells | 6.00e+4 | decision 0.11 + exec 0.20 = 0.31 | | | ok |
| 4-char cells `^(a{0,7})b` | 1 8 0 1 Y | 10000 cells | 8.00e+4 | decision 0.11 + exec 0.22 = 0.33 | | | ok |
| 0-char cells `^()` | 1 1 0 1 Y | 20000 cells | 0.00e+0 | decision 0.24 + exec 0.37 = 0.60 | | | ok |
| 1-char cells `^()` | 1 1 0 1 Y | 20000 cells | 2.00e+4 | decision 0.23 + exec 0.37 = 0.60 | | | ok |
| 2-char cells `^()` | 1 1 0 1 Y | 20000 cells | 4.00e+4 | decision 0.22 + exec 0.37 = 0.59 | | | ok |
| 4-char cells `^()` | 1 1 0 1 Y | 20000 cells | 4.00e+4 | decision 0.23 + exec 0.37 = 0.60 | | | ok |
| 0-char cells `^(.*)$` | 1 3 2 1 Y | 20000 cells | 0.00e+0 | decision 0.24 + exec 0.42 = 0.65 | | | ok |
| 1-char cells `^(.*)$` | 1 3 2 1 Y | 20000 cells | 8.00e+4 | decision 0.23 + exec 0.43 = 0.66 | | | ok |
| 2-char cells `^(.*)$` | 1 3 2 1 Y | 20000 cells | 2.00e+5 | decision 0.23 + exec 0.43 = 0.66 | | | ok |
| 4-char cells `^(.*)$` | 1 3 2 1 Y | 20000 cells | 3.20e+5 | decision 0.23 + exec 0.44 = 0.66 | | | ok |
| 0-char cells `^(a{0,7})b` | 1 8 0 1 Y | 20000 cells | 0.00e+0 | decision 0.24 + exec 0.19 = 0.43 | | | ok |
| 1-char cells `^(a{0,7})b` | 1 8 0 1 Y | 20000 cells | 4.00e+4 | decision 0.23 + exec 0.22 = 0.45 | | | ok |
| 2-char cells `^(a{0,7})b` | 1 8 0 1 Y | 20000 cells | 1.20e+5 | decision 0.23 + exec 0.40 = 0.63 | | | ok |
| 4-char cells `^(a{0,7})b` | 1 8 0 1 Y | 20000 cells | 1.60e+5 | decision 0.23 + exec 0.44 = 0.67 | | | ok |

WORST row (ms at budget, or measured ms when capped by the row count): 0.7 ms -- 4-char cells ^(a{0,7})b

## Group E: decision-scan rows (C2), both bound variants (decision + exec ms)

| row | A W m f anch | cells | cost (units) | best ms | ns/unit | ms@4e6 | verdict |
|---|---|---|---|---|---|---|---|
| ^(a*)b on c+a* | 1 2 1 1 Y | 1000x20000 | per-cell LS test: decision 0.10 + exec 0.03 = 0.13 | surrogate-free L=2xlen: decision 0.05 + exec 0.04 = 0.09 | | | ok (best variant) |
| ^(a*)b on c+a* | 1 2 1 1 Y | 10000x2000 | per-cell LS test: decision 0.12 + exec 0.10 = 0.23 | surrogate-free L=2xlen: decision 0.12 + exec 0.10 = 0.22 | | | ok (best variant) |
| ^(a*)b on a* (exact charge just under budget) | 1 2 1 1 Y | 1000x1990 | per-cell LS test: decision 0.01 + exec 2.03 = 2.04 | surrogate-free L=2xlen: decision 6.37 + exec 1.85 = 8.22 | | | ok (best variant) |
| ^(a*)b on a* (exact charge just under budget) | 1 2 1 1 Y | 10000x199 | per-cell LS test: decision 6.84 + exec 1.89 = 8.73 | surrogate-free L=2xlen: decision 7.03 + exec 1.90 = 8.92 | | | ok (best variant) |
| ^(a*)b on a* (exact charge just under budget) | 1 2 1 1 Y | 20000x99 | per-cell LS test: decision 7.51 + exec 2.11 = 9.63 | surrogate-free L=2xlen: decision 7.34 + exec 2.30 = 9.64 | | | ok (best variant) |
| ^(.*)$ on a (exact charge just under budget) | 1 3 2 1 Y | 1000x1330 | per-cell LS test: decision 0.01 + exec 0.53 = 0.54 | surrogate-free L=2xlen: decision 4.30 + exec 0.53 = 4.83 | | | ok (best variant) |
| ^(.*)$ on a (exact charge just under budget) | 1 3 2 1 Y | 10000x133 | per-cell LS test: decision 4.73 + exec 0.00 = 4.73 (declined) | surrogate-free L=2xlen: decision 4.64 + exec 0.00 = 4.64 (declined) | | | ok (best variant) |
| ^(.*)$ on a (exact charge just under budget) | 1 3 2 1 Y | 20000x66 | per-cell LS test: decision 4.92 + exec 0.00 = 4.92 (declined) | surrogate-free L=2xlen: decision 4.75 + exec 0.00 = 4.75 (declined) | | | ok (best variant) |
| ^(\d+) on digits | 1 1 0 1 Y | 1000x1990 | per-cell LS test: decision 0.01 + exec 0.60 = 0.61 | surrogate-free L=2xlen: decision 0.00 + exec 0.60 = 0.61 | | | ok (best variant) |
| ^(\d+) on digits | 1 1 0 1 Y | 1000x2000 | per-cell LS test: decision 0.01 + exec 0.61 = 0.62 | surrogate-free L=2xlen: decision 6.68 + exec 0.61 = 7.29 | | | ok (best variant) |
| ^(\d+) on digits | 1 1 0 1 Y | 10000x199 | per-cell LS test: decision 0.11 + exec 0.82 = 0.93 | surrogate-free L=2xlen: decision 0.04 + exec 0.77 = 0.82 | | | ok (best variant) |
| ^(\d+) on prose | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 0.02 + exec 0.01 = 0.03 | surrogate-free L=2xlen: decision 0.02 + exec 0.01 = 0.03 | | | ok (best variant) |
| ^(\d+) on prose | 1 1 0 1 Y | 10000x2000 | per-cell LS test: decision 0.22 + exec 0.09 = 0.31 | surrogate-free L=2xlen: decision 0.18 + exec 0.09 = 0.28 | | | ok (best variant) |
| ^(.*)$ on a (AC) | 1 3 2 1 Y | 1000x500 | per-cell LS test: decision 0.01 + exec 0.23 = 0.24 | surrogate-free L=2xlen: decision 0.00 + exec 0.22 = 0.23 | | | ok (best variant) |
| ^(.*)$ on a (AC) | 1 3 2 1 Y | 1000x2000 | per-cell LS test: decision 4.47 + exec 0.00 = 4.47 (declined) | surrogate-free L=2xlen: decision 4.47 + exec 0.00 = 4.47 (declined) | | | ok (best variant) |
| ^(.*)$ on a (AC) | 1 3 2 1 Y | 10000x2000 | per-cell LS test: decision 4.46 + exec 0.00 = 4.46 (declined) | surrogate-free L=2xlen: decision 4.45 + exec 0.00 = 4.45 (declined) | | | ok (best variant) |
| ^([^x]*)x on cyr R0=len-5 | 1 2 1 1 Y | 1000x1990 | per-cell LS test: decision 4.85 + exec 1.32 = 6.17 | surrogate-free L=2xlen: decision 6.68 + exec 1.13 = 7.81 | | | ok (best variant) |
| ^([^x]*)x on cyr R0=len-5 | 1 2 1 1 Y | 20000x98 | per-cell LS test: decision 5.43 + exec 1.49 = 6.93 | surrogate-free L=2xlen: decision 7.12 + exec 1.48 = 8.60 | | | ok (best variant) |
| ^([а-я]*)x on cyr+!6 | 1 2 1 1 Y | 1000x2000 | per-cell LS test: decision 13.46 + exec 4.08 = 17.54 | surrogate-free L=2xlen: decision 8.65 + exec 4.09 = 12.74 | | | ok (best variant) |
| ^([а-я]*)x on cyr+!6 | 1 2 1 1 Y | 20000x100 | per-cell LS test: decision 15.11 + exec 3.94 = 19.05 | surrogate-free L=2xlen: decision 10.07 + exec 3.94 = 14.01 | | | ok (best variant) |
| ^(\d+) on Cyrillic prose | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 9.74 + exec 0.01 = 9.75 | surrogate-free L=2xlen: decision 0.02 + exec 0.01 = 0.03 | | | ok (best variant) |
| ^(\d+) on Cyrillic prose | 1 1 0 1 Y | 20000x200 | per-cell LS test: decision 10.53 + exec 0.20 = 10.73 | surrogate-free L=2xlen: decision 0.42 + exec 0.19 = 0.60 | | | ok (best variant) |
| ^(\d+) on CJK prose | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 9.75 + exec 0.01 = 9.76 | surrogate-free L=2xlen: decision 0.02 + exec 0.01 = 0.03 | | | ok (best variant) |
| ^(\d+) on CJK prose | 1 1 0 1 Y | 20000x200 | per-cell LS test: decision 10.29 + exec 0.19 = 10.47 | surrogate-free L=2xlen: decision 0.40 + exec 0.18 = 0.58 | | | ok (best variant) |
| ^(\d+) on astral | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 5.81 + exec 0.01 = 5.82 | surrogate-free L=2xlen: decision 0.04 + exec 0.01 = 0.05 | | | ok (best variant) |
| ^(\d+) on astral | 1 1 0 1 Y | 20000x200 | per-cell LS test: decision 10.74 + exec 0.18 = 10.92 | surrogate-free L=2xlen: decision 0.42 + exec 0.18 = 0.60 | | | ok (best variant) |

Max decision+exec: per-cell LS test: two-byte rows 19.05 ms, all rows 19.05 ms; surrogate-free L=2xlen: two-byte rows 14.01 ms, all rows 14.01 ms

WORST row (ms at budget, or measured ms when capped by the row count): 19.0 ms -- ^([а-я]*)x on cyr+!6 20000x100

## Shipped-code confirmation (after the implementation)

The script was rerun on the shipped modules (`RegexWork.anchored` and the shipped `cellWork` / `cellWorkBound` /
`workExceedsBudget`; no reference implementation in the charge path). Results:
- Zero `MISMATCH`: the shipped `anchored` value equals the declared eligibility on every row of groups A-F, and the cost column of every
  row of groups A, B, C, D, F is identical to the pre-implementation run above (the reference implementation is the shipped formula).
- Worst row per group: A 8.0 ms, B 9.3 ms, C 10.1 ms, D 18.5 ms (the unanchored HEL-1697 control `(.{16})x` on Cyrillic), F 0.7 ms
  (decision + exec). This confirmation was superseded by "Final-gate round 1" below: it did not contain the no-tail wide-class
  rows, which measured 21-33 ms on this code.
- Group E with the cycle-1 shipped `workExceedsBudget` (the SF bound adopted above), decision + exec: maximum 13.1 ms over the rows
  it contained (the `^([а-я]*)x` on `ж...` + `!!!!!!` row at 20,000 x 100); the table below adds that column.

### Group E on shipped code

| row | A W m f anch | cells | cost (units) | best ms | ns/unit | ms@4e6 | verdict |
|---|---|---|---|---|---|---|---|
| ^(a*)b on c+a* | 1 2 1 1 Y | 1000x20000 | per-cell LS test: decision 0.11 + exec 0.03 = 0.15 | surrogate-free L=2xlen: decision 0.05 + exec 0.02 = 0.08 | shipped workExceedsBudget: decision 0.04 + exec 0.02 = 0.06; | ok (best variant) |
| ^(a*)b on c+a* | 1 2 1 1 Y | 10000x2000 | per-cell LS test: decision 0.12 + exec 0.10 = 0.22 | surrogate-free L=2xlen: decision 0.11 + exec 0.10 = 0.21 | shipped workExceedsBudget: decision 0.25 + exec 0.10 = 0.35; | ok (best variant) |
| ^(a*)b on a* (exact charge just under budget) | 1 2 1 1 Y | 1000x1990 | per-cell LS test: decision 0.01 + exec 1.85 = 1.86 | surrogate-free L=2xlen: decision 6.38 + exec 1.85 = 8.23 | shipped workExceedsBudget: decision 6.34 + exec 1.89 = 8.24; | ok (best variant) |
| ^(a*)b on a* (exact charge just under budget) | 1 2 1 1 Y | 10000x199 | per-cell LS test: decision 6.60 + exec 1.89 = 8.49 | surrogate-free L=2xlen: decision 6.41 + exec 1.91 = 8.32 | shipped workExceedsBudget: decision 6.57 + exec 1.89 = 8.46; | ok (best variant) |
| ^(a*)b on a* (exact charge just under budget) | 1 2 1 1 Y | 20000x99 | per-cell LS test: decision 6.98 + exec 2.28 = 9.26 | surrogate-free L=2xlen: decision 6.73 + exec 1.94 = 8.67 | shipped workExceedsBudget: decision 6.87 + exec 1.94 = 8.81; | ok (best variant) |
| ^(.*)$ on a (exact charge just under budget) | 1 3 2 1 Y | 1000x1330 | per-cell LS test: decision 0.01 + exec 0.52 = 0.53 | surrogate-free L=2xlen: decision 4.24 + exec 0.52 = 4.76 | shipped workExceedsBudget: decision 4.26 + exec 0.52 = 4.78; | ok (best variant) |
| ^(.*)$ on a (exact charge just under budget) | 1 3 2 1 Y | 10000x133 | per-cell LS test: decision 4.47 + exec 0.00 = 4.47 (declined) | surrogate-free L=2xlen: decision 4.34 + exec 0.00 = 4.34 (declined) | shipped workExceedsBudget: decision 4.29 + exec 0.00 = 4.29 (declined); | ok (best variant) |
| ^(.*)$ on a (exact charge just under budget) | 1 3 2 1 Y | 20000x66 | per-cell LS test: decision 4.59 + exec 0.00 = 4.59 (declined) | surrogate-free L=2xlen: decision 4.41 + exec 0.00 = 4.41 (declined) | shipped workExceedsBudget: decision 4.34 + exec 0.00 = 4.34 (declined); | ok (best variant) |
| ^(\d+) on digits | 1 1 0 1 Y | 1000x1990 | per-cell LS test: decision 0.01 + exec 0.61 = 0.62 | surrogate-free L=2xlen: decision 0.00 + exec 0.61 = 0.61 | shipped workExceedsBudget: decision 0.00 + exec 0.61 = 0.61; | ok (best variant) |
| ^(\d+) on digits | 1 1 0 1 Y | 1000x2000 | per-cell LS test: decision 0.01 + exec 0.61 = 0.62 | surrogate-free L=2xlen: decision 6.32 + exec 0.61 = 6.93 | shipped workExceedsBudget: decision 6.33 + exec 0.61 = 6.94; | ok (best variant) |
| ^(\d+) on digits | 1 1 0 1 Y | 10000x199 | per-cell LS test: decision 0.11 + exec 0.81 = 0.92 | surrogate-free L=2xlen: decision 0.04 + exec 0.76 = 0.81 | shipped workExceedsBudget: decision 0.04 + exec 0.77 = 0.81; | ok (best variant) |
| ^(\d+) on prose | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 0.02 + exec 0.01 = 0.03 | surrogate-free L=2xlen: decision 0.02 + exec 0.01 = 0.02 | shipped workExceedsBudget: decision 0.01 + exec 0.01 = 0.02; | ok (best variant) |
| ^(\d+) on prose | 1 1 0 1 Y | 10000x2000 | per-cell LS test: decision 0.17 + exec 0.09 = 0.26 | surrogate-free L=2xlen: decision 0.15 + exec 0.09 = 0.24 | shipped workExceedsBudget: decision 0.10 + exec 0.09 = 0.19; | ok (best variant) |
| ^(.*)$ on a (AC) | 1 3 2 1 Y | 1000x500 | per-cell LS test: decision 0.01 + exec 0.22 = 0.23 | surrogate-free L=2xlen: decision 0.00 + exec 0.22 = 0.22 | shipped workExceedsBudget: decision 0.00 + exec 0.22 = 0.22; | ok (best variant) |
| ^(.*)$ on a (AC) | 1 3 2 1 Y | 1000x2000 | per-cell LS test: decision 4.25 + exec 0.00 = 4.25 (declined) | surrogate-free L=2xlen: decision 4.23 + exec 0.00 = 4.23 (declined) | shipped workExceedsBudget: decision 4.24 + exec 0.00 = 4.24 (declined); | ok (best variant) |
| ^(.*)$ on a (AC) | 1 3 2 1 Y | 10000x2000 | per-cell LS test: decision 4.23 + exec 0.00 = 4.23 (declined) | surrogate-free L=2xlen: decision 4.21 + exec 0.00 = 4.21 (declined) | shipped workExceedsBudget: decision 4.23 + exec 0.00 = 4.23 (declined); | ok (best variant) |
| ^([^x]*)x on cyr R0=len-5 | 1 2 1 1 Y | 1000x1990 | per-cell LS test: decision 4.80 + exec 1.31 = 6.11 | surrogate-free L=2xlen: decision 6.38 + exec 1.14 = 7.51 | shipped workExceedsBudget: decision 6.30 + exec 1.14 = 7.44; | ok (best variant) |
| ^([^x]*)x on cyr R0=len-5 | 1 2 1 1 Y | 20000x98 | per-cell LS test: decision 5.25 + exec 1.49 = 6.73 | surrogate-free L=2xlen: decision 6.74 + exec 1.49 = 8.23 | shipped workExceedsBudget: decision 6.48 + exec 1.47 = 7.95; | ok (best variant) |
| ^([а-я]*)x on cyr+!6 | 1 2 1 1 Y | 1000x2000 | per-cell LS test: decision 13.40 + exec 4.06 = 17.46 | surrogate-free L=2xlen: decision 8.60 + exec 4.06 = 12.66 | shipped workExceedsBudget: decision 8.55 + exec 4.09 = 12.64; | ok (best variant) |
| ^([а-я]*)x on cyr+!6 | 1 2 1 1 Y | 20000x100 | per-cell LS test: decision 14.35 + exec 3.93 = 18.28 | surrogate-free L=2xlen: decision 9.33 + exec 3.93 = 13.26 | shipped workExceedsBudget: decision 9.12 + exec 3.93 = 13.05; | ok (best variant) |
| ^(\d+) on Cyrillic prose | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 9.65 + exec 0.01 = 9.66 | surrogate-free L=2xlen: decision 0.02 + exec 0.01 = 0.03 | shipped workExceedsBudget: decision 0.01 + exec 0.01 = 0.02; | ok (best variant) |
| ^(\d+) on Cyrillic prose | 1 1 0 1 Y | 20000x200 | per-cell LS test: decision 10.29 + exec 0.19 = 10.48 | surrogate-free L=2xlen: decision 0.32 + exec 0.19 = 0.51 | shipped workExceedsBudget: decision 0.23 + exec 0.19 = 0.42; | ok (best variant) |
| ^(\d+) on CJK prose | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 9.66 + exec 0.01 = 9.68 | surrogate-free L=2xlen: decision 0.02 + exec 0.01 = 0.03 | shipped workExceedsBudget: decision 0.01 + exec 0.01 = 0.02; | ok (best variant) |
| ^(\d+) on CJK prose | 1 1 0 1 Y | 20000x200 | per-cell LS test: decision 10.15 + exec 0.18 = 10.33 | surrogate-free L=2xlen: decision 0.32 + exec 0.18 = 0.50 | shipped workExceedsBudget: decision 0.22 + exec 0.18 = 0.40; | ok (best variant) |
| ^(\d+) on astral | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 5.81 + exec 0.01 = 5.82 | surrogate-free L=2xlen: decision 0.04 + exec 0.01 = 0.05 | shipped workExceedsBudget: decision 0.01 + exec 0.01 = 0.02; | ok (best variant) |
| ^(\d+) on astral | 1 1 0 1 Y | 20000x200 | per-cell LS test: decision 10.69 + exec 0.18 = 10.88 | surrogate-free L=2xlen: decision 0.34 + exec 0.18 = 0.52 | shipped workExceedsBudget: decision 0.23 + exec 0.18 = 0.42; | ok (best variant) |

Max decision+exec: per-cell LS test: two-byte rows 18.28 ms, all rows 18.28 ms; surrogate-free L=2xlen: two-byte rows 13.26 ms, all rows 13.26 ms; shipped workExceedsBudget (SF bound): all rows 13.05 ms

WORST row (ms at budget, or measured ms when capped by the row count): 18.3 ms -- ^([а-я]*)x on cyr+!6 20000x100

## Final-gate round 1 (skeptic-final-1.md): the no-tail wide-class decision rows

### What was missed and why

The decision-scan rows of cycle 1 followed skeptic-design-3.md (two-byte rows whose first run covers almost the whole cell, with a
tail so `m > 0`) and one-byte rows at half the budget (`^(\d+)` on digits at 1,000 x 2,000 is 2.0e6, not 4.0e6). The worst
decision-scan case of the anchored model is the no-tail wide class (`m = 0`, `W = 1`: `^(\d+)`, `^(.+)`, `^([^...]+)`): the charge is
one unit per character, so a frame at the budget holds `4.00e6 / f` characters, and with the surrogate-free bound (`L = 2 x len`)
over the budget the exact scan read all of them, on two-byte cells at `inRanges` binary-search speed (up to 64 ranges), on top of an
`exec` that V8 runs slowest there. Measured on the cycle-1 code (script group G, pre-fix, same machine): `^([^<64 ranges>]+)` on
Cyrillic 1,000 x 1,998 decision 19.13 + exec 13.80 = **32.93 ms** (skeptic: 33.67), 20,000 x 98 33.02 ms, `^(.+)` on CJK 1,000 x
3,998 **25.61 ms**. Lessons for a later refinement: (1) size every decision-scan row at the budget (largest cell length whose exact
charge is at or under 4.00e6, at 1,000 and 20,000 rows) for each charge shape, not only for the shapes that exercise a new term;
(2) a staged bound must be calibrated on the inputs where EACH stage is loosest, not only on uniform shapes: for the tested bound that
is the cell with exactly one unpaired surrogate (its whole length doubles for one code unit), which round 1's group G (uniform
cells) could not contain and which round 2 (skeptic-final-2.md) found at up to 36.0 ms.

### The search for each stage's loosest input (final-gate round 2)

Before writing the verdict, each stage of the shipped decision was searched for its loosest input (script group H, shipped
`workExceedsBudget` + `exec`, best of 7, frames at the budget, 1,000 and 20,000 rows):
- **Stage 1** (surrogate-free bound `2 x len`): always 2x the exact charge on a no-tail frame (any cell without a tail), so it always
  fails near the budget and stage 2 always runs; its own cost is O(rows). Covered by group G (uniform cells, stage 2 decides).
- **Stage 2** (tested bound, one native test per cell, whole-cell doubling on one unpaired surrogate): loosest on a two-byte or
  astral cell with exactly one lone surrogate, high and low, at the start and at the end (4 placements x Cyrillic/CJK/astral x
  patterns `^([^<N ranges>]+|*)` N = 16/32/64, `^(.+)`, `^(\S+)`, `^(\d+)` + lone). Rows below: 248 rows, 161 over 20 ms, worst 36.0 ms.
- **Stage 3** (exact scan, reads the whole cell when the anchored charge exceeds `f x A x len`): loosest where one character costs
  the least charge (`m = 0`, `W = 1`, one unit per character) with the slowest per-character read (64-range class, `f = 2`, two-byte
  cells): the group G/H rows above; and cells whose first run ends before the cell with a tail (group E, `^([а-я]*)x`, 18.1 ms).
- **The unanchored path's bound** (HEL-1697: per-cell lone-surrogate test, `2 x len` bound against exact `len` for `(x)`, so the
  exact scan always runs): rows `unanchored (x)` and `unanchored (\d+)` in group H, with one lone surrogate; worst
  25.2 ms (`(x)`, 20,000 x 199). The code is unchanged by this ticket.
No frame of any stage is over 50 ms.

### Process note

Cycle 2's red output (`red-run-cycle2.txt`) was committed in the same commit as the staged-bound fix, not before it (the red run was
made on the cycle-1 code and recorded, but the commit order did not follow C12). Cycle 3 changes no code.

### Change (option b of the change request: the model, never the budget)

`workExceedsBudget` now has a staged bound for an anchored pattern: (1) the surrogate-free bound, as before; (2) only if that is over
the budget, the tested bound (`L` = UTF-16 length, doubled only for a cell with an unpaired surrogate, the HEL-1697 test, closed
form with the same `min`); (3) only if that is also over the budget, the exact scan. For a no-tail frame whose first run covers
the cell and whose cells contain NO unpaired surrogate, stage 2 equals the exact charge, so such frames at the budget are decided
by stage 2 and never scanned. A cell with ONE unpaired surrogate doubles its whole stage-2 length, fails stage 2 and is scanned
(group H, up to 36.0 ms). Non-anchored patterns
are unchanged byte for byte. No decision changes: the stages are upper bounds, the exact charge still decides. C1 holds
(the charge is untouched). C2: the scan still reads at most about its charge; the new cost is one native lone-surrogate test per
cell, only on frames whose surrogate-free bound is over the budget (about 0.5 ns per character).

(Superseded in part by round 2: that sentence is true only for cells without an unpaired surrogate.) The lone-surrogate rule above stays correct for what it decided (two-byte prose rows keep the 0.5 ms of the SF bound); it was
decided on rows that had no no-tail frames at the budget. Rows that need stage 3 (a tail, `R0 < len`) are as before (group E).

### Group G (script group G; the shipped `workExceedsBudget` + `exec` timed together, best of 7)

Patterns: `^([^<N ranges>]+)` and `*` for N = 16/32/64, `^(.+)`, `^(\S+)`, `^(\d+)` and a positive 63-range class `^([...]+)`; cells
Cyrillic, CJK, astral, lone-surrogate and one-byte (digits for `\d`, the class's own characters for the positive class). Every
frame is the longest cell length whose exact charge is at or under 4.00e6 (all admitted, none declined), at 1,000 and 20,000 rows;
the last character of each even-numbered cell differs so cells are distinct. `^(\d+)` on digits in group E is resized to 3,998 and
197 characters.

| row | A W m f anch | cells | cost (units) | best ms | ns/unit | ms@4e6 | verdict |
|---|---|---|---|---|---|---|---|
| ^([^<16 ranges>]+) on cyr | 1 1 0 1.75 Y | 1000x2283 | 3.999e+6 | decision 5.52 + exec 11.04 = 16.56 | | | ok |
| ^([^<16 ranges>]+) on cyr | 1 1 0 1.75 Y | 20000x112 | 3.990e+6 | decision 5.98 + exec 11.27 = 17.25 | | | ok |
| ^([^<16 ranges>]+) on cjk | 1 1 0 1.75 Y | 1000x2283 | 3.999e+6 | decision 5.50 + exec 10.99 = 16.49 | | | ok |
| ^([^<16 ranges>]+) on cjk | 1 1 0 1.75 Y | 20000x112 | 3.990e+6 | decision 5.82 + exec 11.31 = 17.14 | | | ok |
| ^([^<16 ranges>]+) on astral | 1 1 0 1.75 Y | 1000x1141 | 3.996e+6 | decision 7.54 + exec 5.79 = 13.33 | | | ok |
| ^([^<16 ranges>]+) on astral | 1 1 0 1.75 Y | 20000x56 | 3.973e+6 | decision 7.83 + exec 6.20 = 14.02 | | | ok |
| ^([^<16 ranges>]+) on lone | 1 1 0 1.75 Y | 1000x1141 | 3.996e+6 | decision 0.01 + exec 5.12 = 5.13 | | | ok |
| ^([^<16 ranges>]+) on lone | 1 1 0 1.75 Y | 20000x56 | 3.973e+6 | decision 0.15 + exec 5.53 = 5.68 | | | ok |
| ^([^<16 ranges>]+) on one-byte | 1 1 0 1.75 Y | 1000x2283 | 3.999e+6 | decision 0.02 + exec 0.86 = 0.88 | | | ok |
| ^([^<16 ranges>]+) on one-byte | 1 1 0 1.75 Y | 20000x112 | 3.990e+6 | decision 0.34 + exec 1.16 = 1.51 | | | ok |
| ^([^<16 ranges>]*) on cyr | 1 1 0 1.75 Y | 1000x2283 | 3.999e+6 | decision 5.50 + exec 11.22 = 16.72 | | | ok |
| ^([^<16 ranges>]*) on cyr | 1 1 0 1.75 Y | 20000x112 | 3.990e+6 | decision 5.82 + exec 11.52 = 17.34 | | | ok |
| ^([^<16 ranges>]*) on cjk | 1 1 0 1.75 Y | 1000x2283 | 3.999e+6 | decision 5.50 + exec 11.23 = 16.73 | | | ok |
| ^([^<16 ranges>]*) on cjk | 1 1 0 1.75 Y | 20000x112 | 3.990e+6 | decision 5.82 + exec 11.53 = 17.35 | | | ok |
| ^([^<16 ranges>]*) on astral | 1 1 0 1.75 Y | 1000x1141 | 3.996e+6 | decision 7.51 + exec 6.02 = 13.53 | | | ok |
| ^([^<16 ranges>]*) on astral | 1 1 0 1.75 Y | 20000x56 | 3.973e+6 | decision 7.82 + exec 6.37 = 14.20 | | | ok |
| ^([^<16 ranges>]*) on lone | 1 1 0 1.75 Y | 1000x1141 | 3.996e+6 | decision 0.01 + exec 5.24 = 5.25 | | | ok |
| ^([^<16 ranges>]*) on lone | 1 1 0 1.75 Y | 20000x56 | 3.973e+6 | decision 0.14 + exec 5.65 = 5.79 | | | ok |
| ^([^<16 ranges>]*) on one-byte | 1 1 0 1.75 Y | 1000x2283 | 3.999e+6 | decision 0.02 + exec 0.45 = 0.46 | | | ok |
| ^([^<16 ranges>]*) on one-byte | 1 1 0 1.75 Y | 20000x112 | 3.990e+6 | decision 0.34 + exec 0.77 = 1.12 | | | ok |
| ^([^<32 ranges>]+) on cyr | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 4.82 + exec 11.33 = 16.15 | | | ok |
| ^([^<32 ranges>]+) on cyr | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 5.14 + exec 11.61 = 16.75 | | | ok |
| ^([^<32 ranges>]+) on cjk | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 4.82 + exec 11.34 = 16.15 | | | ok |
| ^([^<32 ranges>]+) on cjk | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 5.14 + exec 11.63 = 16.77 | | | ok |
| ^([^<32 ranges>]+) on astral | 1 1 0 2 Y | 1000x999 | 3.999e+6 | decision 6.58 + exec 5.99 = 12.58 | | | ok |
| ^([^<32 ranges>]+) on astral | 1 1 0 2 Y | 20000x49 | 3.980e+6 | decision 6.90 + exec 6.34 = 13.24 | | | ok |
| ^([^<32 ranges>]+) on lone | 1 1 0 2 Y | 1000x999 | 3.999e+6 | decision 0.01 + exec 5.25 = 5.26 | | | ok |
| ^([^<32 ranges>]+) on lone | 1 1 0 2 Y | 20000x49 | 3.980e+6 | decision 0.14 + exec 5.64 = 5.78 | | | ok |
| ^([^<32 ranges>]+) on one-byte | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 0.02 + exec 0.76 = 0.77 | | | ok |
| ^([^<32 ranges>]+) on one-byte | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 0.34 + exec 1.07 = 1.40 | | | ok |
| ^([^<32 ranges>]*) on cyr | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 4.81 + exec 11.46 = 16.27 | | | ok |
| ^([^<32 ranges>]*) on cyr | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 5.14 + exec 11.72 = 16.87 | | | ok |
| ^([^<32 ranges>]*) on cjk | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 4.82 + exec 11.40 = 16.21 | | | ok |
| ^([^<32 ranges>]*) on cjk | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 5.15 + exec 11.72 = 16.87 | | | ok |
| ^([^<32 ranges>]*) on astral | 1 1 0 2 Y | 1000x999 | 3.999e+6 | decision 6.58 + exec 6.08 = 12.66 | | | ok |
| ^([^<32 ranges>]*) on astral | 1 1 0 2 Y | 20000x49 | 3.980e+6 | decision 6.89 + exec 6.46 = 13.35 | | | ok |
| ^([^<32 ranges>]*) on lone | 1 1 0 2 Y | 1000x999 | 3.999e+6 | decision 0.01 + exec 5.35 = 5.36 | | | ok |
| ^([^<32 ranges>]*) on lone | 1 1 0 2 Y | 20000x49 | 3.980e+6 | decision 0.14 + exec 5.79 = 5.92 | | | ok |
| ^([^<32 ranges>]*) on one-byte | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 0.02 + exec 0.39 = 0.41 | | | ok |
| ^([^<32 ranges>]*) on one-byte | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 0.33 + exec 0.71 = 1.05 | | | ok |
| ^([^<64 ranges>]+) on cyr | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 4.82 + exec 13.80 = 18.61 | | | ok |
| ^([^<64 ranges>]+) on cyr | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 5.15 + exec 13.99 = 19.13 | | | ok |
| ^([^<64 ranges>]+) on cjk | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 4.82 + exec 13.80 = 18.61 | | | ok |
| ^([^<64 ranges>]+) on cjk | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 5.15 + exec 13.98 = 19.13 | | | ok |
| ^([^<64 ranges>]+) on astral | 1 1 0 2 Y | 1000x999 | 3.999e+6 | decision 6.59 + exec 7.18 = 13.77 | | | ok |
| ^([^<64 ranges>]+) on astral | 1 1 0 2 Y | 20000x49 | 3.980e+6 | decision 6.88 + exec 7.50 = 14.39 | | | ok |
| ^([^<64 ranges>]+) on lone | 1 1 0 2 Y | 1000x999 | 3.999e+6 | decision 0.01 + exec 6.25 = 6.26 | | | ok |
| ^([^<64 ranges>]+) on lone | 1 1 0 2 Y | 20000x49 | 3.980e+6 | decision 0.14 + exec 6.65 = 6.79 | | | ok |
| ^([^<64 ranges>]+) on one-byte | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 0.02 + exec 0.76 = 0.77 | | | ok |
| ^([^<64 ranges>]+) on one-byte | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 0.34 + exec 1.12 = 1.45 | | | ok |
| ^([^<64 ranges>]*) on cyr | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 4.82 + exec 13.73 = 18.55 | | | ok |
| ^([^<64 ranges>]*) on cyr | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 5.14 + exec 13.89 = 19.03 | | | ok |
| ^([^<64 ranges>]*) on cjk | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 4.81 + exec 13.73 = 18.54 | | | ok |
| ^([^<64 ranges>]*) on cjk | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 5.14 + exec 13.91 = 19.05 | | | ok |
| ^([^<64 ranges>]*) on astral | 1 1 0 2 Y | 1000x999 | 3.999e+6 | decision 6.58 + exec 7.13 = 13.71 | | | ok |
| ^([^<64 ranges>]*) on astral | 1 1 0 2 Y | 20000x49 | 3.980e+6 | decision 6.90 + exec 7.58 = 14.49 | | | ok |
| ^([^<64 ranges>]*) on lone | 1 1 0 2 Y | 1000x999 | 3.999e+6 | decision 0.01 + exec 6.36 = 6.37 | | | ok |
| ^([^<64 ranges>]*) on lone | 1 1 0 2 Y | 20000x49 | 3.980e+6 | decision 0.14 + exec 6.78 = 6.92 | | | ok |
| ^([^<64 ranges>]*) on one-byte | 1 1 0 2 Y | 1000x1998 | 4.000e+6 | decision 0.02 + exec 0.39 = 0.41 | | | ok |
| ^([^<64 ranges>]*) on one-byte | 1 1 0 2 Y | 20000x98 | 4.000e+6 | decision 0.34 + exec 0.72 = 1.05 | | | ok |
| ^(.+) on cyr | 1 1 0 1 Y | 1000x3998 | 4.000e+6 | decision 9.61 + exec 4.51 = 14.12 | | | ok |
| ^(.+) on cyr | 1 1 0 1 Y | 20000x198 | 4.000e+6 | decision 9.95 + exec 4.85 = 14.81 | | | ok |
| ^(.+) on cjk | 1 1 0 1 Y | 1000x3998 | 4.000e+6 | decision 9.62 + exec 4.46 = 14.08 | | | ok |
| ^(.+) on cjk | 1 1 0 1 Y | 20000x198 | 4.000e+6 | decision 9.95 + exec 4.87 = 14.82 | | | ok |
| ^(.+) on astral | 1 1 0 1 Y | 1000x1999 | 4.000e+6 | decision 13.15 + exec 2.25 = 15.40 | | | ok |
| ^(.+) on astral | 1 1 0 1 Y | 20000x99 | 3.990e+6 | decision 13.46 + exec 3.01 = 16.47 | | | ok |
| ^(.+) on lone | 1 1 0 1 Y | 1000x1999 | 4.000e+6 | decision 0.01 + exec 4.08 = 4.09 | | | ok |
| ^(.+) on lone | 1 1 0 1 Y | 20000x99 | 3.990e+6 | decision 0.14 + exec 4.48 = 4.61 | | | ok |
| ^(.+) on one-byte | 1 1 0 1 Y | 1000x3998 | 4.000e+6 | decision 0.02 + exec 1.51 = 1.53 | | | ok |
| ^(.+) on one-byte | 1 1 0 1 Y | 20000x198 | 4.000e+6 | decision 0.34 + exec 1.82 = 2.16 | | | ok |
| ^(\S+) on cyr | 1 1 0 1 Y | 1000x3998 | 4.000e+6 | decision 9.61 + exec 2.99 = 12.60 | | | ok |
| ^(\S+) on cyr | 1 1 0 1 Y | 20000x198 | 4.000e+6 | decision 9.98 + exec 3.32 = 13.29 | | | ok |
| ^(\S+) on cjk | 1 1 0 1 Y | 1000x3998 | 4.000e+6 | decision 9.61 + exec 2.99 = 12.60 | | | ok |
| ^(\S+) on cjk | 1 1 0 1 Y | 20000x198 | 4.000e+6 | decision 9.95 + exec 3.32 = 13.26 | | | ok |
| ^(\S+) on astral | 1 1 0 1 Y | 1000x1999 | 4.000e+6 | decision 13.16 + exec 2.25 = 15.41 | | | ok |
| ^(\S+) on astral | 1 1 0 1 Y | 20000x99 | 3.990e+6 | decision 13.46 + exec 2.61 = 16.07 | | | ok |
| ^(\S+) on lone | 1 1 0 1 Y | 1000x1999 | 4.000e+6 | decision 0.01 + exec 3.35 = 3.36 | | | ok |
| ^(\S+) on lone | 1 1 0 1 Y | 20000x99 | 3.990e+6 | decision 0.14 + exec 3.76 = 3.91 | | | ok |
| ^(\S+) on one-byte | 1 1 0 1 Y | 1000x3998 | 4.000e+6 | decision 0.02 + exec 1.50 = 1.52 | | | ok |
| ^(\S+) on one-byte | 1 1 0 1 Y | 20000x198 | 4.000e+6 | decision 0.34 + exec 1.83 = 2.16 | | | ok |
| ^(\d+) on one-byte | 1 1 0 1 Y | 1000x3998 | 4.000e+6 | decision 0.02 + exec 1.50 = 1.52 | | | ok |
| ^(\d+) on one-byte | 1 1 0 1 Y | 20000x198 | 3.990e+6 | decision 0.34 + exec 1.82 = 2.16 | | | ok |
| ^([<63 ranges>]+) positive on cyr | 1 1 0 2 Y | 1000x1998 | 3.999e+6 | decision 4.81 + exec 10.85 = 15.67 | | | ok |
| ^([<63 ranges>]+) positive on cyr | 1 1 0 2 Y | 20000x98 | 3.980e+6 | decision 5.14 + exec 11.02 = 16.17 | | | ok |

WORST row (ms at budget, or measured ms when capped by the row count): 19.1 ms -- ^([^<64 ranges>]+) cjk 20000x98


### Groups A-F rerun on the shipped final code (staged bound)

Worst row per group: A 7.7 ms, B 9.2 ms, C 10.0 ms, D 18.5 ms (unanchored control), E 18.1 ms (shipped `workExceedsBudget`; the
`^([а-я]*)x` on `ж...` + `!!!!!!` rows, stage 3), F 0.7 ms, G 19.1-20.25 ms (above). Zero `MISMATCH`, `REJECTED` or `DEFECT`.
Group E on the final shipped code:

| row | A W m f anch | cells | cost (units) | best ms | ns/unit | ms@4e6 | verdict |
|---|---|---|---|---|---|---|---|
| ^(a*)b on c+a* | 1 2 1 1 Y | 1000x20000 | per-cell LS test: decision 0.12 + exec 0.03 = 0.15 | surrogate-free L=2xlen: decision 0.04 + exec 0.02 = 0.06 | shipped workExceedsBudget: decision 0.03 + exec 0.02 = 0.06; | ok (best variant) |
| ^(a*)b on c+a* | 1 2 1 1 Y | 10000x2000 | per-cell LS test: decision 0.11 + exec 0.10 = 0.22 | surrogate-free L=2xlen: decision 0.11 + exec 0.10 = 0.21 | shipped workExceedsBudget: decision 0.26 + exec 0.10 = 0.37; | ok (best variant) |
| ^(a*)b on a* (exact charge just under budget) | 1 2 1 1 Y | 1000x1990 | per-cell LS test: decision 0.01 + exec 1.96 = 1.97 | surrogate-free L=2xlen: decision 6.32 + exec 1.95 = 8.27 | shipped workExceedsBudget: decision 0.01 + exec 1.85 = 1.86; | ok (best variant) |
| ^(a*)b on a* (exact charge just under budget) | 1 2 1 1 Y | 10000x199 | per-cell LS test: decision 6.42 + exec 1.90 = 8.32 | surrogate-free L=2xlen: decision 6.40 + exec 1.89 = 8.29 | shipped workExceedsBudget: decision 6.68 + exec 1.90 = 8.58; | ok (best variant) |
| ^(a*)b on a* (exact charge just under budget) | 1 2 1 1 Y | 20000x99 | per-cell LS test: decision 6.89 + exec 1.94 = 8.83 | surrogate-free L=2xlen: decision 6.70 + exec 1.94 = 8.64 | shipped workExceedsBudget: decision 7.09 + exec 1.94 = 9.03; | ok (best variant) |
| ^(.*)$ on a (exact charge just under budget) | 1 3 2 1 Y | 1000x1330 | per-cell LS test: decision 0.01 + exec 0.52 = 0.53 | surrogate-free L=2xlen: decision 4.22 + exec 0.52 = 4.74 | shipped workExceedsBudget: decision 0.02 + exec 0.52 = 0.53; | ok (best variant) |
| ^(.*)$ on a (exact charge just under budget) | 1 3 2 1 Y | 10000x133 | per-cell LS test: decision 4.44 + exec 0.00 = 4.44 (declined) | surrogate-free L=2xlen: decision 4.33 + exec 0.00 = 4.33 (declined) | shipped workExceedsBudget: decision 4.42 + exec 0.00 = 4.42 (declined); | ok (best variant) |
| ^(.*)$ on a (exact charge just under budget) | 1 3 2 1 Y | 20000x66 | per-cell LS test: decision 4.58 + exec 0.00 = 4.58 (declined) | surrogate-free L=2xlen: decision 4.42 + exec 0.00 = 4.42 (declined) | shipped workExceedsBudget: decision 4.61 + exec 0.00 = 4.61 (declined); | ok (best variant) |
| ^(\d+) on digits | 1 1 0 1 Y | 1000x3998 | per-cell LS test: decision 0.01 + exec 1.19 = 1.20 | surrogate-free L=2xlen: decision 12.56 + exec 1.19 = 13.75 | shipped workExceedsBudget: decision 0.02 + exec 1.19 = 1.20; | ok (best variant) |
| ^(\d+) on digits | 1 1 0 1 Y | 20000x197 | per-cell LS test: decision 0.24 + exec 1.52 = 1.76 | surrogate-free L=2xlen: decision 12.78 + exec 1.48 = 14.26 | shipped workExceedsBudget: decision 0.31 + exec 1.48 = 1.79; | ok (best variant) |
| ^(\d+) on prose | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 0.02 + exec 0.01 = 0.03 | surrogate-free L=2xlen: decision 0.02 + exec 0.01 = 0.03 | shipped workExceedsBudget: decision 0.01 + exec 0.01 = 0.02; | ok (best variant) |
| ^(\d+) on prose | 1 1 0 1 Y | 10000x2000 | per-cell LS test: decision 0.16 + exec 0.09 = 0.26 | surrogate-free L=2xlen: decision 0.14 + exec 0.09 = 0.24 | shipped workExceedsBudget: decision 0.12 + exec 0.09 = 0.22; | ok (best variant) |
| ^(.*)$ on a (AC) | 1 3 2 1 Y | 1000x500 | per-cell LS test: decision 0.01 + exec 0.22 = 0.23 | surrogate-free L=2xlen: decision 0.00 + exec 0.21 = 0.22 | shipped workExceedsBudget: decision 0.01 + exec 0.21 = 0.22; | ok (best variant) |
| ^(.*)$ on a (AC) | 1 3 2 1 Y | 1000x2000 | per-cell LS test: decision 4.21 + exec 0.00 = 4.21 (declined) | surrogate-free L=2xlen: decision 4.20 + exec 0.00 = 4.20 (declined) | shipped workExceedsBudget: decision 4.20 + exec 0.00 = 4.20 (declined); | ok (best variant) |
| ^(.*)$ on a (AC) | 1 3 2 1 Y | 10000x2000 | per-cell LS test: decision 4.20 + exec 0.00 = 4.20 (declined) | surrogate-free L=2xlen: decision 4.19 + exec 0.00 = 4.19 (declined) | shipped workExceedsBudget: decision 4.20 + exec 0.00 = 4.20 (declined); | ok (best variant) |
| ^([^x]*)x on cyr R0=len-5 | 1 2 1 1 Y | 1000x1990 | per-cell LS test: decision 4.80 + exec 1.25 = 6.06 | surrogate-free L=2xlen: decision 6.47 + exec 1.13 = 7.61 | shipped workExceedsBudget: decision 4.79 + exec 1.13 = 5.92; | ok (best variant) |
| ^([^x]*)x on cyr R0=len-5 | 1 2 1 1 Y | 20000x98 | per-cell LS test: decision 5.08 + exec 1.48 = 6.56 | surrogate-free L=2xlen: decision 6.81 + exec 1.47 = 8.29 | shipped workExceedsBudget: decision 5.16 + exec 1.48 = 6.63; | ok (best variant) |
| ^([а-я]*)x on cyr+!6 | 1 2 1 1 Y | 1000x2000 | per-cell LS test: decision 13.32 + exec 4.06 = 17.38 | surrogate-free L=2xlen: decision 8.40 + exec 4.06 = 12.46 | shipped workExceedsBudget: decision 13.35 + exec 4.06 = 17.41; | ok (best variant) |
| ^([а-я]*)x on cyr+!6 | 1 2 1 1 Y | 20000x100 | per-cell LS test: decision 14.23 + exec 3.93 = 18.16 | surrogate-free L=2xlen: decision 9.16 + exec 3.93 = 13.09 | shipped workExceedsBudget: decision 14.20 + exec 3.93 = 18.13; | ok (best variant) |
| ^(\d+) on Cyrillic prose | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 9.62 + exec 0.01 = 9.63 | surrogate-free L=2xlen: decision 0.02 + exec 0.01 = 0.03 | shipped workExceedsBudget: decision 9.61 + exec 0.01 = 9.63; | ok (best variant) |
| ^(\d+) on Cyrillic prose | 1 1 0 1 Y | 20000x200 | per-cell LS test: decision 10.13 + exec 0.19 = 10.31 | surrogate-free L=2xlen: decision 0.32 + exec 0.19 = 0.51 | shipped workExceedsBudget: decision 10.12 + exec 0.19 = 10.31; | ok (best variant) |
| ^(\d+) on CJK prose | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 9.62 + exec 0.01 = 9.63 | surrogate-free L=2xlen: decision 0.02 + exec 0.01 = 0.03 | shipped workExceedsBudget: decision 9.62 + exec 0.01 = 9.63; | ok (best variant) |
| ^(\d+) on CJK prose | 1 1 0 1 Y | 20000x200 | per-cell LS test: decision 10.12 + exec 0.18 = 10.30 | surrogate-free L=2xlen: decision 0.31 + exec 0.18 = 0.49 | shipped workExceedsBudget: decision 10.10 + exec 0.18 = 10.28; | ok (best variant) |
| ^(\d+) on astral | 1 1 0 1 Y | 1000x20000 | per-cell LS test: decision 5.79 + exec 0.01 = 5.80 | surrogate-free L=2xlen: decision 0.04 + exec 0.01 = 0.05 | shipped workExceedsBudget: decision 5.70 + exec 0.01 = 5.71; | ok (best variant) |
| ^(\d+) on astral | 1 1 0 1 Y | 20000x200 | per-cell LS test: decision 10.51 + exec 0.18 = 10.69 | surrogate-free L=2xlen: decision 0.34 + exec 0.18 = 0.52 | shipped workExceedsBudget: decision 10.50 + exec 0.18 = 10.69; | ok (best variant) |

Max decision+exec: per-cell LS test: two-byte rows 18.16 ms, all rows 18.16 ms; surrogate-free L=2xlen: two-byte rows 13.09 ms, all rows 14.26 ms; shipped workExceedsBudget (SF bound): all rows 18.13 ms

WORST row (ms at budget, or measured ms when capped by the row count): 18.2 ms -- ^([а-я]*)x on cyr+!6 20000x100

### Group H on the final code (no model change in round 2)

| row | A W m f anch | cells | cost (units) | best ms | ns/unit | ms@4e6 | verdict |
|---|---|---|---|---|---|---|---|
| ^([^<16 ranges>]+) on cyr + high@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 17.11 + exec 11.04 = 28.15 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cyr + high@start | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 17.54 + exec 11.19 = 28.73 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cyr + high@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 19.99 + exec 11.01 = 31.00 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cyr + high@end | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 20.40 + exec 11.24 = 31.64 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cyr + low@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 17.43 + exec 10.99 = 28.42 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cyr + low@start | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 17.44 + exec 11.15 = 28.58 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cyr + low@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 20.04 + exec 11.00 = 31.05 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cyr + low@end | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 20.08 + exec 11.27 = 31.35 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cjk + high@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 17.52 + exec 10.98 = 28.50 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cjk + high@start | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 17.43 + exec 11.12 = 28.55 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cjk + high@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 20.11 + exec 11.02 = 31.13 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cjk + high@end | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 20.08 + exec 11.22 = 31.30 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cjk + low@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 17.40 + exec 10.97 = 28.36 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cjk + low@start | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 17.42 + exec 11.15 = 28.58 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cjk + low@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 20.12 + exec 11.02 = 31.14 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on cjk + low@end | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 20.04 + exec 11.27 = 31.30 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]+) on astral + high@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 9.63 + exec 5.83 = 15.46 | | | ok |
| ^([^<16 ranges>]+) on astral + high@start | 1 1 0 1.75 Y | 20000x110 | 3.955e+6 | decision 9.82 + exec 6.25 = 16.07 | | | ok |
| ^([^<16 ranges>]+) on astral + high@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 13.32 + exec 5.83 = 19.14 | | | ok |
| ^([^<16 ranges>]+) on astral + high@end | 1 1 0 1.75 Y | 20000x110 | 3.955e+6 | decision 13.51 + exec 6.24 = 19.75 | | | ok |
| ^([^<16 ranges>]+) on astral + low@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 9.57 + exec 5.84 = 15.41 | | | ok |
| ^([^<16 ranges>]+) on astral + low@start | 1 1 0 1.75 Y | 20000x110 | 3.955e+6 | decision 9.81 + exec 6.27 = 16.08 | | | ok |
| ^([^<16 ranges>]+) on astral + low@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 13.32 + exec 5.83 = 19.15 | | | ok |
| ^([^<16 ranges>]+) on astral + low@end | 1 1 0 1.75 Y | 20000x110 | 3.955e+6 | decision 13.54 + exec 6.27 = 19.80 | | | ok |
| ^([^<16 ranges>]*) on cyr + high@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 17.46 + exec 11.25 = 28.71 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cyr + high@start | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 17.51 + exec 11.38 = 28.89 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cyr + high@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 20.01 + exec 11.28 = 31.28 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cyr + high@end | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 20.16 + exec 11.55 = 31.71 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cyr + low@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 17.53 + exec 11.25 = 28.78 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cyr + low@start | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 17.46 + exec 11.44 = 28.90 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cyr + low@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 19.97 + exec 11.25 = 31.22 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cyr + low@end | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 20.11 + exec 11.51 = 31.63 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cjk + high@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 17.60 + exec 11.30 = 28.89 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cjk + high@start | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 17.44 + exec 11.38 = 28.83 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cjk + high@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 19.99 + exec 11.26 = 31.25 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cjk + high@end | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 19.97 + exec 11.50 = 31.47 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cjk + low@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 17.42 + exec 11.25 = 28.67 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cjk + low@start | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 17.41 + exec 11.45 = 28.86 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cjk + low@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 20.12 + exec 11.31 = 31.43 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on cjk + low@end | 1 1 0 1.75 Y | 20000x111 | 3.990e+6 | decision 20.02 + exec 11.58 = 31.60 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<16 ranges>]*) on astral + high@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 9.62 + exec 6.05 = 15.66 | | | ok |
| ^([^<16 ranges>]*) on astral + high@start | 1 1 0 1.75 Y | 20000x110 | 3.955e+6 | decision 9.89 + exec 6.46 = 16.36 | | | ok |
| ^([^<16 ranges>]*) on astral + high@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 13.33 + exec 6.03 = 19.36 | | | ok |
| ^([^<16 ranges>]*) on astral + high@end | 1 1 0 1.75 Y | 20000x110 | 3.955e+6 | decision 13.54 + exec 6.41 = 19.96 | | | ok |
| ^([^<16 ranges>]*) on astral + low@start | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 9.57 + exec 6.02 = 15.60 | | | ok |
| ^([^<16 ranges>]*) on astral + low@start | 1 1 0 1.75 Y | 20000x110 | 3.955e+6 | decision 9.82 + exec 6.44 = 16.26 | | | ok |
| ^([^<16 ranges>]*) on astral + low@end | 1 1 0 1.75 Y | 1000x2282 | 3.999e+6 | decision 13.34 + exec 6.03 = 19.37 | | | ok |
| ^([^<16 ranges>]*) on astral + low@end | 1 1 0 1.75 Y | 20000x110 | 3.955e+6 | decision 13.57 + exec 6.45 = 20.02 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cyr + high@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 17.58 + exec 11.39 = 28.97 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cyr + high@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 17.54 + exec 11.49 = 29.04 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cyr + high@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.91 + exec 11.37 = 31.28 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cyr + high@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.82 + exec 11.59 = 31.42 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cyr + low@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 17.57 + exec 11.37 = 28.94 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cyr + low@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 17.62 + exec 11.51 = 29.13 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cyr + low@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.78 + exec 11.37 = 31.14 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cyr + low@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.66 + exec 11.58 = 31.24 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cjk + high@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 17.58 + exec 11.37 = 28.95 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cjk + high@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 17.53 + exec 11.48 = 29.02 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cjk + high@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.88 + exec 11.40 = 31.29 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cjk + high@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.73 + exec 11.56 = 31.30 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cjk + low@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 17.51 + exec 11.33 = 28.84 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cjk + low@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 17.58 + exec 11.48 = 29.06 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cjk + low@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.74 + exec 11.37 = 31.11 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on cjk + low@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.65 + exec 11.58 = 31.23 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]+) on astral + high@start | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 9.56 + exec 6.00 = 15.56 | | | ok |
| ^([^<32 ranges>]+) on astral + high@start | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 9.75 + exec 6.40 = 16.15 | | | ok |
| ^([^<32 ranges>]+) on astral + high@end | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 12.75 + exec 6.01 = 18.76 | | | ok |
| ^([^<32 ranges>]+) on astral + high@end | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 12.99 + exec 6.43 = 19.42 | | | ok |
| ^([^<32 ranges>]+) on astral + low@start | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 9.57 + exec 6.02 = 15.59 | | | ok |
| ^([^<32 ranges>]+) on astral + low@start | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 9.76 + exec 6.44 = 16.20 | | | ok |
| ^([^<32 ranges>]+) on astral + low@end | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 12.82 + exec 6.00 = 18.83 | | | ok |
| ^([^<32 ranges>]+) on astral + low@end | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 13.03 + exec 6.44 = 19.47 | | | ok |
| ^([^<32 ranges>]*) on cyr + high@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 17.60 + exec 11.45 = 29.04 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cyr + high@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 17.47 + exec 11.56 = 29.03 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cyr + high@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.85 + exec 11.49 = 31.34 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cyr + high@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.69 + exec 11.68 = 31.37 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cyr + low@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 17.57 + exec 11.46 = 29.02 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cyr + low@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 17.55 + exec 11.60 = 29.15 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cyr + low@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.75 + exec 11.46 = 31.21 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cyr + low@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.69 + exec 11.75 = 31.44 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cjk + high@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 17.54 + exec 11.45 = 28.99 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cjk + high@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 17.47 + exec 11.56 = 29.03 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cjk + high@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.86 + exec 11.49 = 31.35 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cjk + high@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.88 + exec 11.71 = 31.59 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cjk + low@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 17.60 + exec 11.49 = 29.09 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cjk + low@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 17.62 + exec 11.66 = 29.28 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cjk + low@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.86 + exec 11.50 = 31.36 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on cjk + low@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.86 + exec 11.75 = 31.61 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<32 ranges>]*) on astral + high@start | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 9.51 + exec 6.11 = 15.62 | | | ok |
| ^([^<32 ranges>]*) on astral + high@start | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 9.77 + exec 6.52 = 16.29 | | | ok |
| ^([^<32 ranges>]*) on astral + high@end | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 12.74 + exec 6.08 = 18.83 | | | ok |
| ^([^<32 ranges>]*) on astral + high@end | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 12.97 + exec 6.51 = 19.48 | | | ok |
| ^([^<32 ranges>]*) on astral + low@start | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 9.46 + exec 6.09 = 15.55 | | | ok |
| ^([^<32 ranges>]*) on astral + low@start | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 9.70 + exec 6.55 = 16.25 | | | ok |
| ^([^<32 ranges>]*) on astral + low@end | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 12.77 + exec 6.10 = 18.87 | | | ok |
| ^([^<32 ranges>]*) on astral + low@end | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 12.96 + exec 6.52 = 19.48 | | | ok |
| ^([^<64 ranges>]+) on cyr + high@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.71 + exec 13.80 = 33.51 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cyr + high@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.70 + exec 13.80 = 33.50 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cyr + high@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 21.95 + exec 13.81 = 35.75 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cyr + high@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 21.96 + exec 13.98 = 35.94 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cyr + low@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.86 + exec 13.85 = 33.71 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cyr + low@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.72 + exec 13.82 = 33.53 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cyr + low@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 21.99 + exec 13.81 = 35.80 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cyr + low@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 21.77 + exec 13.93 = 35.71 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cjk + high@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.79 + exec 13.88 = 33.67 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cjk + high@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.62 + exec 13.82 = 33.44 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cjk + high@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 21.97 + exec 13.80 = 35.77 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cjk + high@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 21.97 + exec 13.92 = 35.90 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cjk + low@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.71 + exec 13.79 = 33.50 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cjk + low@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.70 + exec 13.84 = 33.54 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cjk + low@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 21.94 + exec 13.80 = 35.73 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on cjk + low@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 21.83 + exec 13.96 = 35.79 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on astral + high@start | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 10.60 + exec 7.18 = 17.79 | | | ok |
| ^([^<64 ranges>]+) on astral + high@start | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 10.84 + exec 7.58 = 18.42 | | | ok |
| ^([^<64 ranges>]+) on astral + high@end | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 13.86 + exec 7.30 = 21.17 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on astral + high@end | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 14.10 + exec 7.58 = 21.68 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on astral + low@start | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 10.57 + exec 7.18 = 17.75 | | | ok |
| ^([^<64 ranges>]+) on astral + low@start | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 10.81 + exec 7.61 = 18.42 | | | ok |
| ^([^<64 ranges>]+) on astral + low@end | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 13.92 + exec 7.21 = 21.14 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]+) on astral + low@end | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 14.06 + exec 7.60 = 21.66 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cyr + high@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.67 + exec 13.72 = 33.38 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cyr + high@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.72 + exec 13.80 = 33.52 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cyr + high@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 21.99 + exec 13.72 = 35.71 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cyr + high@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 22.00 + exec 13.91 = 35.91 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cyr + low@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.86 + exec 13.72 = 33.58 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cyr + low@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.59 + exec 13.76 = 33.35 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cyr + low@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 21.93 + exec 13.72 = 35.65 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cyr + low@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 21.79 + exec 13.88 = 35.66 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cjk + high@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.74 + exec 13.72 = 33.46 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cjk + high@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.70 + exec 13.77 = 33.47 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cjk + high@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 22.23 + exec 13.77 = 36.00 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cjk + high@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 21.93 + exec 13.92 = 35.86 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cjk + low@start | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 19.80 + exec 13.75 = 33.54 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cjk + low@start | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 19.73 + exec 13.81 = 33.53 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cjk + low@end | 1 1 0 2 Y | 1000x1997 | 4.000e+6 | decision 22.01 + exec 13.77 = 35.78 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on cjk + low@end | 1 1 0 2 Y | 20000x97 | 4.000e+6 | decision 21.91 + exec 13.94 = 35.85 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on astral + high@start | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 10.56 + exec 7.17 = 17.73 | | | ok |
| ^([^<64 ranges>]*) on astral + high@start | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 10.81 + exec 7.64 = 18.45 | | | ok |
| ^([^<64 ranges>]*) on astral + high@end | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 13.84 + exec 7.07 = 20.91 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on astral + high@end | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 14.07 + exec 7.64 = 21.71 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on astral + low@start | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 10.56 + exec 7.13 = 17.69 | | | ok |
| ^([^<64 ranges>]*) on astral + low@start | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 10.78 + exec 7.63 = 18.40 | | | ok |
| ^([^<64 ranges>]*) on astral + low@end | 1 1 0 2 Y | 1000x1996 | 3.998e+6 | decision 13.79 + exec 7.09 = 20.88 | | | ACCEPTED RISK (20-50 ms) |
| ^([^<64 ranges>]*) on astral + low@end | 1 1 0 2 Y | 20000x96 | 3.960e+6 | decision 14.04 + exec 7.62 = 21.67 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cyr + high@start | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 17.02 + exec 5.20 = 22.22 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cyr + high@start | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 17.32 + exec 4.85 = 22.16 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cyr + high@end | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 21.44 + exec 4.46 = 25.90 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cyr + high@end | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 21.69 + exec 4.84 = 26.54 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cyr + low@start | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 17.04 + exec 4.47 = 21.51 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cyr + low@start | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 17.27 + exec 4.87 = 22.14 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cyr + low@end | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 21.60 + exec 4.49 = 26.08 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cyr + low@end | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 21.85 + exec 4.89 = 26.75 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cjk + high@start | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 21.73 + exec 4.48 = 26.22 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cjk + high@start | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 21.80 + exec 4.86 = 26.66 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cjk + high@end | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 26.16 + exec 4.48 = 30.64 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cjk + high@end | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 26.42 + exec 4.92 = 31.34 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cjk + low@start | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 21.72 + exec 4.47 = 26.19 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cjk + low@start | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 21.80 + exec 4.88 = 26.68 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cjk + low@end | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 26.15 + exec 4.48 = 30.63 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on cjk + low@end | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 26.30 + exec 4.88 = 31.18 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on astral + high@start | 1 1 0 1 Y | 1000x3996 | 3.999e+6 | decision 12.99 + exec 2.25 = 15.24 | | | ok |
| ^(.+) on astral + high@start | 1 1 0 1 Y | 20000x196 | 3.980e+6 | decision 13.26 + exec 2.61 = 15.87 | | | ok |
| ^(.+) on astral + high@end | 1 1 0 1 Y | 1000x3996 | 3.999e+6 | decision 19.55 + exec 2.26 = 21.81 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on astral + high@end | 1 1 0 1 Y | 20000x196 | 3.980e+6 | decision 19.83 + exec 2.61 = 22.44 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on astral + low@start | 1 1 0 1 Y | 1000x3996 | 3.999e+6 | decision 13.00 + exec 2.26 = 15.25 | | | ok |
| ^(.+) on astral + low@start | 1 1 0 1 Y | 20000x196 | 3.980e+6 | decision 13.24 + exec 2.63 = 15.88 | | | ok |
| ^(.+) on astral + low@end | 1 1 0 1 Y | 1000x3996 | 3.999e+6 | decision 19.61 + exec 2.26 = 21.87 | | | ACCEPTED RISK (20-50 ms) |
| ^(.+) on astral + low@end | 1 1 0 1 Y | 20000x196 | 3.980e+6 | decision 19.72 + exec 2.62 = 22.33 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cyr + high@start | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 16.99 + exec 2.99 = 19.99 | | | ok |
| ^(\S+) on cyr + high@start | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 17.18 + exec 3.31 = 20.50 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cyr + high@end | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 21.46 + exec 2.99 = 24.46 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cyr + high@end | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 21.61 + exec 3.30 = 24.92 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cyr + low@start | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 17.00 + exec 2.99 = 19.99 | | | ok |
| ^(\S+) on cyr + low@start | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 17.24 + exec 3.32 = 20.55 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cyr + low@end | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 21.45 + exec 2.99 = 24.44 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cyr + low@end | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 21.60 + exec 3.32 = 24.91 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cjk + high@start | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 17.03 + exec 3.01 = 20.04 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cjk + high@start | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 17.34 + exec 3.33 = 20.67 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cjk + high@end | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 21.53 + exec 3.00 = 24.53 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cjk + high@end | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 21.72 + exec 3.33 = 25.06 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cjk + low@start | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 17.12 + exec 3.01 = 20.12 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cjk + low@start | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 17.28 + exec 3.32 = 20.60 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cjk + low@end | 1 1 0 1 Y | 1000x3997 | 4.000e+6 | decision 21.46 + exec 2.99 = 24.45 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on cjk + low@end | 1 1 0 1 Y | 20000x197 | 4.000e+6 | decision 21.63 + exec 3.39 = 25.02 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on astral + high@start | 1 1 0 1 Y | 1000x3996 | 3.999e+6 | decision 11.17 + exec 2.25 = 13.42 | | | ok |
| ^(\S+) on astral + high@start | 1 1 0 1 Y | 20000x196 | 3.980e+6 | decision 11.37 + exec 2.58 = 13.95 | | | ok |
| ^(\S+) on astral + high@end | 1 1 0 1 Y | 1000x3996 | 3.999e+6 | decision 17.67 + exec 2.24 = 19.91 | | | ok |
| ^(\S+) on astral + high@end | 1 1 0 1 Y | 20000x196 | 3.980e+6 | decision 17.98 + exec 2.58 = 20.56 | | | ACCEPTED RISK (20-50 ms) |
| ^(\S+) on astral + low@start | 1 1 0 1 Y | 1000x3996 | 3.999e+6 | decision 11.10 + exec 2.25 = 13.35 | | | ok |
| ^(\S+) on astral + low@start | 1 1 0 1 Y | 20000x196 | 3.980e+6 | decision 11.40 + exec 2.60 = 13.99 | | | ok |
| ^(\S+) on astral + low@end | 1 1 0 1 Y | 1000x3996 | 3.999e+6 | decision 17.66 + exec 2.24 = 19.91 | | | ok |
| ^(\S+) on astral + low@end | 1 1 0 1 Y | 20000x196 | 3.980e+6 | decision 17.89 + exec 2.59 = 20.48 | | | ACCEPTED RISK (20-50 ms) |
| ^(\d+) digits+lone on cyr + high@start | 1 1 0 1 Y | 1000x100002 | 2.000e+3 | decision 0.09 + exec 0.01 = 0.10 | | | ok |
| ^(\d+) digits+lone on cyr + high@start | 1 1 0 1 Y | 20000x100002 | 4.000e+4 | decision 1.24 + exec 0.56 = 1.80 | | | ok |
| ^(\d+) digits+lone on cyr + high@end | 1 1 0 1 Y | 1000x4000 | 4.000e+6 | decision 17.77 + exec 3.01 = 20.77 | | | ACCEPTED RISK (20-50 ms) |
| ^(\d+) digits+lone on cyr + high@end | 1 1 0 1 Y | 20000x200 | 4.000e+6 | decision 18.10 + exec 2.60 = 20.70 | | | ACCEPTED RISK (20-50 ms) |
| ^(\d+) digits+lone on cyr + low@start | 1 1 0 1 Y | 1000x100002 | 2.000e+3 | decision 0.01 + exec 0.01 = 0.02 | | | ok |
| ^(\d+) digits+lone on cyr + low@start | 1 1 0 1 Y | 20000x100002 | 4.000e+4 | decision 1.26 + exec 0.56 = 1.82 | | | ok |
| ^(\d+) digits+lone on cyr + low@end | 1 1 0 1 Y | 1000x4000 | 4.000e+6 | decision 17.77 + exec 2.62 = 20.39 | | | ACCEPTED RISK (20-50 ms) |
| ^(\d+) digits+lone on cyr + low@end | 1 1 0 1 Y | 20000x200 | 4.000e+6 | decision 18.12 + exec 2.94 = 21.06 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cyr + high@start | 1 1 0 1 n | 1000x3999 | 4.000e+6 | decision 20.85 + exec 1.49 = 22.33 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cyr + high@start | 1 1 0 1 n | 20000x199 | 4.000e+6 | decision 21.11 + exec 1.64 = 22.75 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cyr + high@end | 1 1 0 1 n | 1000x3999 | 4.000e+6 | decision 23.12 + exec 1.49 = 24.61 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cyr + high@end | 1 1 0 1 n | 20000x199 | 4.000e+6 | decision 23.34 + exec 1.64 = 24.97 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cyr + low@start | 1 1 0 1 n | 1000x3999 | 4.000e+6 | decision 20.80 + exec 1.49 = 22.29 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cyr + low@start | 1 1 0 1 n | 20000x199 | 4.000e+6 | decision 21.24 + exec 1.64 = 22.88 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cyr + low@end | 1 1 0 1 n | 1000x3999 | 4.000e+6 | decision 23.17 + exec 1.49 = 24.67 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cyr + low@end | 1 1 0 1 n | 20000x199 | 4.000e+6 | decision 23.57 + exec 1.64 = 25.21 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cjk + high@start | 1 1 0 1 n | 1000x3999 | 4.000e+6 | decision 20.90 + exec 1.49 = 22.39 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cjk + high@start | 1 1 0 1 n | 20000x199 | 4.000e+6 | decision 21.08 + exec 1.64 = 22.72 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cjk + high@end | 1 1 0 1 n | 1000x3999 | 4.000e+6 | decision 23.03 + exec 1.49 = 24.52 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cjk + high@end | 1 1 0 1 n | 20000x199 | 4.000e+6 | decision 23.40 + exec 1.64 = 25.04 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cjk + low@start | 1 1 0 1 n | 1000x3999 | 4.000e+6 | decision 20.85 + exec 1.49 = 22.34 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cjk + low@start | 1 1 0 1 n | 20000x199 | 4.000e+6 | decision 21.21 + exec 1.65 = 22.85 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cjk + low@end | 1 1 0 1 n | 1000x3999 | 4.000e+6 | decision 23.13 + exec 1.49 = 24.62 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on cjk + low@end | 1 1 0 1 n | 20000x199 | 4.000e+6 | decision 23.47 + exec 1.65 = 25.11 | | | ACCEPTED RISK (20-50 ms) |
| unanchored (x) on astral + high@start | 1 1 0 1 n | 1000x3998 | 3.999e+6 | decision 12.22 + exec 1.49 = 13.71 | | | ok |
| unanchored (x) on astral + high@start | 1 1 0 1 n | 20000x198 | 3.980e+6 | decision 12.56 + exec 1.63 = 14.19 | | | ok |
| unanchored (x) on astral + high@end | 1 1 0 1 n | 1000x3998 | 3.999e+6 | decision 15.53 + exec 1.49 = 17.02 | | | ok |
| unanchored (x) on astral + high@end | 1 1 0 1 n | 20000x198 | 3.980e+6 | decision 15.81 + exec 1.64 = 17.45 | | | ok |
| unanchored (x) on astral + low@start | 1 1 0 1 n | 1000x3998 | 3.999e+6 | decision 12.26 + exec 1.49 = 13.75 | | | ok |
| unanchored (x) on astral + low@start | 1 1 0 1 n | 20000x198 | 3.980e+6 | decision 12.49 + exec 1.63 = 14.12 | | | ok |
| unanchored (x) on astral + low@end | 1 1 0 1 n | 1000x3998 | 3.999e+6 | decision 15.56 + exec 1.49 = 17.05 | | | ok |
| unanchored (x) on astral + low@end | 1 1 0 1 n | 20000x198 | 3.980e+6 | decision 15.80 + exec 1.63 = 17.43 | | | ok |
| unanchored (\d+) on cyr + high@start | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 6.32 + exec 1.51 = 7.82 | | | ok |
| unanchored (\d+) on cyr + high@start | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 6.85 + exec 1.48 = 8.33 | | | ok |
| unanchored (\d+) on cyr + high@end | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 8.53 + exec 1.14 = 9.66 | | | ok |
| unanchored (\d+) on cyr + high@end | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 9.11 + exec 1.47 = 10.58 | | | ok |
| unanchored (\d+) on cyr + low@start | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 6.33 + exec 1.14 = 7.47 | | | ok |
| unanchored (\d+) on cyr + low@start | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 6.84 + exec 1.48 = 8.32 | | | ok |
| unanchored (\d+) on cyr + low@end | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 8.58 + exec 1.14 = 9.72 | | | ok |
| unanchored (\d+) on cyr + low@end | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 9.07 + exec 1.47 = 10.54 | | | ok |
| unanchored (\d+) on cjk + high@start | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 6.34 + exec 1.14 = 7.48 | | | ok |
| unanchored (\d+) on cjk + high@start | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 6.85 + exec 1.48 = 8.33 | | | ok |
| unanchored (\d+) on cjk + high@end | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 8.57 + exec 1.14 = 9.71 | | | ok |
| unanchored (\d+) on cjk + high@end | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 9.10 + exec 1.47 = 10.57 | | | ok |
| unanchored (\d+) on cjk + low@start | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 6.31 + exec 1.14 = 7.46 | | | ok |
| unanchored (\d+) on cjk + low@start | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 6.86 + exec 1.48 = 8.34 | | | ok |
| unanchored (\d+) on cjk + low@end | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 8.58 + exec 1.14 = 9.72 | | | ok |
| unanchored (\d+) on cjk + low@end | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 9.10 + exec 1.47 = 10.57 | | | ok |
| unanchored (\d+) on astral + high@start | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 6.32 + exec 1.14 = 7.46 | | | ok |
| unanchored (\d+) on astral + high@start | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 6.84 + exec 1.47 = 8.31 | | | ok |
| unanchored (\d+) on astral + high@end | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 8.52 + exec 1.14 = 9.66 | | | ok |
| unanchored (\d+) on astral + high@end | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 9.06 + exec 1.47 = 10.53 | | | ok |
| unanchored (\d+) on astral + low@start | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 6.31 + exec 1.13 = 7.44 | | | ok |
| unanchored (\d+) on astral + low@start | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 6.81 + exec 1.47 = 8.28 | | | ok |
| unanchored (\d+) on astral + low@end | 1 1 0 1 n | 1000x2000 | 3.999e+6 | decision 8.54 + exec 1.14 = 9.67 | | | ok |
| unanchored (\d+) on astral + low@end | 1 1 0 1 n | 20000x100 | 3.980e+6 | decision 9.05 + exec 1.83 = 10.88 | | | ok |

WORST row (ms at budget, or measured ms when capped by the row count): 36.0 ms -- ^([^<64 ranges>]*) cjk+high@end 1000x1995
