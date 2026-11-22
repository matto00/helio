## Context

`compileJavaRegex` (`frontend/src/features/pipelines/evaluator/javaRegex.ts`) emits `^` unchanged and builds
`new RegExp(source, "u")`: no `m` flag, and every `(?` (inline flags such as `(?m)`) is declined as `unsafeRegex`.
So a client-accepted `^` always means start of input. `regexWorkModel` (`javaRegexCost.ts`) returns
`{A, W, m, f, chars}`; `regexInputCost.ts` charges per cell `f x (A x len + sum over U-runs R of (R x A x min(R, W) +
m x R^2))` against `REGEX_WORK_BUDGET = 4.00e6`, with `cellWorkBound` as a closed-form upper bound used to skip the
exact scan (`workExceedsBudget`). HEL-1697 recorded (`.concertino/runs/HEL-1697/evidence/regex-work-calibration.md`,
"Anchor refinement ... NOT shipped") that V8 anchors `^`-led patterns (0.1-2.4 ms) but left the refinement out.

## Goals / Non-Goals

Goals: fully start-anchored patterns charged for one attempt per cell, backed by committed calibration; AC test
red first; every HEL-1697 shape keeps its decision; parity corpus and budget unchanged; e2e long-task bound holds.
Non-goals: multiline client-side, `$`-end refinement, budget change, Worker, server.

## Decisions

### D1. Eligibility: every top-level alternative of the flattened tree is start-anchored

`startAnchored(alts)` on the `flatten`ed tree (eligibility is decided after `flatten`, never on the raw tree): true
iff every alternative's first item is a non-dollar anchor, or a group whose `alts` are all `startAnchored`. So
`(^a*)b`, `^a*b|^c`, `(^a|^b)c` and `()^a` qualify (`flatten` inlines the empty group; V8 anchors `()^(a*)b`,
skeptic-design-1.md); `^a*b|c` (partly anchored), `(a)^b` and `(.*)^(x)` (a consuming item precedes `^`) do not.
Exposed as a new `RegexWork` field `anchored: boolean`. Partly anchored patterns keep the per-position charge: V8
tries the unanchored alternative at every position (skeptic-design-1.md: `^(a*)b|(c)` is not anchored). Multiline
is not reachable (inline flags decline; `RegExp(..., "u")`); a Jest guard pins `(?m)^(.*)$` as `unsafeRegex`
(labelled a guard, not a red test). If calibration shows V8 does not anchor some eligible form, narrow eligibility
to the measured forms and record why; if no form qualifies, ship nothing and escalate.

### D2. Charge: one attempt per cell, never more than today (standing constraint C1)

For `anchored` patterns, per cell: `min(anchoredCost, perPositionCost)`, where `perPositionCost` is today's
`cellWork` unchanged and `anchoredCost = f x (A x (1 + W) + R0 x (A + m))`, `R0` the length of the `U`-run that
starts at the cell's first code point (0 when that code point is outside `U`), in UTF-16 units with the existing
lone-surrogate charge. Both are true upper bounds of the work (today's charges index 0 among all positions), so
the `min` is too, and no pattern is ever charged more than before this change (CR1: without the `min`,
`^(a{1000})b` over 10,000 rows of 10-character cells would go from 1.1e6 to 1.01e7). Reasoning for `anchoredCost`:
one attempt per alternative path, each paying its constant and mandatory per-start work (`A x (1 + W)`), consuming
at most `R0` characters per path (`A x R0`), plus one tail re-run per give-back of the single permitted unfenced
wide (`m x R0`; `m` already carries `paths`). `cellWorkBound` for anchored patterns is
`min(today's bound, f x (A x (1 + W) + L x (A + m)))`.

Decision-scan invariant (standing constraint C2; skeptic-design-2.md measured 80-120 ms when the anchored exact
path scanned whole cells for the `min`): the exact scan of `workExceedsBudget` SHALL read at most about the charge it
adds in characters, as HEL-1697's scan does today (it stops once the running total passes the budget, and today
every cell's charge is at least `f x A x len`). For an anchored cell, the exact path scans only to the end of its
first run (giving `R0` and `anchoredCost`). Since `perPositionCost >= f x A x text.length` (units are at least the
code-unit length), when `anchoredCost <= f x A x text.length` the `min` is `anchoredCost` and nothing more is read;
otherwise the full `cellWork` runs, which only happens when `text.length < anchoredCost / (f x A)`, so the
characters read stay within the charge. The bound phase must also respect the decision budget: if its per-cell
lone-surrogate test over the whole cell dominates the decision-scan rows (D3), the anchored bound uses the
surrogate-free worst case (`L = 2 x text.length`) instead of testing. The exact anchored path is exposed for test
through the production path `workExceedsBudget` actually calls (a read counter on that path, or equivalent, no
wall-clock), so the "always run the full scan" mutation edits that path and turns the test red. In the else branch, one
pass that collects `R0` and the per-position total together is preferred over re-reading the cell.
Non-anchored patterns: formula and
code path byte-identical to today. The `anchoredCost` constants may be raised if a calibration row needs it.
AC frame: `^(.*)$` (`A = 1`, `W = 3`, `m = 2`), 1,000 x 500 cells: 1,000 x (4 + 1,500) = 1.504e6 < 4.00e6.

### D3. Calibration (committed): `calibration.md` and `calibrate-anchored.mjs` in this change directory

Method exactly as HEL-1697: reference machine (Ryzen 5 7600X), node/V8, `nice -n 19`, 1,000 distinct rows per case
(shape plus a 4-digit suffix), best of 3 `exec` passes, cost from the real `compileJavaRegex(...).work` and the
shipped (new) `cellWork`, every pattern confirmed accepted and its `anchored` value recorded. The "anchored form" of
a pattern puts `^` before EVERY top-level alternative (`^(.{16})x|^(.{16})y|^(.{16})z`, not `^` prepended once).
Cell shapes: every HEL-1697 shape (`a...`, `1...`, `abcd...`, `a..!`, `<a...`, `(a*999!)x2`, astral, Cyrillic,
CJK, ASCII + em dash, two-byte slice, lone high, lone low, 2,000 chars) and, for multi-alternative rows, cells made
only of characters outside `U` (HEL-1697 addendum 4). Rows:
- anchored forms of every HEL-1697 calibration and accepted-risk pattern that `compileJavaRegex` accepts, explicitly
  including the Rule N edges `(a?)(b?)(c?)(d?)` and `(a*)bcd`, the `(.{8})(.{8})x` Cyrillic risk row, the class-width
  rows (`([^<N ranges>]{16})x`, `([^<N ranges>]*)x`, N in 16/32/64), the 2/3-alternative rows, the 16/32-alternative
  excluded-character rows, and the 64-alternative r=8 negated-class row on two-byte excluded characters (the highest
  `A`, HEL-1697's accepted-risk outlier);
- `^(.*)$`, `^(.*)x`, `(^a*)b`, `()^(a*)b`, `(^(.*))$`, `^a*b|^c`, `(^(a*)|^(c))b` (D1's group branch, the one
  eligible form `flatten` keeps as a multi-alternative group);
- decision-scan rows (C2): `workExceedsBudget` plus `exec` timed together, as HEL-1697's final-gate section did,
  for `^(a*)b` on `c` + `a...` cells and `^(\d+)` on prose, at 1,000 x 20,000 and 10,000 x 2,000, plus the AC frame;
  each <= 20 ms or accepted risk up to 50 ms; and the scan's actual worst case (skeptic-design-3.md, 21-36 ms
  measured): two-byte cells whose first `U`-run covers almost the whole cell, sized so the anchored bound exceeds
  4.00e6 while the exact anchored charge stays at or under it: `^([^x]*)x` on `ж...` + `x` (`R0 = len - 5`) at
  1,000 x 2,000 and 20,000 x 100, `^([а-я]*)x` on `ж...` + `!!!!!!` at 20,000 x 100, and `^(\d+)` on two-byte
  (Cyrillic and CJK) prose at 1,000 x 20,000 and 20,000 x 200. Each row over 20 ms is recorded as accepted risk;
  any row over 50 ms is fixed in the scan (e.g. one pass that collects `R0` and the per-position total together
  instead of a first-run scan followed by a full `cellWork` re-read, or the surrogate-free bound), never by changing
  the budget. The D2 `L = 2 x text.length` fallback is decided on these two-byte rows, not the ASCII ones;
- partly anchored, charged with today's formula: `^(.*)x|y`, `^a*b|c`, `^(a*)b|(c)` (confirm per-position cost);
- multiline (JS `m` flag, measurement only): `^(.*)$`, `^(a*)b` on cells of many `\n`-separated lines;
- three HEL-1697 control rows (`a*b` on `a...`, `(.{16})x` on Cyrillic, `(a+)` on `a...`) to show the machine
  matches HEL-1697's numbers.
Verdict per row: ms at budget = ns/unit x 4.00e6. Every anchored row <= 20 ms; 20-50 ms recorded as accepted risk
(owner ruling C2 of HEL-1697); any row > 50 ms is a defect: raise the `anchoredCost` constants or narrow D1, never
the budget. Per-call-overhead rows are judged differently (extrapolating them to 4.00e6 is ill-posed: today's `()`
on 1-character cells is already ~84 ms "at budget" and reaching the budget would take millions of rows): measure
`^()` (the minimal charge: 0 units on an empty cell under the `min`, 1 on a 1-character cell), `^(.*)$` and `^(a{0,7})b` over empty and 1-4 character cells at
the frame cap (10,000 rows) and at 20,000 rows (the draft-node cap), and require the measured time itself <= 20 ms.
Split runs so each finishes under 10 minutes. Code comments cite
`openspec/changes/archive/<date>-anchored-regex-cost-refinement/calibration.md`.

### D4. Tests

- Jest red first (commit the red output as `red-run.txt` before implementation), in `regexInputCost.test.ts`:
  - AC (red today): `^(.*)$` over 1,000 x 500 `a` cells is `{ status: "ok" }` (charge 1.504e6), and a returned
    row's `out` equals its cell (the same rows as the server engine).
  - Scan bound (C2), failable by "always run the full scan": on a cell whose `anchoredCost <= f x A x len` (e.g.
    `^(a*)b` on `c` + 20,000 `a`), the anchored exact path reads at most `R0 + 1` code points.
  - Guard, failable by "partly anchored treated as anchored": `^(.*)x|y` over the same frame stays `regexInputCost`.
  - Guard, failable by "`R0` -> 0": `^(.*)x` (`A = 1`, `W = 2`, `m = 1`) over 1,000 x 2,000 `a` cells costs
    1,000 x (3 + 4,000) = 4.003e6 > 4.00e6, so it declines (declined today too).
  - Guard, failable by "drop the `min`": `^(a{1000})b` over 10,000 rows of 10-character `a` cells stays `ok` (1.1e6).
  - In `regexWorkModel.test.ts`: `anchored` is true for `^(.*)$`, `(^a*)b`, `^a*b|^c`, `()^a`; false for `^a*b|c`,
    `(a)^b`, `(.*)^(x)`, `(a*)b` (red today: the field does not exist).
  - `cellWorkBound >= cellWork` for anchored work on varied cells, including a first character outside `U`.
  - Guard: `(?m)^(.*)$` is `unsafeRegex`.
- Mutations (recorded in `mutations.txt`): eligibility forced false (AC red); `R0` -> 0; partly anchored treated as
  anchored; drop the `min`; eligibility "any anchor in the sequence" (`(a)^b` case red); always run the full scan (scan-bound
  test red). Each named test must go red.
- Unchanged: every existing test in `regexInputCost.test.ts`, `regexCellWork.test.ts`, `regexWorkModel.test.ts`,
  `javaRegex.test.ts` and the parity test; the shared-test-fixtures diff against the live review base
  (`resolve-review-base.sh`) is empty.
- e2e: a third test in `e2e/hel1683-regex-main-thread.spec.ts` reusing its `seed` helper and long-task window: an
  anchored pattern (`^(.*)$` or `^(a*)b`) over long cells that the unanchored charge would decline is client-evaluated
  (no draft-preview request, client rows rendered) with longest task <= 100 ms. Run it once on the pre-change model
  and record that it fails (a draft-preview request is made) before implementing; then run the full spec file.

## Risks / Trade-offs

- Calibration is machine-specific; the 20 ms target keeps 2.5x headroom to the long-task threshold (as HEL-1697).
- A V8 change that stops anchoring would make anchored drafts quadratic on the main thread; the e2e test is the
  browser-level tripwire.

## Planner Notes

- Self-approved: per-cell one-attempt charge form capped by today's charge (HEL-1697 design sketched `R0 x (1 + m) + F`; this form adds the
  per-alternative `A x R0` term), committed calibration location (HEL-1697's evidence dir is gitignored, the AC needs
  it committed), e2e anchored case.
- If any corpus file would have to change, stop and escalate.
