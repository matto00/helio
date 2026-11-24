# HEL-1836 calibration: the unanchored decision scan

Method: as HEL-1823 (`calibrate-anchored.mjs`, copied into this change; reference machine, node 22, `nice -n 19`, best of 7,
cells sized so the exact charge is at most 4.00e6, 1,000 and 20,000 rows). Every row times the shipped `workExceedsBudget`
(all stages) plus `RegExp.exec`. "main" is b2da43a3d's five evaluator modules (`CAL_SRC` override), "change" is this branch.
Raw runs (and their re-runs) are under `.concertino/runs/HEL-1836/evidence/`. Run on a shared desktop: run-to-run swing about
+-2 ms.

Scope note (PR body): the ticket's original premise was refuted (`.concertino/runs/HEL-1836/evidence/premise-validation.md`): the
unanchored `(x)` looseness is the whole-cell-as-one-run bound plus the exact scan itself, not surrogate doubling; the owner chose
proceed-with-restated-scope.

## Identity

No DECISION-DIFF, no COST-DIFF (shipped `cellWork` against a verbatim copy of main's `perPositionWork` on every H and J frame
cell) and no MISMATCH in any of groups A-J. The deterministic equivalence guard
(`regexUnanchoredScan.test.ts`, (c)) holds over generated cells and budget-boundary frames.

## Per-group maxima, change (ms at budget, or decision + exec total)

| group | worst row | change | HEL-1823 / main |
|---|---|---|---|
| A | astral `^(.{1000})x` | 7.7 | - |
| B | cjk `^(.*)x` | 9.0 | - |
| C | r=16 `*` cyr | 10.5 | - |
| D | CONTROL cyr `(.{16})x` | 18.6 | exec-only control, 19.0-21.4 run to run (reported, not chased) |
| E | `^([а-я]*)x` on cyr+!6 | 19.0 | - |
| F | per-call overhead | 0.7 | - |
| G | `^([^<64 ranges>]+)` cyr | 16.1 | - |
| H | `^([^<64 ranges>]+)` cyr+high@end | 19.4 (worst unanchored row 13.9) | main 25.1 (unanchored `(x)`, 16 rows over 20 ms) |
| I | `^([^<64 ranges>]*)` cjk+k=2 | 17.7 | main 17.8 |
| J | see below | 24.4 (run 3), 23.2 (run 2) | main 47.2 |

Groups A-I: no row over 20 ms on the change (group D's control is 18.6 here). Group H: 200 rows paired with main, none slower
by more than 3 ms except one anchored row (`^(\d+)` digits+lone, 20000 rows of 100,002 characters, charge 4.0e4, 5.6 vs 2.2 ms):
the anchored path and `anchoredCellWork` are unchanged by this change, so that is run noise on a 2e9-character frame. Group I:
48 rows paired, none slower than main (worst 17.74 vs 17.81), so keeping D3 (`unitLength` in stage 1) costs nothing measurable.

## Group H, unanchored `(x)` / `(\d+)` rows (the ticket's rows)

main: 16 rows over 20 ms, worst 25.1 (decision up to 23.4 + exec 1.6). Change: worst unanchored row 13.9 (decision 11.3 + exec
2.5, astral body), every `(x)` cyr/cjk row under 20 ms. Full tables: `H-main.txt`, `H-new-run1.txt`.

## Group J (new): loosest unanchored shapes, main vs change

main: 222 rows, 113 over 20 ms, worst 47.2 ms (`(.+)` on `\n` + one lone high at the end, 20000 x 197), recorded nowhere before this
change. Change: worst 24.4 ms. Exec alone is 12-16 ms on these frames (V8 `u`-mode exec of a class holding surrogates on a
two-byte string; the 64-range f=2 control's exec alone is 16 ms), so the decision (4.4-9.3 ms, about 4e6 characters at
1.7-2 ns each) cannot bring them all under 20 ms. After one rerun and one charge-identical loop tightening (D6) 19 rows were
still above 20 ms in at least one of two runs (run 2 / run 3); no bound was loosened and no constant changed.

**ACCEPTED RISK (owner ruling 2026-11-24, under the 50 ms C2 ceiling, no follow-up on exec-cost modelling).** Rows over 20 ms,
decision + exec = total (ms):

| shape | frame | main | change run 2 | change run 3 |
|---|---|---|---|---|
| ([^acegikm]+) (8 ranges) on a+tag + none | 1000x3999 | 33.6 + 12.6 = 46.2 | 7.3 + 13.6 = 20.8 | 8.1 + 16.3 = 24.4 |
| ([^acegikm]+) (8 ranges) on a + high@end | 20000x197 | 31.0 + 13.2 = 44.2 | 6.9 + 14.4 = 21.3 | 8.6 + 14.7 = 23.3 |
| ([^a]+) on a + high@end | 20000x197 | 27.2 + 12.7 = 39.9 | 9.3 + 13.9 = 23.2 | 9.0 + 12.5 = 21.5 |
| (.+) on nl + high@end | 20000x197 | 34.6 + 12.6 = 47.2 | 6.9 + 11.5 = 18.4 | 8.6 + 14.2 = 22.9 |
| ([^<8 cyr>]+) (8 ranges, two-byte) on ж + none | 1000x4000 | 33.8 + 11.9 = 45.7 | 6.7 + 12.6 = 19.3 | 8.5 + 14.3 = 22.8 |
| ([^acegikm]+) (8 ranges) on a+tag + high@end | 20000x196 | 30.2 + 12.8 = 43.0 | 6.9 + 13.9 = 20.8 | 8.7 + 13.7 = 22.3 |
| ([^acegikm]+) (8 ranges) on a+tag + none | 20000x199 | 33.8 + 13.0 = 46.8 | 8.3 + 13.8 = 22.1 | 7.5 + 14.2 = 21.8 |
| ([^<8 cyr>]+) (8 ranges, two-byte) on ж + none | 20000x200 | 33.8 + 12.1 = 45.9 | 7.3 + 13.6 = 20.9 | 8.2 + 13.8 = 22.0 |
| ([^acegikm]+) (8 ranges) on a + high@end | 1000x3997 | 31.3 + 12.6 = 43.9 | 6.7 + 12.6 = 19.4 | 6.8 + 14.8 = 21.6 |
| ([^a]+) on a + high@end | 1000x3997 | 27.5 + 11.9 = 39.4 | 7.4 + 13.5 = 20.9 | 8.3 + 13.2 = 21.5 |
| (.+) on nl + high@end | 1000x3997 | 31.2 + 13.0 = 44.2 | 6.7 + 11.8 = 18.5 | 7.5 + 13.8 = 21.3 |
| ([^<8 cyr>]+) (8 ranges, two-byte) on ж + high@end | 20000x197 | 33.6 + 11.7 = 45.3 | 8.3 + 12.7 = 21.0 | 7.6 + 11.6 = 19.3 |
| ([^<64 ranges>]+) (f=2 control) on excluded pt + none | 20000x100 | 23.3 + 14.6 = 37.9 | 4.7 + 16.0 = 20.8 | 4.4 + 16.2 = 20.6 |
| ([^a]+) on a+tag + high@end | 20000x196 | 27.1 + 12.6 = 39.7 | 8.0 + 12.2 = 20.3 | 8.2 + 12.4 = 20.7 |
| (.+) on nl+tag + high@end | 20000x196 | 30.8 + 12.3 = 43.1 | 6.8 + 11.5 = 18.3 | 7.9 + 12.8 = 20.7 |
| ([^a]+) on a+tag + none | 20000x199 | 30.5 + 12.3 = 42.7 | 7.2 + 12.3 = 19.6 | 7.8 + 12.8 = 20.6 |
| ([^acegikm]+) (8 ranges) on a+tag + high@end | 1000x3996 | 31.0 + 12.6 = 43.6 | 6.7 + 12.8 = 19.6 | 7.2 + 13.3 = 20.4 |
| ([^a]+) on a+tag + high@end | 1000x3996 | 27.3 + 11.8 = 39.1 | 7.6 + 12.0 = 19.6 | 7.6 + 12.7 = 20.3 |
| ([^a]+) on a+tag + none | 1000x3999 | 30.5 + 11.9 = 42.4 | 7.0 + 12.0 = 19.0 | 7.2 + 12.8 = 20.1 |

No J row is slower than on main by more than 3 ms (222 paired rows). Full tables: `J-main-run1.txt`, `J-new-run2.txt`, `J-new-run3.txt`.

## Table-build cost

First `cellWork` call on a pattern builds its 64 KiB membership table (once per compiled pattern, cached in a `WeakMap` keyed by the
`chars` array): 0.007-0.062 ms for `(x)`, `([^a]+)`, `([^acegikm]+)`, `(.+)` and a 65k-wide class (`table-build.txt`).

## Result

Decisions and costs identical everywhere; the unanchored `(x)` rows (group H, 25.1 ms on main) drop to 13.9 ms and leave the
accepted-risk list; the group-D `(.{16})x` control is exec-only noise (18.6-21.4 ms, no decision, no surrogates); the group-J rows
at 20.1-24.4 ms are recorded as accepted risk above (main's same shapes were up to 47.2 ms).
