# HEL-1823 calibration: anchored stage-2 bound charges one extra unit per unpaired surrogate

Method as HEL-1807 (`calibrate-anchored.mjs`, carried into this change with group I added): this desktop, node 22 / V8,
`nice -n 19`, best of 7 (groups G/H/I) or 5 passes, the cost from the real `compileJavaRegex(...).work`, the shipped
`workExceedsBudget` (decision) plus `RegExp.exec` (exec) over the frame, frames sized to the budget (4.00e6). One group per
Bash call. Logs: `calibration-logs/` (gitignored `*.log`; kept in the main checkout under `.concertino/runs/HEL-1823/evidence/`). "before" is main's code (`d3059b611`), "after" is this change. Noise on this shared
desktop is about 1 ms between runs, up to 4 ms in a bad moment (see "Rerun").

## The change

`testedBound` (anchored stage 2) used `L = 2 x text.length` for a cell with an unpaired surrogate. It now uses the cell's
exact unit length `text.length + (LONE_SURROGATE_UNITS - 1) x loneCount`, so for a no-tail frame the bound equals the exact
charge and the per-character scan (stage 3) is skipped. Because `L` is exact the bound stays a true upper bound of
`cellWork`: decisions are unchanged for every frame.

## Counting method (design D2), chosen by measurement

| method | group H (one lone per cell), worst anchored row | dense rows (group I) | uniform one-byte (group G) |
|---|---|---|---|
| main (double the whole cell) | 36.2 ms | 34.8 ms (k=2); half-dense `.+` 16-20 ms | 20.4 ms |
| `LONE_SURROGATE.test` gate + `text.replace(/.../gu, "")` length difference | not run (rejected on group I) | k=2 wide class 20.6-21.3; half-dense `^(.+)` **28.1-29.5 ms (regressed +8-10 ms vs main)** | not run |
| `LONE_SURROGATE.test` gate + `charCodeAt` loop | 20.9-21.8 ms on the lone-at-end rows (the native test scans a whole 4M-char frame when the lone is at the end, then the loop scans again); `^(\d+)` digits + lone at end regressed 20.7 -> 30.9 ms (count then exact scan) | 19.4 ms max, none worse than main by more than 3 ms | not run |
| `charCodeAt` loop only (no gate) | all anchored rows under 20 ms except `^(\d+)` digits + lone at end, 21.1-21.8 (its first version had no `lengthBound`) | not run | one-byte decision 1.5 -> 6.8 ms (the loop replaces a native one-byte test; 84 rows, worst total 19.85) |
| **`isWellFormed()` gate (native, O(1) on one-byte) + `charCodeAt` loop (shipped)** | **max 17.2-18.5 ms** | **max 17.65 ms, none worse than main by more than 0.43 ms** | **max 15.1 ms, none worse than main by more than 0.71 ms** |

Two further pieces keep the cost of counting off frames that do not need it: a cell with no unpaired surrogate (the usual case)
returns `text.length` after one native `isWellFormed()` (falls back to the previous `LONE_SURROGATE.test` where the method does
not exist); and `lengthBound` (the least the tested bound can be, `L = text.length`) is summed first, so a frame whose
tested bound is certain to miss is not counted (this keeps `^(\d+)` over 100,002-character cells with a lone surrogate at the
start at 0.1 ms, where counting without it measured 5-8 ms).

## Group H before / after (the ticket's accepted-risk shape and its neighbours)

`^([^<64 ranges>]*)`, 1,000 rows x 1,997 characters, best of 7 (decision + exec = total):

| cell | before | after |
|---|---|---|
| cyr + lone high at start | 19.80 + 13.71 = 33.51 | 2.60 + 13.81 = 16.41 |
| cyr + lone high at end | 22.03 + 13.71 = 35.74 | 3.36 + 13.77 = 17.13 |
| cjk + lone low at start | 19.85 + 13.77 = 33.63 | 2.62 + 13.81 = 16.43 |
| cjk + lone low at end | 21.99 + 13.75 = 35.74 | 3.35 + 13.86 = 17.22 |
| astral + lone high at end (1,000 x 1,996) | 13.93 + 7.16 = 21.08 | 3.21 + 7.14 = 10.36 |

All 248 rows (`calibration-logs/before-H.log`, `final-H-rerun.log`):

| | before | after |
|---|---|---|
| anchored rows (200) over 20 ms | 149 (all 20-50 ms) | **0** |
| anchored worst | 36.2 ms | **18.5 ms** |
| unanchored `(x)`/`(\d+)` rows (48) over 20 ms | 16 (worst 25.2) | 16 (worst 25.2), unchanged code (non-goal) |
| rows whose cost differs | - | 0 |
| rows more than 3 ms slower than before | - | 0 (worst +0.43 ms) |
| DECISION-DIFF (decision vs summed exact charge) | - | 0 |

The group-H shape is now admitted at stage 2 without reading a code point (pinned by the jest tests, not a timing assertion).
The ticket's "161 of 248 rows 20-50 ms" is 149 anchored + 12 unanchored over 20 ms in this run's before table; the 149
anchored rows are the ones removed from the accepted-risk list. The unanchored `(x)` rows (25.2 ms worst) remain accepted risk.

## Dense unpaired surrogates (group I, new)

Cells of a CJK or astral body with k unpaired high surrogates spread evenly (k = 2, 16, half the characters, all of them), four
wide patterns, 1,000 and 20,000 rows, sized to the budget: 64 rows.

| | before (main) | after |
|---|---|---|
| rows over 20 ms | 21 | **0** |
| worst | 34.8 ms (`^([^<64 ranges>]*)` cjk k=2, 20,000 x 96) | **17.65 ms** |
| rows more than 3 ms slower than main | - | 0 (worst +0.43 ms: all-lone cells, where main's stage 2 was already exact) |
| rows whose cost differs, DECISION-DIFF | - | 0, 0 |

The `replace` variant is rejected by this group (half-dense `^(.+)` regressed to 28-29.5 ms from 16-20), which is why it
is not shipped.

## Groups A-G on the shipped code (maxima; no MISMATCH, no DECISION-DIFF, no sizing error in any group)

| group | worst row (ms at budget, or total decision + exec) |
|---|---|
| A (anchored HEL-1697 patterns, one-byte shapes) | 7.8 |
| B (two-byte and lone-surrogate shapes) | 9.0 |
| C (class width, short runs, alternatives) | 10.3 |
| D (partly anchored, controls, multiline) | 21.4: `CONTROL cyr / (.{16})x`, an UNANCHORED control (HEL-1697 path, unchanged code; 19.2 in an earlier run of the same code) |
| E (decision scan, shipped workExceedsBudget) | 19.1 (max decision + exec of the per-cell variant 19.14; shipped 13.2) |
| F (per-call overhead) | 0.7 |
| G (no-tail wide classes) | 15.1 (main 20.4); no row more than 0.71 ms slower than main |
| H | 18.5 anchored (see above) |
| I | 17.65 |

Decision identity: `cellWork` and every cost constant are unchanged, so every row's cost is unchanged (0 cost differences against
main on G, H, I) and no decision changes by construction (`unitLength` equals the units `cellWork` sums, so each stage is an
upper bound of the exact charge; the jest property test and four recorded mutations, `mutations.txt`, pin it). Groups A-D carry
the anchored forms of every HEL-1697 pattern, and the unanchored path (`cellWorkBound` non-anchored branch) is unchanged code.

## Rerun

The first final run of group H had two rows at 20.7 and 21.3 ms (exec itself was 16.2 ms in those rows, against 13.8 in the
rerun: a noisy moment on a shared desktop); the one allowed rerun measured 18.5 ms worst and is the table above. Both logs are
kept (`calibration-logs/final-H.log`, `final-H-rerun.log`).

## Verdict

The group-H shape is under 20 ms (worst anchored row 18.5 ms, 36.2 ms before), dense unpaired-surrogate frames are not slower
than main (worst +0.43 ms), and no decision changes. The group-H shape is removed from the accepted-risk list.
