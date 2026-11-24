## Context

See proposal.md - Why, and the premise validation (`.concertino/runs/HEL-1836/evidence/premise-validation.md`, with
`probe-bounds.txt`, `probe-time.txt`, `probe-table.txt`, `probe-lever.txt`, `main-H.txt`, `main-D.txt` and their `.cjs`
probes in the main checkout's `.concertino/runs/HEL-1836/evidence/`; the round-1 design skeptic's probes are under
`.concertino/runs/HEL-1836/evidence/.concertino/scratch/HEL-1836/skeptic-design/`).

For an unanchored pattern `workExceedsBudget` has two stages: stage 1, the closed-form `cellWorkBound` (non-anchored branch:
`L = 2 x text.length` if `LONE_SURROGATE.test(text)`, else `text.length`); stage 2, the exact `cellWork` scan
(`perPositionWork`), which runs only when stage 1's sum exceeds `REGEX_WORK_BUDGET`. `perPositionWork` reads every code
point with `codePointAt` and tests it with `inRanges` (a binary search over `work.chars`).

For a W=1/m=0 pattern (`(x)`, `([^a]+)`, `(.+)`, `(\S+)`: A=1 W=1 m=0 f=1) the stage-1 bound is `2L` against an exact
`A x len` on a cell with no class character. No closed form that does not look at the characters can be tighter (a cell
made entirely of class characters has exact charge `2L`), so every frame whose exact charge is in (2e6, 4e6] is scanned.

Measured on main (decision = shipped `workExceedsBudget`; exec = `RegExp.exec` over the frame), frames at exact charge
4.000e6, decision `false`:

| shape | main decision + exec |
|---|---|
| `(x)` on cyr + one lone surrogate at the end (group H) | up to 27.2 + 1.7 = 28.8 ms |
| `(x)` on surrogate-free cyr (no calibration group) | 25.5-28.2 + 1.5 ms |
| `([^a]+)` on `a` x 3,999 + one CJK char (non-member body, no calibration group) | 28.1-29.5 + 11.9-12.3 = 40.0-41.7 ms |
| `(.+)` on `\n` x 3,999 + one CJK char | 32.8-33.0 + 11.1-11.5 = 43.9-44.5 ms |
| `(\S+)` on spaces x 3,999 + one CJK char | 39.3-39.5 ms |

| `([^acegikm]+)` (8 ranges, f = 1) on `a` + one CJK char, 1,000 / 20,000 rows | 33.0 + 12.7-13.1 = 45.7-46.1 ms |

These are the loosest unanchored shapes (design skeptic rounds 1-2): a negated class's own non-members give the most
characters per unit (f = A = 1, one unit per character, no runs, so 4e6 characters at the budget); exec is slower the
more ranges the class has, and `classFactor` (javaRegexCost.ts) keeps f = 1 up to 8 ranges, so the worst is the widest
f = 1 class (8 ranges, 7 excluded points); and one two-byte character makes the string two-byte, where V8's `u`-mode
exec of a class containing surrogates/astral is about 6-8x slower per position (exec alone 10-13 ms). They are under the
50 ms ceiling but appear in no calibration group or accepted-risk record (main's worst is about 46 ms, not the 28.8 ms
recorded); this change records them, with the exact numbers measured in calibration.md.

The decision cost splits into stage 1 (the per-cell `LONE_SURROGATE.test` regex scan, about 5 ms on these frames) and the
stage-2 scan (about 20+ ms). With exec at 10-12 ms, the decision must come in under about 8 ms for these rows.

## Goals / Non-Goals

**Goals:** every unanchored calibration row, including the added surrogate-free `(x)` and non-member-body shapes, measures
under 20 ms (decision + exec) at the budget; `cellWork` returns exactly today's number for every string and
`workExceedsBudget` returns exactly today's decision for every frame (by construction and by test); no other row gets
slower by more than noise. If a row cannot get under 20 ms with D1-D3, escalate with the numbers (D6), never loosen.

**Non-Goals:** the anchored path (`anchoredCellWork`, `testedBound`, `lengthBound` and stage order for anchored patterns)
-- left as HEL-1823 shipped it; the cost formula and constants; `REGEX_WORK_BUDGET`; the parity corpus; the group-D
`(.{16})x` control (exec-only V8 timing on a 9x-budget frame, 19.0-21.4 ms run to run: reported only).

## Decisions

**D1 - Faster exact scan, same charge.** `perPositionWork` reads UTF-16 code units with `charCodeAt`. A code unit outside
`U+D800-U+DFFF` is one unit and its membership is `table[c]`; a valid high-low pair is one astral code point of two units
whose membership is `inRanges(chars, cp)` (as today); any other surrogate code unit (lone high, lone low, reversed pair,
high at the end) is an unpaired surrogate of `LONE_SURROGATE_UNITS` units whose membership is `table[c]` (today
`inRanges(chars, c)` for the same value, since `codePointAt` returns the code unit itself there). `table` is a
`Uint8Array(0x10000)` with `table[c] = 1` exactly when `inRanges(chars, c)`: `chars` is sorted, merged and disjoint
(`normalize` in javaRegexSets.ts), so filling `[lo, min(hi, 0xFFFF)]` for each range with `lo <= 0xFFFF` gives the same
answer for every BMP value. Built lazily (only when stage 2 scans; measured at about 0.01 ms) and cached per `chars` array
in a `WeakMap`; the compile cache holds `chars` strongly, so a table lives as long as its compiled pattern (64 KiB per
pattern that reaches stage 2). The run/len arithmetic is unchanged, so the charge is identical for every string.

**D2 - Skip stage 1's per-cell surrogate test when it cannot avoid the scan (unanchored patterns only).** The anchored
path keeps HEL-1823's stage order unchanged. For an unanchored pattern, before stage 1, sum the length-only bound
`boundAt(work, text.length)` (no per-cell test, no read of the characters; the unanchored analogue of HEL-1823's
`lengthBound`). If that sum already exceeds the budget, go straight to the exact scan. Decision-identical because the
stage-1 bound of each cell is `boundAt(work, L)` with `L >= text.length` and `boundAt` is non-decreasing in `L` (each term
`A x L`, `L x A x min(L, W)`, `m x L^2` is, for `A, W, m, f >= 0`), so the stage-1 sum is at least the length-only sum:
when the latter is over the budget stage 1 could not have skipped the scan, and dropping it changes nothing. When it is
within the budget, stage 1 runs as today (see D3). Probe (`probe-lever.txt`, main's modules plus D1 + D2): decision
6.7-6.8 ms on every shape in the Context table, totals 17.0-19.1 ms on the non-member rows and 8.1-8.4 ms on `(x)`, with
charges equal to today's on every frame.

**D3 - Stage 1 uses the exact unit length (the original ticket's rule), measured.** In the non-anchored branch of
`cellWorkBound`, `L = unitLength(text)` (HEL-1823's helper: `isWellFormed` gate, then a `charCodeAt` count of unpaired
surrogates) replaces `LONE_SURROGATE.test(text) ? 2 x len : len`. A true upper bound because `unitLength` is exactly the
`len` `perPositionWork` sums, runs sum to at most it, and each term is monotone (the HEL-1823 argument, written in the
doc comment). It never exceeds today's `L`, so no frame's stage-1 sum rises; it only lets more lone-surrogate frames skip
the scan. Keep it only if calibration shows no row slower than main by more than noise (in particular dense
lone-surrogate cells, group I); otherwise keep today's stage-1 test and record why.

**D4 - Failing-first tests, deterministic, no timing assertion.** In `regexInputCost.test.ts` (or
`regexCellWork.test.ts`), counting `String.prototype.codePointAt` calls with a plain counting override restored in
`finally` (not `jest.spyOn`, which records each of ~4e6 calls): (a) the worst unanchored `(x)` group-H shape -- `(x)`
over cyr cells with one trailing `\ud800`, sized so the exact sum is exactly 4.000e6 -- and the surrogate-free cyr `(x)`
frame and the `([^a]+)` non-member frame each decide `false` with zero `codePointAt` calls, and one more unit is declined.
Red on main (main reads every code point with `codePointAt`). (b) A stage-1-skip test: on the `([^a]+)` frame the
stage-1 per-cell surrogate test is not run. The seam must be one stage 1 actually goes through after D3:
`hasNoLoneSurrogate` captures `String.prototype.isWellFormed` at module load, so a counting override installed after
import counts nothing; install the override before the module loads (`jest.isolateModules` or a dynamic `require` after
the override) and count `isWellFormed` (and `RegExp.prototype.test` for the fallback) calls, or export a test-visible
stage-1 counter. Show the seam is live: the same test on a frame where stage 1 does run (length-only sum within the
budget) counts one call per cell. Red on main (main runs `LONE_SURROGATE.test` per cell). (c) An equivalence property
test: a reference copy of today's `perPositionWork` and of today's two-stage `workExceedsBudget` kept in the test file,
compared with the shipped `cellWork` and `workExceedsBudget` on generated cells (seeded, deterministic, and including
for every pattern each range's `lo - 1`, `lo`, `hi`, `hi + 1` and U+FFFF / U+10000 for the class straddling U+FFFF, so
the table range-end mutations are caught reliably) mixing ASCII, two-byte, astral pairs,
unpaired highs/lows at any position (start, end, adjacent, reversed pair `\udc00\ud800`), and patterns whose class
includes surrogates (`(.+)`, `([^a]+)`, `(\S{16})x`), an astral class, a class with ranges straddling U+FFFF, `(x)`,
`(\d+)`, `a*b`: equal charge for every cell and equal decision for every frame, including frames sized at the budget
boundary. Red run committed as `.txt` (or recorded if the hook refuses) before implementation. Mutations, each must turn
a test red and be recorded in `mutations.txt`: revert the scan to `codePointAt` + `inRanges`; treat a pair as a
non-member or look its high unit up in the table; charge an unpaired surrogate 1 unit; table with an exclusive range end;
skip the first range; D2 pre-check with `2 x text.length` (a D2 mistake cannot change a decision, since the fallback is
always the exact scan, so it must be caught by a cost-path test: add (d) a surrogate-free frame that stage 1 admits,
e.g. `(x)` on cyr at exact 2.0e6, is decided `false` with no scan -- zero `charCodeAt` calls -- and the mutation scans
it); delete the D2 pre-check entirely while keeping D3 (caught by (b)); D3 dropping the lone count (caught by the property test's charge >= bound check, D4 (c), which must also assert
stage-1 bound >= `cellWork` per cell).

**D5 - Calibration.** Copy `calibrate-anchored.mjs` from `openspec/changes/archive/2026-11-22-anchored-surrogate-stage2-bound/`
into this change dir. Group J (new): unanchored patterns `(x)`, `(\d+)`, `([^a]+)`, `([^a]*)`, `(.+)`, `(\S+)`, the widest f = 1 negated
class `([^acegikm]+)` (8 ranges), its two-byte twin `([^жикморт]+)`, and the 64-range negated class (f = 2, a control),
each on (i) its loosest body -- its own non-members (`a` for `[^a]` and `[^acegikm]`, `ж` for `[^жикморт]`, `\n` and
space for `.`, space for `\S`, the excluded points for the 64-range class, a two-byte non-digit for `(\d+)`, cyr for
`(x)`) made two-byte by one CJK tag where the body is one-byte, plus a one-byte control with no tag; (ii) member bodies (cyr, cjk, astral); each with no unpaired
surrogate, one at the start and one at the end; 1,000 and 20,000 rows; frames sized by the same bisection so the exact
charge is at most 4.00e6. Why this is the loosest set: maximum characters per unit (f = A = 1, no runs) at the largest range
count that still has f = 1 (8, per `classFactor`), in a two-byte string under a surrogate-bearing class, where exec is
slowest; plus the narrow-class `(x)` shape where the decision scan dominates. Every row times the shipped `workExceedsBudget` (all stages) plus exec, best of 7, and prints DECISION-DIFF
against the summed exact charge and COST-DIFF against a reference copy of main's `perPositionWork`. Run groups A-I and J
on this change, and groups H, I and J on main ("before": a `git worktree add` of b2da43a3d or `git checkout <sha> --
<paths>` into a scratch checkout; never copy a worktree), one group per Bash call (each under 10 min, `nice -n 19`),
output under the main checkout's `.concertino/scratch/HEL-1836/`. Record in this change's `calibration.md`: per-group
maxima, H/I/J before/after tables, decision identity (no DECISION-DIFF, no COST-DIFF, no MISMATCH), rows more than 3 ms
slower than before (expected none), the table-build cost, main's previously unrecorded non-member rows (about 46 ms worst, exact numbers measured), and
the group-D control reported as exec-only noise.

**D6 - The 20 ms rule and escalation.** Probes put the non-member rows at 17.0-19.9 ms with D1 + D2 (exec alone
10.4-13.1 ms; the 8-range class at 19.4-19.9 ms), within noise of 20 ms, so D6 will likely be exercised; record every run. If, after one allowed rerun of a noisy group, any row is over 20 ms, the executor may tighten the scan
loop (still charge-identical, pinned by D4 (c)); if a row still exceeds 20 ms, stop and report it to the orchestrator
with the per-row decision and exec numbers so the orchestrator escalates to the owner. No bound may be loosened, no
constant changed.

**D7 - e2e.** `e2e/hel1683-regex-main-thread.spec.ts` (the `@prod-build` long-task checks) via `npm run e2e:prod-build`, in
full, passes; transcript saved as evidence. Servers per the brief (stop-servers.sh, then `scripts/e2e-backend.sh
lane-start` with the lane `DATABASE_URL` for `helio_hel1836`, `DB_USER=$USER`, empty `ANTHROPIC_API_KEY`, then
stop-servers.sh).

## Risks / Trade-offs

- [Table and the old binary search disagree on an edge] -> D4 (c) property test against a reference copy plus mutations;
  COST-DIFF over every calibration row.
- [D2 changes a decision] -> monotonicity argument above; D4 (c) compares decisions with the reference two-stage function,
  including frames at the budget boundary; DECISION-DIFF on every calibration row.
- [Rows land within noise of 20 ms] -> D6: rerun once, tighten the loop, else escalate with numbers.
- [Timing noise on a shared desktop] -> best-of-7, `nice -n 19`, one rerun per noisy group.

## Planner Notes

- Self-approved: no spec delta (`skip_specs: true`): the requirement text is unchanged, only the accepted-risk list changes.
- The original ticket premise (apply the exact-length rule) was refuted; the owner chose `proceed-with-restated-scope`
  (escalation answered 2026-11-24). The PR body must carry this scope note, cite premise-validation.md, and report main's
  previously unrecorded non-member rows, about 46 ms worst (task 3.5).
- Design-gate round 1 (REFUTE) addressed: non-member bodies in group J (CR1), D1 no longer claimed sufficient alone and a
  second lever D2 measured (CR2), calibration times the shipped decision plus exec (CR3), main's unrecorded rows reported
  (CR4), AC4 task added (CR5); counting override instead of `jest.spyOn` and the WeakMap lifetime corrected (notes).
- Design-gate round 2 (REFUTE) addressed: the 8-range f = 1 class added to group J and to the loosest-set rationale
  (CR1); main's unrecorded maximum corrected to about 46 ms (CR2); D2 scoped to unanchored patterns (CR3); a live seam for
  (b) and a "delete D2" mutation (CR4); deterministic range-endpoint seeding in (c) (note).
- The HEL-1823 archive is history and is not edited; this change carries its own calibration.
