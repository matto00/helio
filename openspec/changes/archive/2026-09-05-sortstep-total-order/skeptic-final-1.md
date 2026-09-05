## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Base resolved explicitly.** `git merge-base origin/main HEAD` = `7ab38ad5`. Diff
`7ab38ad5..HEAD` is 13 files / +941 −12: one production file
(`SortStep.scala`, +71/−12), one test file (`SortStepSpec.scala`, +141), and OpenSpec
artifacts. **No migration** (AC6 met), no frontend, no scope creep — every non-artifact
line is in the comparator or its spec.

**Baseline suite green (re-run myself, not taken from evaluation-2.md).**
`sbt -batch "testOnly com.helio.domain.steps.SortStepSpec"` → `Tests: succeeded 9,
failed 0`. HEL-893's two guards are present and unmodified in the diff (AC3).

**Read `PipelineRowJson.toDouble` directly.** `case s: String => s.toDoubleOption` —
so `"NaN"` → `Some(NaN)` and `"Infinity"` → `Some(Infinity)` genuinely can reach the
tier classifier. The shipped `finiteNumeric` filters with `.filter(_.isFinite)`, so the
*code* does exclude them. AC1's trichotomy exemption is honoured: no test asserts
strict order between `9` and `"9"` (2.2 asserts only "not both directions strict",
2.6 asserts on equivalence classes). The scaladoc records both rejected alternatives
and the numbers-before-strings cross-type commitment (AC2, code side).

**Mutation set audited for completeness — and it is not complete.** Mutations A/B/C in
`mutation-evidence.md` are faithful (A at the call site, B a clean swap of the two
tie-break arms, C the original per-pair fallback) and their reported results are
consistent with the code. But they only perturb *tier order*, never *tier membership*.
I ran the missing mutation myself:

**Mutation D — delete `.filter(_.isFinite)`** (i.e. `finiteNumeric` becomes
`PipelineRowJson.toDouble(v)`; NaN and both infinities move into tier 1). This is the
single most plausible "subtly different implementation of the committed ordering", and
it is the exact commitment design.md's Risks section says the property test must prove:

> `"NaN".toDoubleOption` returns `Some(NaN)` … classify NaN-valued (and infinite)
> coercions into the non-coercible tier … **The property test's value set must include
> `"NaN"` so this is proven, not assumed.**

Result under Mutation D:

```
[info] Tests: succeeded 9, failed 0, canceled 0, ignored 0, pending 0
```

**The entire suite is green with the NaN/Infinity exclusion removed** — including guard
2.7, whose own title is *"sorts \"NaN\" and \"Infinity\" as non-coercible tier-2 values,
not as numbers"*. 2.7 is vacuous for the claim it is named after. Its fixture
`{5, "NaN", "Infinity", "n/a"}` is degenerate: `"Infinity" < "NaN" < "n/a"`
lexicographically **and** `5 < Infinity < NaN` under `java.lang.Double.compare`, so both
tierings yield the identical sequence. Guards 2.1–2.3 also fail to catch it despite
`mixedValues` containing `"NaN"`, `Double.NaN` and `"Infinity"`, because the mutated
comparator is still a valid strict weak ordering (`compareTo`, not `<`).

**Confirmed the divergence is real, not cosmetic** (probe test, applied then reverted):

```scala
val rows = Seq(Map("n" -> 5), Map("n" -> "Infinity"), Map("n" -> "0aa"))
SortStep.apply(rows, SortConfig(Vector(key("n")))).map(_("n")) shouldBe Seq(5, "0aa", "Infinity")
```

- under Mutation D: `*** FAILED ***` (`Tests: succeeded 9, failed 1`)
- under the shipped code: passes (`Tests: succeeded 10, failed 0`)

So the shipped semantics and Mutation D's semantics genuinely differ on user-visible
output, and no shipped guard distinguishes them. Reproduced in both directions before
concluding; worktree restored (`git status --porcelain` shows only the two pre-existing
untracked `evaluation-*.md`).

**Consequence for the ticket's central risk.** This is the same class of finding as
cycle 1's guard 2.6 — a green guard that is structurally incapable of failing on its own
subject. AC5's letter is satisfied for 2.7 (it fails under B and C), but AC1/AC2's
substance is not: the NaN/Infinity tier-membership rule is documented in three places
and pinned by none. A future maintainer deleting `.filter(_.isFinite)` gets a fully
green suite.

**Secondary: the code's stated rationale for the exclusion is factually wrong.**
`SortStep.scala:92-94` (and the class scaladoc, and design.md:110-113) justify excluding
NaN with "`NaN` compares `false` against everything, which would break transitivity
within the tier". That rationale does not hold for *this* implementation:
`compareNonNullAsc` uses `xd.compareTo(yd)`, which is `java.lang.Double.compare` — a
genuine total order that sorts `NaN` above every other double. Transitivity would **not**
break without the filter (Mutation D's green 2.3 is the evidence). The filter is still
the right call, but on semantic grounds (a `"NaN"` cell is junk data and belongs with
`"n/a"`, not ranked above every real number), not on the transitivity grounds recorded.
A maintainer who checks the stated reason will find it false and may delete the filter —
with, as shown above, no test to stop them.

### Verdict: REFUTE

### Change Requests

1. **Strengthen guard 2.7 so it discriminates tier membership**
   (`backend/src/test/scala/com/helio/domain/steps/SortStepSpec.scala`, the
   `HEL-981 2.7` test). Its current fixture `{5, "NaN", "Infinity", "n/a"}` orders
   identically whether `"NaN"`/`"Infinity"` are tier 1 or tier 2. Add at least one
   non-coercible string that sorts **before** `"Infinity"` and `"NaN"` lexicographically
   (e.g. `"0aa"`, or any string starting below `'I'`), so tier-2 placement is observable.
   A fixture verified to work:
   `Seq(5, "Infinity", "0aa")` → `Seq(5, "0aa", "Infinity")` (passes on the shipped code,
   fails under Mutation D). Extend to cover `"NaN"` and `Double.NaN` the same way.

2. **Add Mutation D to the mutation-check evidence**
   (`openspec/changes/sortstep-total-order/mutation-evidence.md`, plus the
   corresponding `tasks.md` entry). Mutation: replace `finiteNumeric`'s body with
   `PipelineRowJson.toDouble(v)` (drop `.filter(_.isFinite)`). Record the transcript
   showing the strengthened 2.7 now **fails** under it. Update the discrimination
   coverage table with the new column. The current A/B/C set only perturbs tier
   *order*; nothing perturbs tier *membership*, which is why this shipped unpinned.
   Note in the write-up that the pre-strengthening suite was green under D.

3. **Correct the NaN-exclusion rationale in all three places** —
   `backend/src/main/scala/com/helio/domain/steps/SortStep.scala:92-94` (the
   `finiteNumeric` scaladoc), the class-level scaladoc bullet for tier 2, and
   `design.md:110-113`. "NaN compares `false` against everything, which would break
   transitivity within the tier" is not true of this implementation, which compares via
   `xd.compareTo(yd)` (`java.lang.Double.compare`, a total order placing `NaN` last).
   State the real reason: a value that only *looks* numeric but coerces to NaN/Infinity
   is junk data and belongs in the non-coercible tier alongside `"n/a"`, rather than
   ranked above every genuine number. Leaving a rationale a maintainer can disprove is
   an active invitation to delete the filter.

### Non-blocking notes

- Mutations A, B and C as documented check out — the transcripts are consistent with the
  code, they are faithful renderings of the two rejected alternatives and the pre-fix
  comparator, and none is a strawman that breaks something incidental. The cycle-2
  strengthening of 2.6 (pinning the expected equivalence-class sequence rather than
  comparing two runs of the same comparator) is a real fix and does discriminate A and B,
  as claimed.
- AC3 (HEL-893 guards unmodified), AC4 (`foldRight` multi-key stability untouched) and
  AC6 (no migration) are met. AC5's mutation-transcript requirement is met for A/B/C.
- `strictlyBefore` correctly drives the real `SortStep.apply` rather than a model
  reimplementation, and the `x != y` guard against self-comparison is right. The
  `equivClass` helper *is* a model, but 2.6 pins an explicit expected sequence through
  it, so it is not load-bearing in the way cycle 1's version was.
