## Skeptic Report — design gate (round 8, skeptic-design-8.md)

Reviewed HEAD bd10d1767eb04e9467428155ed99c92554a01f11 plus the uncommitted design.md / spec.md / tasks.md revision
("D1 addendum 4 (skeptic-design-7.md)"). Standing constraints applied: C1 (a constant-factor slowdown under 50 ms per
step at the budget is accepted risk; over 50 ms blocks) and C2 (round 8 is the last design round).

Setup: Node v22, `nice -n 19`, one probe process at a time. Probes are in
`/home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic8/`. `lib8.cjs` uses the round-7 build of the
worktree's `javaRegex*.ts` (`skeptic7/js`, same HEAD). It implements the final formula literally, per cell:
`A x len + sum over U-runs (R x A x min(R, max(1, W)) + m x R^2)`, with `f = 1`. "raw ns/u" below means the measured
best-of-5 time divided by that cost. Outputs are in `*-run*.txt` next to each probe.

Converting raw ns/u to time at the budget: `ms@budget = raw ns/u x budget / f`.
- Budget 4.0-4.2e6 (the range the design derives): factor-1 rows reach 50 ms only above about 12 ns/u.

### What I verified (with evidence)

- **Round 7 CR1 is addressed, and the formula is precise.**
  - Addendum 3 reads `cost = f x (A x len + sum over runs (R x A x min(R, max(1, W)) + m x R^2))`. Addendum 4 says the
    scan is charged per alternative, including in the anchor variant `f x (A + R0 x (1 + m) + A x max(1, W))`.
  - The non-`U` calibration rows (four shapes, repro files named) and the Jest red test are specified.
  - Every term maps onto existing code in `javaRegexCost.ts`:
    - `A` is `altsPaths(flatten(root))`.
    - `W` is `altsWeight(alts, BY_MIN)`.
    - `m` is the existing `quadratic`.
    - `r` is `set.length` of each atom.
    - `U` is the union of the atom sets.
  - `lib8.cjs` computes all of these with one extra walk. Nothing is left to interpret.
- **Round 7 CR2 is addressed.**
  - The design states that the budget must be >= 4.00e6, that the margin is recorded, that the constant is pinned
    once, and that the run escalates if the derivation falls below 4.00e6. It does not allow editing the scenario.
  - The stale `(a+)` sentence now reads 4e6 on all-`a` cells and 2e6 on cells outside `U`. I checked this
    arithmetically: on all-`a` cells, `2000 + 2000 x 1 x 1 = 4000` per cell.
  - The `(\d+)` spec frame costs 4.00e6 under the final formula (`margin.cjs`, four runs).
- **Anchor variant: V8 really does anchor** (`search.cjs`).
  - `^(.{16})x` and `^(.{16})x|^(.{16})y` take 0.1 ms over 1,000 x 2,000 Cyrillic cells.
  - `(^a*)b` takes 2.0 ms and `^(a*)b|^c` takes 2.4 ms over 1,000 x 2,000 `a` cells.
  - So the measured precondition for the refinement holds, and it charges more than V8 spends.
- **Every row of skeptic-design-6.md's and -7.md's tables lands under 50 ms at the derived budget**
  (`r67.cjs`, `skeptic7/fixcheck-run1.txt`, `alt32.cjs`).
  - Factor-1 rows:
    - The three-alternative R=1/R=4 rows (`(.{16})x|..`, `.{16}x|..`, `[^a]{16}..`, `(\S{16})..`, `(\w{16})..`)
      measure 1.7-6.3 raw ns/u.
    - The skeptic-7 non-`U` rows measure 1.9-2.9: 16 x `[^<8>]{3}E`, 8 x `[^a]{7}E`, 32 x `[^<8>]E`.
    - All are at most about 26 ms at 4.0e6, and at or under 20 ms on a quiet run.
  - r=64 rows:
    - `([^<64>]{16})x`, and the two- and three-alternative forms at R=1/4/16, measure 6.0-9.7 raw.
    - 16 x `[^<64>]{3}E` on non-`U` cells measures 8.2 raw.
    - The r=64 factor the design calibrates from exactly these rows needs to be about 2.0. Round 6 measured 2.15 on
      long runs. With that factor, every r=64 row is at or under 20 ms by construction.
    - Even at the weakest plausible factor of 1.8, the worst row, 9.72, lands at about 22 ms.
- **Search for accepted shapes over 50 ms at the budget: none found.**
  - Searched (`search.cjs`, `alt64.cjs`, `alt64b.cjs`, `alt32.cjs`):
    - non-`U` cells with 16-64 alternatives (W = 1, 2, 3, 4, 8, 16), on one-byte and two-byte cells
    - R=1/R=W short runs
    - `$`-led and `\b` forms (declined) and `^`-led forms
    - fenced and unfenced `{0,16}` (wide, charged by `m`, about 0.05 ns/u)
    - newline cells under `.`
    - range-form classes
  - Worst found: 64 single-class alternatives `([^<6 pts>k0]|...|[^<6 pts>k63])` (A=64, W=1, r=8, so f=1) on
    two-byte cells made only of the 6 excluded points.
    - Measured 7.61, 8.04 and 7.41 raw ns/u (three runs), about 29-34 ms at 4.0-4.2e6.
    - Under 50 ms, so this is C1 accepted risk (see notes).
    - Rule N caps `A x W` at 64, so A=64 is the ceiling. The step from 32 to 64 alternatives (3.2 to 7.6 ns/u) does
      not continue.
- **Parity corpus is untouched by this branch.**
  - `git diff --stat main...HEAD -- shared-test-fixtures` is empty.
  - The two-dot diff shows `pipeline-run/run-capped-response.json`. That file was added on main by HEL-1696 after
    the branch point, not by this lane.
- `clientEvaluable` stays config-only, and the wiring (D1 "Wiring") is unchanged since round 7.

### Verdict: CONFIRM

### Non-blocking notes

1. **The CR2 escalation is likely to fire at calibration. Decide it ahead of time.**
   - With `budget = floor(20 ms / max ratio)`, the budget is >= 4.00e6 only if the max over all calibration rows is
     <= 5.0 ns/u.
   - My measurements of rows the design lists, on this machine:
     - quiet run (`ref-run1.txt`): `(.{8})x` CJK 4.80
     - under load (`margin-run.txt`, load about 5 of 12 threads, four runs):
       - `(.{8})x` / `(.{16})x` CJK 5.0-5.7
       - `(.{16})x|(.{16})y|(.{16})z` R=1 at 1,000 characters 5.0-6.3
     - The uncharged lone-high rows reach 6.3 (`(.{12})x`). Those exceed the others, so the `LONE_SURROGATE_UNITS = 2`
       charge stays and halves them, as addendum 1 intends.
   - So the derived budget is likely 3.2-4.0e6, below the floor, and the executor will stop and escalate as written.
   - Suggested owner answer, consistent with C1: pin `REGEX_WORK_BUDGET = 4.00e6`. At that value every measured row,
     listed or found here, lands at or under about 32 ms. Record the rows over 20 ms as C1 accepted risk in the
     calibration file.
   - This is the designed escalation path working, not a design defect, so it is not a change request.
2. **C1 accepted risk to record in the calibration file:** 64 alternatives of single r=8 negated classes on two-byte
   cells of excluded characters, 7.4-8.0 raw ns/u, about 29-34 ms at the budget.
   - Do not add it as a calibration row. It would push the budget to about 2.5e6 and break the `(\d+)` scenario.
3. **Spec wording lags the formula.**
   - spec.md still says the run's length times "the smaller of that length and the pattern's per-start-position work",
     and "a per-character charge".
   - The design now charges `A x min(R, W)` with `A` outside the clip, and `A` per character.
   - The implementation over-charges relative to the spec text, so it never contradicts it. Optionally reword it to
     "per alternative".
4. tasks.md still lists 3.5 before 3.4 (cosmetic).
