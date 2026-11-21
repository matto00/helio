## Skeptic Report — design gate (round 7, skeptic-design-7.md)

Reviewed HEAD bd10d1767eb04e9467428155ed99c92554a01f11 plus the uncommitted design.md / spec.md / tasks.md revision
("D1 addendum 3"). Standing constraints C1 (under 50 ms = accepted risk; over 50 ms blocks) and C2 (rounds 7-8 only)
applied.

Setup: Node v22, `nice -n 19`, one process at a time. Probes are in
`/home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic7/`:
- `build.cjs` transpiles the worktree's `javaRegex*.ts` and patches `regexWorkModel` so it also returns `A` (altsPaths),
  `W` (`max(1, altsWeight(BY_MIN))`), the max atom range count `r`, and the atom sets (for `U`).
- `lib.cjs` implements addendum 3 literally, per cell: `f x (len + sum over U-runs (R x A x min(R, max(1, W)) + m x R^2))`.
- The other probes are `base.cjs`, `short.cjs`, `search.cjs`, `cheap.cjs`, `nonu.cjs`, `nonu2.cjs` and `fixcheck.cjs`.
  Their outputs are in `*-run*.txt` next to them.

"raw ns/u" means measured time divided by the addendum-3 cost with `f = 1`.

### What I verified (with evidence)

- **CR1 and CR2 of round 6 are addressed as written, and the formula is implementable.**
  - The factor is now outside the clip.
  - `A` is outside `min(R, W)`.
  - `W`, `A` and `m` all map onto existing functions in `javaRegexCost.ts`: `altsWeight(alts, BY_MIN)`, `altsPaths`,
    and the `quadratic` expression.
  - My patched build computes them with no new tree walk beyond collecting `set.length`.
  - The tail-factor ambiguity from round 6 is gone, because `f` is a single whole-pattern multiplier.
- **Round 6's table under the new formula (raw ns/u, `short.cjs`, reproduced in `cheap.cjs` and `fixcheck.cjs`):**
  - Factor-1 long-run reference rows are stable at 4.11-4.63: `(.{8|12|16})x`, `(\S{16})x`, `([^a]{16})x` on Cyrillic.
  - `(.{16})x|(.{16})y|(.{16})z` on R=1 cells measures 8.29-8.74 in 9 runs. Factor 1, so no factor can absorb it.
  - The r=64 three-alternative row on R=1 cells measures 15.2-15.4. The r=32 row measures 15.4, and r=16 measures 13.7-13.9.
  - Long-run r=64 rows measure 9.3-9.7.
  - So if these rows join the calibration list, as addendum 3 says, the max ratio is about 8.5 ns/u. That gives
    `budget = floor(20 ms / 8.5 ns)` of about 2.35e6, and every listed row is at or under 20 ms by construction.
  - The factors come out near 1.6 (r=16), 1.8 (r=32) and 1.8 (r=64).
- **Defect A (blocking, over 50 ms): characters outside `U` are charged 1 unit, but V8 tests every alternative's
  leading class at every start.**
  - Cells made only of characters outside `U`, 1,000 rows x 2,000 characters. Measured in `nonu.cjs`, `nonu2.cjs`
    (twice) and `fixcheck.cjs`, stable within about 10%:

    | accepted pattern (A, W, r) | cell | ms | raw ns/u (charged 1/char) | ms at budget 2.35e6 |
    |---|---|---|---|---|
    | 16 alternatives `[^<7 pts>]{3}E_k` (16, 4, r=8, f=1) | the 7 excluded points | 81-83 | 40.7-41.6 | about 96 |
    | 16 alternatives `[^<63 pts>]{3}E_k` (16, 4, r=64) | the excluded points | 225-262 | 112-131 | about 150-170 (after f of about 1.8) |
    | 32 alternatives `[^<63 pts>]E_k` (32, 2, r=64) | the excluded points | 139-151 | 69-76 | about 90-100 (after f) |
    | 8 alternatives `[^a]{7}E_k` (8, 8, r=2, f=1) | `a...` | 29.6-30.4 | 14.8-15.2 | about 36 (accepted risk) |

  - All four patterns compile and pass Rule N: `paths x W = 64`.
  - With a budget-filling frame, the first three rows run 90-170 ms. The first row is factor 1, so the class factor
    cannot help it.
  - With the larger budget from long-run rows alone (about 4.3e6), these rows are worse still: 175 ms for the first.
  - The run term charges nothing here, since there are no runs, and the `len` term charges 1 per character whatever
    `A` is.
  - Narrow positive classes do not show this: 16 alternatives `[a-z]{3}E` or `\S{3}E` on non-matching cells run
    0.4 ns/char, because V8's quick check rejects them. So this is specific to wide (mostly negated) leading classes.
    The model cannot tell those apart, so it has to charge for them.
- **Defect B (spec contradiction): the budget addendum 3 derives breaks a stated scenario.**
  - The spec scenario "A cheap pattern stays client-side on long cells" covers `(\d+)` over 1,000 x 2,000-character
    cells. The Jest test pinning it is `regexInputCost.test.ts:39-41`, which uses `"1".repeat(2000)`.
  - Under the run model that frame costs `2000 + 2000 x 1 x 1 = 4,000` per cell, so 4.00e6 in total. V8 runs it in 0.6 ms.
  - Addendum 3's derived budget of about 2.35e6 declines it. So the design as written cannot satisfy its own spec
    scenario and existing test.
  - The design also still says "`(a+)` over 1,000 x 2,000 chars costs 2e6 units". That is stale: it was the cycle-1
    formula, and on all-`a` cells it is 4e6 now.
- **One change fixes both defects** (`fixcheck.cjs`, same measurements re-costed): charge the scan term per alternative,
  `f x (A x len + sum over runs (R x A x min(R, max(1, W)) + m x R^2))`. Raw ns/u becomes:

  | row | ns/u |
  |---|---|
  | 16 x `[^<8>]{3}E` all outside `U` | 2.54 |
  | 8 x `[^a]{7}E` all outside `U` | 1.90 |
  | 32 x `[^<64>]E` all outside `U` | 2.37 |
  | 16 x `[^<64>]{3}E` all outside `U` | 8.17 raw, about 4.5 after f |
  | `(.{16})x\|y\|z` R=1 | 4.73 |
  | 3 x `[^<64>]{16}` R=1 | 8.48 raw, about 4.1 after f of about 2.1 |
  | `(.{16})x` long | 4.62 (A=1, unchanged) |
  | `(\d+)` | unchanged at 4.00e6 |

  - The max stays at the long-run reference (about 4.6), so the budget stays about 4.2-4.3e6.
  - `(\d+)` then stays client-side, with a thin margin.
  - Single-alternative patterns (`A = 1`), including the ordinary-text scenario, are unaffected.
- **Searched other shapes** (`search.cjs`) and found nothing else over 50 ms:
  - Narrow-choice paths: `[^<64>]{0,7}x` and `.{0,7}x`, at most 2.6 raw.
  - `$`-alternation: `(.{16})$|...` at 8.2 raw. That is the same R=1 shape, covered by the fix.
  - Wide-with-tail plus alternation: `.*x|.{16}y` at 4.7.
  - `[^<64>]*x` and lazy `([^<64>]+?)x`: 4.4-6.3 raw, absorbed by f.
  - Nested binary groups and stacked `{0,k}` are declined by Rule N.
  - Short-run many-alternative rows: 16x and 8x `[^<64>]` at R=1 are 20.3-20.7 raw as written, and 4.1-4.7 after
    the fix and f.
- Corpus, spec and tasks: `git status` shows only the change dir modified. Rows from earlier rounds are not re-litigated.

### Verdict: REFUTE

### Change Requests

1. **design.md "D1 addendum 3": charge the per-character scan per alternative.**
   - Replace `len` in the formula with `A x len`:
     `cost = f x (A x len + sum over runs (R x A x min(R, max(1, W)) + m x R^2))`.
     Apply the same change to the anchor variant, if it ships.
   - Add calibration rows on cells made only of characters outside `U` (1,000 x 2,000):
     - 16 alternatives `[^<7 pts>]{3}E_k`
     - 16 alternatives `[^<63 pts>]{3}E_k`
     - 32 alternatives `[^<63 pts>]E_k`
     - 8 alternatives `[^a]{7}E_k`
   - Repro: `.concertino/scratch/HEL-1697/skeptic7/nonu2.cjs` and `fixcheck.cjs`.
   - Jest: the 16-alternative r=8 frame of excluded characters declines, and goes red with the scan charged 1 per
     character.
   - An equivalent fix is acceptable if it is shown to bring the first row (40.7 raw ns/u today) to or under the
     long-run max.
2. **design.md: make the budget derivation consistent with the `(\d+)` scenario.**
   - State that the derived `REGEX_WORK_BUDGET` must be at least the 4.00e6 that the spec frame
     (`(\d+)`, 1,000 x 2,000 digits; `regexInputCost.test.ts:39-41`) costs.
   - Record that margin in the calibration file.
   - If a measured budget falls below it, escalate. Do not edit the scenario or test frame to fit.
   - Fix the stale "`(a+)` ... costs 2e6 units" sentence: under the run model it is 4e6 on all-`a` cells, and 2e6
     only on cells outside `U`.
   - With CR1 applied I measure the max ratio at about 4.6 ns/u, so the budget is about 4.3e6 and this holds. Under
     addendum 3 as written it does not (about 2.35e6).

### Non-blocking notes (C1 accepted risk, for the calibration file)

- `8 alternatives [^a]{7}E` on all-`a` cells: about 36 ms at the as-written budget. With CR1 it is well under 20 ms.
- Run-to-run spread on the reference rows is about 5%: 4.62-4.86 ns/u between round 6 and round 7. The `(\d+)` margin
  (4.0e6 against about 4.2-4.3e6) is within about 2 such spreads, so pin the constant once and do not re-derive it per run.
- tasks.md still lists 3.5 before 3.4 (cosmetic).
