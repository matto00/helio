## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD b2da43a3d02ba1b84eb8296b9bd9ed742623a353 (planning artifacts untracked in the change dir).
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1836/evidence/.concertino/scratch/HEL-1836/skeptic-design/`
(probe-stage1.cjs/.txt, probe-nonmember.cjs/.txt, probe-nonmember-rerun.txt). Probes run against main's transpiled
modules in `.concertino/scratch/HEL-1836/cal-main` (the same ones premise validation used), `nice -n 19`, best of 7-8.

### What I verified (with evidence)

1. **D1 is charge-identical (verified by reading the code).**
   - `chars` comes from `unionSets` -> `normalize` (javaRegexSets.ts L10-19): sorted, merged, disjoint ranges. So the
     binary search `inRanges` is exactly "cp lies in some range", and a table filled from `[lo, min(hi, 0xFFFF)]` gives the
     same answer for every BMP value, including D800-DFFF. Nothing in the table depends on how ranges are ordered.
   - `codePointAt(i)` returns a value > 0xFFFF only for a valid high+low pair. Otherwise it returns the code unit itself:
     a lone high, a lone low, a reversed `\udc00\ud800`, or a high at the end of the string. So "pair -> inRanges(cp),
     2 units, i += 2; any other surrogate -> table[c], LONE_SURROGATE_UNITS, i += 1; else table[c], 1" reproduces
     `perPositionWork` exactly. Ranges with `lo > 0xFFFF` must be skipped. `Uint8Array.fill` with start > end is a no-op,
     so the skip is safe either way.
   - My probe's table implementation gave `fast == exact` on every frame it ran: cyr, cyr+lone high, astral, `[^a]`, `.`,
     `\S` (probe-stage1.txt, probe-nonmember.txt).
   - The compile cache (`javaRegex.ts` L187-203) keeps the `work` object stable per pattern, so the WeakMap cache keyed by
     `chars` does hit.
2. **The red test is meaningful but structural.** The unanchored stage 1 (`cellWorkBound`: a regex test, not
   `codePointAt`) makes zero `codePointAt` calls. On main, stage 2 calls `codePointAt` once per code point (about 4e6 per
   frame), so test (a) fails on main and passes after D1. It proves "the scan no longer uses `codePointAt`", not that it
   is fast. Speed is left to calibration, and the table-specific mistakes are left to the property test plus the listed
   mutations. That division is acceptable.
3. **Premise numbers reproduced.** Surrogate-free cyr `(x)`: main decision 25.6 / 25.3 ms (probe-stage1.txt), matching
   probe-time.txt. Table scan alone 6.0 ms. **Stage 1 (per-cell `LONE_SURROGATE.test`) costs a further 5.0-5.2 ms.**
   probe-table.txt's 7.4-8.9 ms "table-scan" leaves stage 1 out. The realistic D1 decision is stage 1 + table scan =
   9.8-11.4 ms on cyr `(x)` and 15.8-16.1 ms on astral `(x)` (where pairs still go through `inRanges`).
4. **Group J is NOT the loosest set of unanchored shapes, and D1 alone leaves rows over 20 ms (reproduced twice).**
   For a wide class (`[^a]`, `.`, `\S`), the loosest body is one made of the class's **non-members**: one unit per
   character and no runs, so 4e6 characters fit at the budget. A single two-byte character makes the string two-byte, and
   V8's `u`-mode exec of a class that contains surrogates/astral then runs about 6-8x slower per position. Design D4 puts
   `([^a]+)`, `(.+)` and `(\S+)` only on cyr, cjk and astral bodies. Those bodies are members, charged about 2 units per
   character, so they reach the budget with about half the characters.

   Measured at exact charge 4.000e6, decision false (probe-nonmember.txt, rerun identical within 0.5 ms):

   | shape | main decision + exec | D1 (stage 1 + table scan) + exec |
   |---|---|---|
   | `([^a]+)` on `a`x3999 + one CJK char, 1000 rows | 28.1 + 11.9 = **40.0 ms** | 11.6 + 11.9 = **23.5 ms** |
   | `([^a]+)` same shape, 20000x199 | 29.5 + 12.3 = **41.7 ms** | **24.0 ms** |
   | `(.+)` on `\n`x3999 + one CJK char, 1000 rows | 32.8 + 11.1 = **43.9 ms** | **22.6 ms** |
   | `(.+)` same shape, 20000x199 | 33.0 + 11.5 = **44.5 ms** | **23.4 ms** |
   | `(\S+)` on spaces x3999 + one CJK char, 1000 / 20000 rows | 39.3 / 39.5 ms | **21.5 / 21.8 ms** |

   - On main these rows sit at 40-44.5 ms. That is above the 28.8 ms the evaluator recorded as the worst row and close to
     the 50 ms ceiling, and no calibration group or accepted-risk list records them.
   - After the planned fix they still sit at 21-24 ms. Exec alone is 10-12 ms, so the decision has to come in under about
     8 ms. Stage 1 alone already costs about 5 ms of that.
   - D4's "stop and escalate if any row stays over 20 ms" would catch this only if group J measured these shapes. As
     planned, group J would report every row under 20 ms while these rows stay over it, and AC2 would be certified on a
     set that is not the worst case.
5. **Scope / contradictions / placeholders.** No TBDs. The tasks cover AC1 (1.1/1.2), AC2 (3.1/3.2), AC3 (3.3) and the
   gates (3.4). AC4 (the PR-body scope note) appears only in Planner Notes; no task covers it (minor). `skip_specs` is
   reasonable.

### Verdict: REFUTE

### Change Requests

1. **design.md D4 / tasks 3.1: add the non-member-body unanchored shapes to group J.** Each wide unanchored class gets a
   body made of its own non-members, made two-byte by a single CJK tag:
   - `([^a]+)` / `([^a]*)` on `a`;
   - `(.+)` on `\n` (and ` `);
   - `(\S+)` on spaces;
   - the 64-range negated class on its excluded points;
   - a one-byte variant of each (no tag) as a control.

   Run each at 1,000 and 20,000 rows, with and without one lone surrogate, sized by the same bisection to an exact charge
   of at most 4.00e6. Also state in the design why group J is now the loosest set: maximum characters per unit, meaning
   f = A = 1, no runs, and a two-byte string under a surrogate-bearing class.
2. **design.md Goals/D1: own the measured shortfall.** With D1 alone the shapes above measure 21-24 ms: stage 1 about
   5 ms plus table scan about 6 ms, then exec 10-12 ms. Either plan a second lever and keep it decision-identical, or plan
   the escalation for these rows up front, with numbers. Candidate levers include:
   - avoid paying the per-cell `LONE_SURROGATE.test` (stage 1) and the table scan on the same characters, for example
     with one fused pass;
   - a cheaper unanchored stage 1.

   Whatever is chosen must keep `cellWork`'s charge and every decision unchanged. Do not describe D1 as reaching
   "every unanchored row under 20 ms" when a probe already shows it does not.
3. **design.md D2/Context: correct the cost basis.** Calibration "before/after" must time the shipped
   `workExceedsBudget` (stage 1 + stage 2) plus exec, not the scan alone. probe-table.txt's 7.4-8.9 ms leaves out the
   ~5 ms stage 1, and the design's feasibility claim rests on that number.
4. **Flag to the owner, via calibration.md and the PR body:** main currently carries unrecorded 40-44.5 ms unanchored
   rows (table above), well above the 28.8 ms reported as main's worst. They are under 50 ms, but they belong in the
   accepted-risk record if they are not brought under 20 ms.
5. **tasks.md: add a task for AC4** (the PR-body scope note citing premise-validation.md), so the evaluator has an item
   to check.

### Non-blocking notes

- The D3 red run counts reads with `jest.spyOn(String.prototype, "codePointAt")` over 4e6-call frames (three of them).
  `jest.fn` records every call's arguments and results, so the red run may be slow or memory-heavy in a worker capped at
  3 workers. A plain counting override of `codePointAt`, restored in `finally`, gives the same count without recording
  each call.
- "Held weakly / does not leak": the `WeakMap` is keyed by `chars`, which the unbounded `compileJavaRegex` cache holds
  strongly. So a table effectively lives as long as its compiled pattern. That is fine at 64 KiB per pattern that reaches
  stage 2, but the design text overstates it.
- Table build with `fill` measured at 0.00-0.01 ms (probe-stage1.txt). D2's cost concern is negligible.
- Astral `(x)` rows stay at about 16 ms decision after D1, because pairs still use `inRanges`. They are under 20 ms with
  exec about 1.5 ms, but they are the next-closest rows.
