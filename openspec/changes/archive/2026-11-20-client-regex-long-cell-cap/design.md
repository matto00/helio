## Context

`compileJavaRegex` (frontend/src/features/pipelines/evaluator/javaRegex.ts) accepts a pattern when it tokenizes and
`isBacktrackBounded` (javaRegexCost.ts) holds. Declines are config-only today: `StepHandler.declines(config, ctx)` sees
no rows, and `evaluateStep` (evaluateStep.ts) returns `needsServer` for them; `evaluatePipeline` already routes a
`needsServer` node to the server draft preview. Accepted patterns are at most quadratic per cell, but quadratic is
enough to freeze the tab. Measurements (reference machine, V8, 1,000 rows, best of 3, `.concertino/scratch/HEL-1697/`):

| pattern (cell)                | 250 ch  | 500 ch   | 1,000 ch  | 2,000 ch   |
| ----------------------------- | ------- | -------- | --------- | ---------- |
| `a*b` (a...)                  | 30.5 ms | 130 ms   | 484 ms    | 2,076 ms   |
| `([a-z]+)-([a-z]+)` (a...)    | 34 ms   | 145 ms   | 571 ms    |            |
| `x(a*)$`-shape `(a*)$` (a..!) | 81 ms   | 317 ms   | 1,255 ms  |            |
| `(a+)`, `(.*)` (a...)         | 0.2 ms  | 0.3 ms   | 0.4 ms    | 1.0 ms     |

Every start position costs up to the pattern's mandatory per-start work: `(a+)` is cheap because that work is 1, but
`(a{1000})b` (3.8 s at 2,000 ch), `(.{1000})x` (3.1 s), `(\w{100})x` (370 ms) and a wide atom with a large `min`
and no tail, `(a{1000,})` on 999-`a` runs (2.0 s), are all len x n per cell (skeptic-design-1.md). A wide quantifier
with a tail additionally re-runs the tail per give-back: len^2.

## Goals / Non-Goals

Goals: no accepted client regex step blocks the main thread past the long-task threshold on long cells; decision is
deterministic and unit-testable without wall-clock; corpus unchanged; javaRegex.ts under ~250 lines; spec tidy.
Non-goals: Worker evaluation, server changes (HEL-1690), per-walk budget, a narrower Rule W.

## Decisions

### D1. Item 1: a predicted-work budget over the actual input frame, not a Worker time budget

Chosen: a data-dependent decline. Rejected: a Worker time budget. A Worker needs the frame structured-cloned per edit
(up to 20,000 rows), an async step result inside today's synchronous incremental walk (evaluatePipeline.ts), and a
terminate-and-respawn on overrun; it also makes the decision wall-clock dependent (CI-unstable, machine-dependent). The
budget is deterministic, O(rows) to compute, and routes over-budget steps to the path that already exists (server
draft preview, same rows as a real run). A per-cell length cap alone was rejected too: cost scales with rows x len^2,
so a per-cell cap does not bound a 1,000-row frame (1,000 x 499 chars of `a*b` is still 130 ms).

Model (every accepted pattern is charged; no zero multiplier). Two pattern constants from the `isBacktrackBounded`
tree: `F = altsPaths x max(1, W)` where `W` is `altsWeight` with a wide atom weighing `max(1, min)` (not 1), so counted
atoms and large `min`s count; and `m = max over wide atoms that have at least one item after them in their branch
(by item presence, anchors included, after enclosing groups) of paths x max(1, tail)`, else 0. Per cell of length
`len`: `cost = len x min(len, F) + m x len^2`.

Cycle-2 refinement (evaluation-1.md non-blocking finding: at 1,000 rows every wide-with-tail pattern declined at
~77-character cells, e.g. `(\d+\.\d+)` and `([A-Z]+)-(\d+)` on ordinary text that V8 runs in 0.1-0.2 ms, which would
silently move most real drafts to the slower server path). Charge runs, not cells: let `U` be the union of the sets
of every atom in the pattern (the characters any match attempt can consume). An attempt that starts at a character
outside `U` fails at once, and an attempt that starts inside a maximal `U`-run never consumes past it (plus the one
character after it, which it only inspects). So per cell: `cost = len + sum over maximal U-runs of length R of
(R x min(R, F) + m x R^2)`, the original per-cell formula applied to each run as if it were its own cell, plus one
unit per character for the scan. This is sound by the same argument the round-2 skeptic accepted per cell, and it is
never larger than the cycle-1 formula. Runs are computed in one O(len) pass per cell over code points (a run length
counts UTF-16 units, matching `len`). `.`/`\S`/negated-class patterns keep `U` near-universal, so `(.*)x` on long text
is still charged in full: that is the real worst case, not an over-estimate. Optional start-anchor refinement: only
if measured on the reference machine that V8 attempts a `^`-led pattern (every top-level alternative led by `^`,
non-multiline) at position 0 only, charge such a pattern one attempt per cell (the first `U`-run, `R0 x (1 + m) + F`)
and add `^(.*)$`, `^(a*)b` to the calibration list; otherwise omit it and say why. Re-run the calibration with the
refined cost (ratios can only rise for cases where the run-based cost is lower) and re-derive the budget; add
realistic-text shapes (1,000 rows of 80-200 char mixed text) to the calibration table to record the new threshold.
Record in the PR body the threshold at which typical patterns now go to the server.

Unpaired surrogates (skeptic-design-3.md CR1, remedy (b)): V8 runs `.`/negated-class counted patterns ~2x slower per
unit on lone surrogates (5.3-5.9 ns/unit vs the 2.957 calibrated max). The run scan decodes with `codePointAt`,
steps 2 only for a real pair, and counts each unpaired surrogate code unit as `LONE_SURROGATE_UNITS = 2` units of run
length and of `len` (so its quadratic charge is 4x). Calibrate: add lone-high and lone-low surrogate cells for
`(.{12})x`, `(.{16})x`, `(\S{16})x`, `(\D{16})x`, `[^a]{16}x` (repro `.concertino/scratch/HEL-1697/skeptic3/lone.cjs`)
to the calibration table; confirm their ratio under the charged cost is <= the max ratio of the other rows, else raise
the charge until it is (never lower the budget for it). Jest: an over-budget lone-surrogate frame declines, red with
the charge set to 1. Anchor refinement eligibility is decided on the flattened tree; Jest cases `(^a*)b` and
`^a*b|^c` (eligible), `^a*b|c*d` (not eligible).
Step cost = sum over the step's input rows, `len` = UTF-16 length of
the `anyToString` value of `field`, null/absent cells skipped. Decline with the new `ClientDeclineReason`
`regexInputCost` when step cost > `REGEX_WORK_BUDGET`. Pinned readings: item presence is judged after `flatten`;
a wide atom inside a tail weighs 1 in `tail` (as HEL-1683's `collectWides`), since F already charges its `min`. Wide stays as HEL-1683 defined it (unbounded or > 16 extents).
(Cycle-1 note, superseded by addendum 3: under the run model `(a+)` over 1,000 x 2,000 all-`a` cells costs 4e6 units,
and 2e6 on cells outside `U`.)

Budget: `REGEX_WORK_BUDGET` is set so the predicted step time is <= 20 ms on the reference machine: calibrate
`ns per unit` as the MAX measured ratio time / cost over this finite calibration list, each confirmed accepted by
`compileJavaRegex` and run on its worst-case cell shape (2,000-char cells, 1,000 distinct row strings): `a*b`,
`([a-z]+)-([a-z]+)`, `(\d+\.\d+)`, `(a*)abcd`, `(a*)$`, `<(.+?)>`, `(a+)`, `(a{1000})b`, `(a{1000,1015})b`,
`(.{1000})x`, `(\w{100})x`, `(a{1000,})` on 999-`a` runs, `(a{0,7})b`, `(\S{16})x` and `(.{500})x` on astral
(surrogate-pair) cells, plus two accepted Rule N edge patterns the
executor finds (one with paths > 1 near `MAX_COST`, one unfenced wide near `MAX_TAIL_COST`), then
`budget = floor(20 ms / max ratio)`, rounded down to a readable constant. 20 ms leaves headroom under the 50 ms
long-task threshold and the e2e 100 ms bound on a slower CI runner (2-3x). Record the calibration table in
`.concertino/runs/HEL-1697/evidence/regex-work-calibration.md` and cite it in a code comment (no wall-clock in Jest).

Wiring: add optional `declinesInput?(config, input: Frame, ctx)` to `StepHandler`; `evaluateStep` calls it after
`problems` and before `apply`, returning `{ status: "needsServer", reason }`. `clientEvaluable` (config-only) is
unchanged, so the parity test's `clientEvaluable` assertions and every corpus vector are unaffected. The cost model
lives in javaRegexCost.ts (exported `regexWorkModel(tree): { perStart: F; quadratic: m }`), and `compileJavaRegex`
returns it alongside the RegExp (cached with it).

Per-step, not per-walk: each extractRegex step is bounded at ~20 ms; a walk recomputes only the edited step and its
dependents (evaluatePipeline.ts), so k heavy regex steps cost <= k x 20 ms. A per-walk shared budget would make a
step's client/server outcome depend on which other steps happened to recompute in that walk; not worth it here.

### D2. Item 2: no narrower Rule W (recorded, not implemented)

`(\d+)\s*items` is pinned `clientDeclines: "unsafeRegex"` in
`shared-test-fixtures/pipeline-step-parity/stringops.json` (line ~1029); accepting it would change the corpus, which
the AC forbids. The "cheap" patterns are not cheap on long uniform cells: `(\d+)\s*items` 123 ms and `(\w+)\s*$`
474 ms per 1,000 rows of 500 characters (vs `a*b` 130 ms). The latency cost of declining is the existing server
draft-preview round trip, which already serves every declined step. Record this in the PR body.

### D3. Item 3: split the class parser

Move `readClassEnd`, `parseClass` and the constants/helpers they alone use into `javaRegexClass.ts`; `javaRegex.ts`
imports `parseClass`. Behaviour-preserving: no change to any test expectation; javaRegex.ts must end <= 250 lines.
Shared helpers (`Decline`, `isSurrogate`, `ESCAPED_META`, `SIMPLE_ESCAPES`, `SPACE_CLASS_BODY`) move to whichever
module avoids an import cycle (the class module may own them and `javaRegex.ts` import them).

### D4. Item 4 and the probe (e2e/hel1683-regex-main-thread.spec.ts)

- Replace the stale "~165 ms per cell" header text with what is true now (cite the HEL-1683 measurement as the
  original number or re-measure; no unverified figure).
- The overrun locator (`exceeded the 2 s regex time budget`) is filtered on `OVERRUN_PATTERN`, like the probe's.
- The live branch also asserts the server's `out` cells are empty for both rows (the probe pattern matches nothing).
- New test in the same file: a single-quantifier long-cell probe (`(a*)b` over long `a...` cells sized so the client
  would take >= 10x the 100 ms bound locally (measured, with margin) while the source stays a small static source); same longtask-window
  method; asserts longest task <= 100 ms and that a draft-preview request was made (decision evidence), and accepts
  either server outcome (live rows or the time-budget error) as the existing probe does.

## Risks / Trade-offs

- The model is conservative (overestimates `<(.+?)>`, mismatching tails, large fenced tails); with `.`-like sets it
  still charges whole cells, so `(.*)x`-style drafts over 1,000 rows of long text go to the server: some cheap steps on long cells go to the
  server. Acceptable: same rows, server latency.
- Calibration is machine-specific; the 20 ms target leaves 2.5x headroom to the long-task threshold.

## Planner Notes

- Self-approved: D1 choice (ticket offers it), budget target 20 ms, new reason name `regexInputCost`, per-step scope.
- If a `ClientDeclineReason` switch elsewhere is exhaustive, add the new member there; it is not user-visible copy.
- If any corpus file would have to change, stop and escalate; do not edit the corpus.

### D1 addendum (skeptic-design-4.md): two-byte strings set the calibration max

V8 runs `.`/negated-class counted patterns 4.2-6.4 ns/unit on any two-byte string (Cyrillic, CJK, ASCII plus one em
dash, or an ASCII cell sliced from a two-byte parent), above every one-byte and astral row. The representation is not
always observable from content (sliced cells come from earlier client steps), so remedy (a): no per-cell two-byte
charge; instead add rows for `(.{8})x`, `(.{12})x`, `(.{16})x`, `(\S{16})x`, `(.{100})x`, `(.*)x` on Cyrillic, CJK,
ASCII + one em dash, and a two-byte-slice ASCII cell (repro `.concertino/scratch/HEL-1697/skeptic4/twobyte2.cjs`),
plus the lone-surrogate rows (lone high, lone low, mixed `\uD800a`/`a\uD800`, `(.{12})x` on lone high), and derive
`REGEX_WORK_BUDGET = floor(20 ms / max ratio over ALL rows)` (expected about 3.9-4.3e6). The lone-surrogate charge
is kept only if the UNCHARGED lone rows exceed that max; record which way it went in the calibration file and drop
the charge (and its Jest test) otherwise. Re-measure the ordinary-text threshold for the PR body after this.

### D1 addendum 2 (skeptic-design-5.md): class width

V8 tests a class with many ranges per character much more slowly (16-range negated ASCII class 5.6-8.4 ns/unit;
3,000 ranges 13-14 ns/unit). Range count is pattern-only and deterministic, so remedies (b)+(c) combined:
- `r` = the number of ranges in an atom's merged `Ranges` set (`set.length` after `unionSets`/`complementSet`, the
  normalized sorted disjoint list `javaRegexSets.ts` already produces; `.`, `\S`, `\W`, `\D` count their complement's
  ranges).
- (c) An atom with `r > 64` declines the pattern as `unsafeRegex` at compile time (config-level, so `clientEvaluable`
  sees it). Show with a script over every corpus pattern that the max `r` in the corpus is far below 64 and that
  `git diff main -- shared-test-fixtures` stays empty.
- (b) For `r <= 64`, each atom's per-character work is multiplied by a calibrated class-width factor
  `classFactor(r)` (a step function: 1 for `r <= 8`; calibrated values for 9-16, 17-32, 33-64), applied to that
  atom's contribution to `W` and, for wide atoms, to `m` (the tail term uses the factor of the atoms in the tail).
  Calibration rows: `([^<N ranges>]{16})x` and `([^<N ranges>]*)x` for N in {16, 32, 64} on one-byte, Cyrillic, and
  ASCII-plus-em-dash cells (repro `.concertino/scratch/HEL-1697/skeptic5/classes.cjs`, `ascii.cjs`); pick each factor
  so its rows' charged ratio is <= the max ratio of the other rows. Jest: a many-range-class frame declines, red with
  the factor forced to 1; a 65-range class is `unsafeRegex`, red with the cap removed.

Finite calibration (what the 20 ms target means): the target holds for every row of the recorded calibration list
(D1, both addenda), measured on the reference machine. It is not a claim about every conceivable V8 constant factor;
any shape later found above the 50 ms long-task threshold at the budget is a defect to add as a row, while smaller
constant-factor deviations are an accepted risk, recorded in the calibration file.

### D1 addendum 3 (skeptic-design-6.md; owner ruling: continue-model)

Final cost formula, per cell, with `R` the maximal `U`-runs (lone surrogates charged per the D1 addendum), `F` and
`m` as before but with `W` and `tail` computed WITHOUT any class factor, `A = altsPaths` of the flattened tree, and
`f = max over the pattern's atoms of classFactor(r)` (1 for `r <= 8`, calibrated for 9-16, 17-32, 33-64; `r > 64`
is `unsafeRegex`):

`cost = f x (A x len + sum over runs of (R x A x min(R, max(1, W)) + m x R^2))`

so neither the class factor nor the alternative count is clipped by the per-run cap (CR1, CR2). `F` is no longer
used in the run term (`A x min(R, W)` replaces `min(R, A x W)`); `m` already carries `paths`. The anchor refinement,
if shipped, becomes `f x (A + R0 x (1 + m) + A x max(1, W))` per cell. Calibration adds short-run rows (R = 1, 4, 16,
runs separated by one character outside `U`) for `([^<N>]{16})x` with N in {16, 32, 64} and for the two- and
three-alternative forms `[^<N>]{16}x|[^<N>]{16}y(|[^<N>]{16}z)` and `(.{16})x|(.{16})y|(.{16})z` (repro
`.concertino/scratch/HEL-1697/skeptic6/alts2.cjs`, `alts3.cjs`), plus the long-run rows already listed; the budget
is `floor(20 ms / max ratio over all rows)`. Every row of skeptic-design-6.md's table must land at <= 20 ms at the
re-derived budget; a row that lands between 20 and 50 ms is recorded as accepted risk (standing constraint C1); any
row over 50 ms is a defect. Jest: a three-alternative short-run frame declines (red under the old `min(R, F)` clip),
and a 64-range short-run frame declines (red with the factor applied inside `F`, or forced to 1).

### D1 addendum 4 (skeptic-design-7.md)

- CR1: the per-character scan is charged once per alternative (`A x len` above): V8 tries every alternative's leading
  item at each position, including characters no atom consumes. Calibration adds rows on cells made only of characters
  outside `U` (1,000 x 2,000): 16 alternatives `[^<7 pts>]{3}E_k`, 16 alternatives `[^<63 pts>]{3}E_k`, 32 alternatives
  `[^<63 pts>]E_k`, 8 alternatives `[^a]{7}E_k` (repro `.concertino/scratch/HEL-1697/skeptic7/nonu2.cjs`,
  `fixcheck.cjs`). Jest: the 16-alternative factor-1 frame of excluded characters declines, red with the scan charged
  1 per character.
- CR2: the derived `REGEX_WORK_BUDGET` must be >= 4.00e6, the cost of the spec's `(\d+)` over 1,000 x 2,000 digit
  cells (`regexInputCost.test.ts`), so that frame stays client-side. Record the margin in the calibration file. The
  constant is pinned once from the calibration run (not re-derived per run). If the measured derivation falls below
  4.00e6 (skeptic-design-8.md predicts 3.2-4.0e6), pin `REGEX_WORK_BUDGET = 4.00e6` under standing constraint C1
  provided every calibration row and every row of skeptic-design-6/7/8.md's tables measures <= 50 ms at 4.00e6;
  record each row over 20 ms as C1 accepted risk in the calibration file and the PR body. If any row exceeds 50 ms
  at 4.00e6, stop and escalate; never edit the scenario or test frame to fit. Record 64 alternatives of r=8 single
  negated classes on two-byte excluded cells (29-34 ms) as C1 risk, not as a calibration row.
