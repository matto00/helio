## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Base resolved explicitly: `git merge-base origin/main HEAD` = `7ab38ad5`. All diffs
taken as `7ab38ad5...HEAD`. Three commits on branch (5f6bf48a, 987970e0, 58f849dd).

### What I verified (with evidence)

**Diff scope.** `git diff --stat 7ab38ad5...HEAD -- backend/` = exactly two files
(`SortStep.scala` +78/-12, `SortStepSpec.scala` +153/-0). No migration, no frontend,
no unrelated refactor. AC6 met. `git diff ... | grep -c "^-[^-]"` on the spec file
returns **0** — HEL-893's two guards are byte-for-byte unmodified (AC3, tasks 2.8).

**Baseline green (my own run).** `sbt "testOnly ...SortStepSpec"` → 9/9 passed.
Full backend suite `sbt test` → **3844 tests, 254 suites, 0 failures** (291s).
Quality gates I ran myself: `check:scala-quality` → clean (soft warnings only, none
on the changed files), `check:openspec` → clean, `check:spec-structure` → 0 issues,
`format:check` → clean.

**CR1 — the "0aa" fixture is genuinely discriminating, not degenerate.** Derived
independently: under the shipped tiering, tier1={5}, tier2 lexicographic =
`"0aa"`(0x30) < `"Infinity"`(0x49) < `"NaN"`(0x4E) < `"n/a"`(0x6E) → the asserted
`Seq(5,"0aa","Infinity","NaN","n/a")`. Under tier-membership-blind ordering,
`"0aa"` fails `toDoubleOption` so it stays tier 2 while `"NaN"`/`"Infinity"` move
to tier 1 and sort by `Double.compare` (5 < Inf < NaN) → `5, Infinity, NaN, 0aa,
n/a`. The two tierings diverge on this fixture. Confirmed empirically below.

**CR2 — Mutation D re-run by me, not credited from the transcript.** Applied
`finiteNumeric(v) = PipelineRowJson.toDouble(v)` (dropping `.filter(_.isFinite)`)
directly to `SortStep.scala:103`, ran the suite:
```
- should sorts "NaN" and "Infinity" as non-coercible tier-2 values, not as numbers (HEL-981 2.7) *** FAILED ***
Tests: succeeded 8, failed 1
```
2.7 fails **by name**; every other guard green. Matches the recorded transcript
exactly. Reverted; `git diff --stat` confirms the worktree is byte-identical again.

**Mutation-completeness audit (my primary job this round).** I enumerated the axes
and checked each is actually pinned:
| Axis | Guarded by | Evidence |
| --- | --- | --- |
| Tier order (tier1-vs-tier2 precedence) | 2.4, 2.5, 2.6, 2.7 | Mutations A/B (recorded) |
| Tier membership (NaN/Inf classification) | 2.7 (`"0aa"`) | **Mutation D, re-run by me** |
| Per-pair vs per-value mode (the original defect) | 2.3 | Mutation C (recorded) |
| Null placement, asc | 2.6 (pinned expected ends in `null`) | **Mutation E, mine** |
| Null placement, desc | 2.5 | **Mutation E, mine** |
| desc reverses tiers as well as within-tier | 2.5 (`"n/a"` leads) | Mutation B |
| Within-tier-2 lexicographic rule | 2.7 (4 tier-2 values) | A/B/C/D all move it |
| Multi-key primary/secondary + stability (AC4) | pre-existing `InProcessPipelineEngineSpec:1442` | unmodified, green in full run |
| Empty `sortBy` / all-string column | pre-existing engine specs 1428-1490 | green in full run |

**Mutation E is mine and new** (not in the evidence file): I flipped the null arms
to `case (None,_) => true; case (_,None) => false`. Result: **2.5 and 2.6 fail**,
7 passed. So null placement is genuinely pinned in both directions — that axis was
not a hole. Reverted and re-verified clean.

I could not construct a plausible wrong implementation of the committed semantics
that survives the whole suite. (I also checked a `compareToIgnoreCase` tier-2
variant on paper: it would order `"n/a"` before `"NaN"` and break 2.7.)

**AC5.** Property-style irreflexivity/antisymmetry/transitivity guards exist and,
importantly, drive the **real** comparator via `strictlyBefore` (two-element
`SortStep.apply` runs) rather than a hand-built model — that is the right shape.
2.4's input `(10, 9, "n/a")` differs from its output `(9, 10, "n/a")`, satisfying
the "output ordering differs from input ordering" clause. Trichotomy is nowhere
asserted; 2.6 correctly asserts on equivalence classes because its fixture contains
`9`/`"9"`.

**CR3 — the corrected rationale is true, but the correction is INCOMPLETE.** The new
claim ("tier 1's own comparison is `Double.compareTo`, a total order placing `NaN`
last, so transitivity would hold either way; the exclusion is a data-semantics
choice") is correct, and my Mutation D run empirically proves it: with `NaN`/`Inf`
in tier 1, guard **2.3 (transitivity) stayed green**. Corrected in `SortStep.scala`
class scaladoc, `finiteNumeric` scaladoc, and `design.md:110-114`. But the refuted
claim survives verbatim in two further places — see Change Requests.

### Verdict: REFUTE

Two surviving copies of the exact false rationale this round was supposed to
correct. Both now *contradict* the corrected code scaladoc and design.md, and one
of them is the spec delta — the artifact that gets archived into `openspec/specs/`
and outlives the change directory. This is the same defect class as round 1, not a
new objection: a documented-semantics claim that is provably false (AC2 requires
the semantics be explicitly and correctly documented).

### Change Requests

1. **`openspec/changes/sortstep-total-order/specs/pipeline-sort-op/spec.md:22`** still
   reads: tier 2 includes NaN/infinity values *"because those cannot participate in a
   transitive numeric ordering."* That is false — `java.lang.Double.compare` is a total
   order that places `NaN` last, and my Mutation D run leaves transitivity guard 2.3
   green with those values in tier 1. Replace with the data-semantics rationale already
   adopted in `SortStep.scala` and `design.md:110-114` (a cell that only *looks* numeric
   but coerces to `NaN`/`Infinity` is junk data and belongs alongside `"n/a"`; the
   exclusion is a deliberate choice, not a transitivity requirement). This is the
   highest-priority of the two: it is the permanent archived artifact.

2. **`backend/src/test/scala/com/helio/domain/steps/SortStepSpec.scala:19-20`** still
   reads: *"design.md D5 / D1 risk (NaN must land in tier 2, not tier 1, or transitivity
   breaks)."* Same false claim, and it now misattributes it to a `design.md` section
   that explicitly refutes it. Correct it to the data-semantics rationale (and, since
   2.7 is what actually pins the membership rule, a pointer to 2.7 / Mutation D would
   be more useful than the current one).

No code change is required — the implementation, the mutation set and the gates are
all sound. This is a two-line documentation correction.

### Non-blocking notes

- `mutation-evidence.md` would be stronger with Mutation E (null placement) recorded;
  I ran it and it discriminates (2.5 + 2.6 red), so the axis is covered — the evidence
  file just does not say so.
- `files-modified.md` still describes `mutation-evidence.md` as containing "mutations
  A, B and C"; Mutation D is now present too. Cosmetic staleness only.
- The test-local `equivClass` helper re-derives tiering via `s.toDoubleOption` rather
  than `PipelineRowJson.toDouble`. It is only used by 2.6, which pins an explicit
  expected sequence, so it cannot mask a defect — but it is a small model duplication.
