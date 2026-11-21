## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Reviewed HEAD bd10d1767eb04e9467428155ed99c92554a01f11 plus the uncommitted design.md / spec.md / tasks.md revision
("D1 addendum 2 (skeptic-design-5.md): class width").

Setup: Node v22.23.2, `nice -n 19`, one process at a time. Probes live in
`/home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic6/`. `build.cjs` transpiles the worktree's
`javaRegex*.ts` (HEAD) into `js/` with the main checkout's TypeScript. The probes are `maxr.cjs`, `shortruns.cjs`,
`r1base.cjs`, `r1more.cjs`, `alts.cjs`, `alts2.cjs` and `alts3.cjs`.

The design's cost model is not implemented yet: HEAD still has the cycle-1 whole-cell formula. So every probe computes
the charged cost the design specifies, in JS:
`len + sum over U-runs (R x min(R, F) + m x R^2)`, with `F` taken from `compileJavaRegex(...).work.perStart`.

The budget comes from reference rows I measured in the same process. Over `(.{8})x`, `(.{12})x`, `(.{16})x`,
`(\S{16})x` and `([^a]{16})x` on Cyrillic, the max is M = 4.86 ns/unit, so the budget is about 4.12e6. That sits
inside the 3.9-4.3e6 the addendum expects. "ms@budget" below means `measured ms x budget / charged cost`.

### What I verified (with evidence)

- **The range-count definition is sound and implementable.**
  - `Ranges` (`javaRegexSets.ts:5`) is an array of `[lo, hi]` pairs.
  - `normalize` merges overlapping and adjacent pairs, so `set.length` is the merged range count.
  - `parseClass` (`javaRegexClass.ts`) returns `complementSet(union)` for a negated class, and single atoms carry
    `DOT_SET`, `SPACE` and the escape sets.
  - Measured baseline `r`: `.` = 5, `\S` = 3, `\s` = 2, `\W` = 5, `\D` = 2, `\w` = 4. All are at or below 8, so they
    get factor 1. That is consistent with the existing calibration rows.
  - The tokenizer declines `(?`, `\p` and `&&`, so explicit class members are the only way to get a large `r`.
- **The 64 cap leaves the parity corpus unchanged.**
  - `maxr.cjs` walks every `pattern` key in `shared-test-fixtures/pipeline-step-parity/*.json`: 57 patterns, across
    stringops.json and assert.json.
  - The largest atom `r` in the whole corpus is 5, from `<(.+?)>`, `(.)` and `a(.)b`. That is also the largest among
    accepted patterns. No corpus vector comes near 9, let alone 65, so neither the cap nor the factor changes any
    `clientDeclines` or model value.
  - `git diff --stat main -- shared-test-fixtures` is empty.
- **The factor rows the addendum names behave as claimed on long runs.**
  - `shortruns.cjs`, `([^<N pts>]{16})x` on 333-character Cyrillic runs, needs an uncharged factor of 1.68 at r=16,
    1.74 at r=32 and 2.15 at r=64. With that factor, the long-run row comes back to about 5.1 ns/unit, about 21 ms at
    the budget.
- **Defect: the factor is folded into `W`, so `min(R, F)` clips it away whenever a run is shorter than `F`.**
  - The addendum says the factor is "applied to that atom's contribution to `W`". But the run term is
    `R x min(R, F)`. For any run with `R <= F`, the term is `R^2` whatever the factor is. Only runs longer than `F`
    ever pay for class width.
  - `altsPaths` is inside `F` too, so the same clip drops the number of alternatives on short runs. V8 still tries
    every alternative's leading class at every start.
  - Cells are 1,000 rows. R = run length in `U`, separated by one character outside `U`. Results are reproduced across
    two or three runs, within about 5%. Probes: `alts2.cjs` and `alts3.cjs`.

  | accepted pattern (r of the class) | cells | ms@budget, as written |
  |---|---|---|
  | `[^<63 pts>]{16}x\|[^<63 pts>]{16}y\|[^<63 pts>]{16}z` (r=64) | R=1, 1,000 or 2,000 chars | 107-114 |
  | `[^<63 pts>]{16}x\|[^<63 pts>]{16}y` (r=64) | R=1 | 75-80 |
  | the same | R=4 | 60-65 |
  | `[^<63 pts>]{8}x\|[^<63 pts>]{8}y` (r=64) | R=1 | 77-80 |
  | `([^<63 pts>]{16})x` (r=64) | R=1 | 38-40 (identical with the factor forced to 1) |
  | `(.{16})x\|(.{16})y\|(.{16})z` (r=5, factor 1) | R=1 (`ж\n` or `b\n` cells) | 57-61 |
  | `.{16}x\|.{16}y\|.{16}z` (r=5, factor 1) | R=1 | 49-55 |
  | `[^a]{16}x\|[^a]{16}y\|[^a]{16}z` (r=2, factor 1) | R=1 | 51 |

  - The first two rows are well past the 50 ms long-task threshold at the derived budget on the reference machine.
    The last three show that the alternation part of the clip exceeds it even with no wide class.
  - Four or more alternatives are declined by Rule N, so three alternatives is the worst case.
  - Moving the factor outside the clip, `f x (len + sum R x min(R, F))`, brings the r=64 two-alternative R=1 row to
    about 35 ms. The three-alternative row lands at about 49-52 ms, still at the threshold. So the factor placement
    and the alternative count both need fixing.
- **The finite-calibration framing is honest and consistent.**
  - The spec says "for every shape on the recorded calibration list".
  - The design treats any shape found above 50 ms as a defect to add as a row.
  - Neither overclaims, and the ticket only asks for item 1 to be decided and implemented with a red-first probe.
  - Under that same rule, though, the shapes above are such defects. The design cannot ship them as an accepted risk.
- Nothing else regressed: `clientEvaluable` stays config-only, and `git status` shows only the change dir modified.

### Verdict: REFUTE

### Change Requests

1. **design.md "D1 addendum 2", (b): apply the class factor after the run clip.** The factor must multiply the work
   charged per run (and the per-character scan), not `W` inside `min(R, F)`. Name the formula exactly. One sound
   option: let `f` be the pattern's max `classFactor(r)` over its atoms, and per cell charge
   `f x (len + sum over U-runs (R x min(R, F) + m x R^2))`. A per-atom variant is also acceptable if the design shows
   it is never clipped.

   Add calibration rows with short runs (R = 1, 4, 16, separated by one character outside `U`) for:
   - `([^<N>]{16})x`, for N in {16, 32, 64}
   - the two- and three-alternative forms `[^<N>]{16}x|[^<N>]{16}y(|[^<N>]{16}z)`

   Repro: `/home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic6/alts2.cjs`. The Jest decline test should
   use a short-run frame, so it goes red when the factor is applied inside `F` (or forced to 1).

2. **design.md D1 (run-based cost): stop `min(R, F)` from discarding the number of alternatives.**
   `(.{16})x|(.{16})y|(.{16})z` on R=1 cells runs 57-61 ms at the budget with factor 1. Charge alternatives outside
   the clip, for example `R x altsPaths x min(R, max(1, W))` in place of `R x min(R, F)`. Alternatively, keep the
   formula, add the R=1 and R=4 multi-alternative rows above to the calibration list, and take the budget from them.
   Either way, state the choice, and add those rows (`alts3.cjs`) to the calibration table.

   Show that with both fixes, every row in this report's table is at or under 20 ms at the re-derived budget, or at
   the least under 50 ms with the remainder recorded as accepted risk under the finite-calibration rule. Add a Jest
   case: a three-alternative short-run frame declines, red under the old clip.

### Non-blocking notes

- These constant-factor findings stay under 50 ms. Record them in the calibration file:
  - `([^<63 pts>]{16})x` on R=1 cells runs 38-40 ms.
  - Small-class two-alternative R=1 runs 37-40 ms.
  - A 45-range ASCII class on R=1 two-byte cells runs about 35 ms.
- The wording "the tail term uses the factor of the atoms in the tail" is readable two ways: as the tail's weight, or
  as also multiplying `m` by the wide atom's own factor. Pin it while you are revising (b).
- tasks.md still lists 3.5 before 3.4. This is cosmetic.
