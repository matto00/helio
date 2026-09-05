## Evaluation Report — Cycle 1 (evaluation-1.md)

Review base resolved explicitly: `BASE=$(git merge-base origin/main HEAD)` = `7ab38ad5`.
Diff under review: 1 commit (`5f6bf48a`), 2 backend files (+194/-12) plus change-dir artifacts.
No migration files in the diff (AC6 satisfied by inspection: `git diff --name-only 7ab38ad5..HEAD | grep migration` → 0).

### Phase 1: Spec Review — PASS

- AC1 (strict weak ordering for every column shape): met. `compareNonNullAsc` derives a tier from
  each value alone (`finiteNumeric`), so tier dominance + a single within-tier relation makes the
  relation transitive by construction. Asserted as properties (irreflexivity 2.1, antisymmetry 2.2,
  transitivity + transitivity-of-equivalence 2.3) over a mixed value set with duplicates, in both
  directions — not a hand-picked sequence. Verified the guards observe the REAL comparator:
  `strictlyBefore` (SortStepSpec.scala:57-66) drives `SortStep.apply` on 2-element inputs rather than
  reimplementing a model.
- Trichotomy is correctly NOT asserted. Antisymmetry (line 108) is written as "not both
  `strictlyBefore(x,y)` and `strictlyBefore(y,x)`", which permits `9` ~ `"9"`. No test anywhere
  demands strict inequality for distinct values. Confirmed.
- AC2 (semantics explicitly chosen and documented): met in `design.md` D1-D6 and in the rewritten
  object scaladoc (SortStep.scala:33-67). The scaladoc records BOTH rejected alternatives
  (`all-or-nothing per column`, `numeric-tier-last`) with the reason each lost, AND the
  numbers-before-strings cross-type commitment (D4), AND the strict-weak-ordering-not-total-order note.
  Confirmed by direct read.
- AC3 (existing behaviour preserved): HEL-893's two guards are untouched by the diff (they appear as
  unchanged context) and pass. Nulls-last branch (SortStep.scala:127-128) untouched in both directions.
- AC4 (multi-key stability): `foldRight` + `sortWith` fold untouched; the multi-column guard in
  `InProcessPipelineEngineSpec` passes in the full-suite run below.
- AC6: no migration.
- Committed decision `numeric-tier-first` is what actually shipped (`case (Some(_), None) => -1`,
  SortStep.scala:108). Not reopened.
- Tasks: all boxes ticked and each matches implemented reality on inspection.
- Scope: no changes outside `SortStep.scala` / `SortStepSpec.scala` + change-dir artifacts.
  `PipelineRowJson.toDouble` read-only as required. No scope creep.

### Phase 2: Code Review — FAIL

**Gates re-run independently by me in the worktree (not trusting the executor's report):**

| Gate | Result |
| --- | --- |
| `sbt "testOnly com.helio.domain.steps.SortStepSpec"` (baseline) | 9/9 pass, 0 failed — baseline confirmed, not assumed |
| `sbt test` (full backend) | 3844 tests, 254 suites, **0 failed** |
| `npm run check:scala-quality` | clean (156 pre-existing soft warnings; neither SortStep file appears) |
| `npm run format:check` | clean |
| `npm run check:openspec` | clean ("complete but in flight") |
| `npm run check:spec-structure` | passed, 349 canonical specs, 0 issues |

No `frontend/**` files changed → frontend gates and Phase 3 not applicable.

**Independent mutation re-runs (the binding constraint for this run).** I applied each mutation
myself, ran the suite, recorded the failing test names, restored the file, and confirmed
`git status --short` clean after each. All three produced RED; my observed results match
`mutation-evidence.md` line-for-line, so that file is now corroborated evidence rather than an
unverified claim from the stopped executor:

- **Mutation B (`numeric-tier-last`)** — flipped the tier arms in `compareNonNullAsc`
  (`(Some(_),None) => 1`, `(None,Some(_)) => -1`). **RED: 3 failed** — 2.4
  (`List("n/a", 9, 10)` ≠ `List(9, 10, "n/a")`), 2.5 (`List(10, 9, "n/a", null)` ≠
  `List("n/a", 10, 9, null)`), 2.7 (`List("Infinity","NaN","n/a",5)` ≠ `List(5,"Infinity","NaN","n/a")`).
- **Mutation A (`all-or-nothing`)** — applied at the `sortWith` **call site** (pre-scan the key's
  column; any non-coercible non-null value ⇒ compare every pair via `toString`), per design D6's
  carve-out. **RED: 2 failed** — 2.4 and 2.5.
- **Mutation C (pre-fix per-pair comparator)** — restored the original lines. **RED: 2 failed** —
  2.3 transitivity and 2.7. 2.4 still passes, exactly as tasks.md 2.11 predicted and explicitly
  permitted; it is nonetheless a genuine discriminator (it fails under A and B).

The guards therefore DO discriminate `numeric-tier-first` from both rejected alternatives and from the
pre-fix code. A green suite is no longer vacuous here.

**NaN / infinity exclusion — verified in the code, not taken on trust.** `finiteNumeric`
(SortStep.scala:95-96) is `PipelineRowJson.toDouble(v).filter(_.isFinite)`. The `.filter` is
load-bearing: `PipelineRowJson.toDouble` routes strings through `s.toDoubleOption`, and
`"NaN".toDoubleOption` / `"Infinity".toDoubleOption` both return `Some(...)`, so without the filter
those values would enter tier 1 and break transitivity within it. Guard 2.7 pins the behaviour, and
mutation C (which drops the finiteness filter along with the tiering) turns it red — so this is
measured, not assumed. The reason is stated at the point of change in both the scaladoc and
`finiteNumeric`'s own comment.

**Code quality (CONTRIBUTING):** no inline fully-qualified names (`PipelineRowJson` is imported at
SortStep.scala:4 and used bare). Both files well under budget (SortStep.scala 144 lines,
SortStepSpec.scala 175). No dead code, no TODO/FIXME, no unused imports, no untyped escape hatches.
The comparator is factored into two small private helpers with a clear `compare`-convention contract
documented on `compareNonNullAsc`. DRY: `rowsOf`/`sortedValues`/`strictlyBefore`/`equivClass` are
shared test helpers rather than repeated inline. Not over-engineered — no premature abstraction.
Security/error-handling: N/A for a pure in-memory comparator; no new boundaries.

**The one blocking finding — Change Request 1 below:** guard 2.6 fails under **none** of the three
mutations, which the change's own normative rules forbid without strengthening.

### Phase 3: UI Review — N/A

No `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**` changes (the spec
delta lives under `openspec/changes/`, not `openspec/specs/`). Dev servers not started, per the
backend-only scope of this change.

### Overall: FAIL

Substantively the implementation is correct and the semantics that shipped are the committed ones —
proven, not asserted. The single blocker is a rule the change's own AC5 / tasks 2.12 / design D6 state
normatively and that the executor waived unilaterally in prose instead of satisfying.

### Change Requests

1. **Strengthen guard 2.6 so it discriminates, or get its exemption ruled on — do not leave it
   waived by prose.** `backend/src/test/scala/com/helio/domain/steps/SortStepSpec.scala:157-167`.
   Guard 2.6 asserts only `sortedA.map(equivClass) shouldBe sortedB.map(equivClass)` — two runs of the
   *same* comparator compared against each other. That shape is structurally incapable of
   discriminating between candidate orderings (every candidate is deterministic, so both runs move
   together), and my mutation runs confirm it: 2.6 passed under A, B and C. AC5 exempts only the
   irreflexivity and antisymmetry guards; tasks.md 2.12 covers 2.3-2.7 and design.md D6 covers
   2.3-2.6 — 2.6 is inside the rule under both readings, and the rule says such a guard "must be
   strengthened". `mutation-evidence.md`'s closing paragraph argues 2.6 should be exempt; that may
   well be the right call, but it is a rule change the executor granted itself, not a satisfied rule.

   The cheap fix that satisfies both the rule and design.md D4a: keep the cross-permutation equality
   AND additionally pin the expected equivalence-class sequence explicitly, e.g.

   ```scala
   val expected = Seq(9, "9", 10, "n/a", "zzz", null).map(equivClass)
   sortedA.map(equivClass) shouldBe expected
   sortedB.map(equivClass) shouldBe expected
   ```

   I checked this actually discriminates before requesting it: under Mutation A the column flips to
   lexicographic, yielding the class sequence `[10.0, 9.0, 9.0, "n/a", "zzz", null]` ≠ the expected
   `[9.0, 9.0, 10.0, "n/a", "zzz", null]`, so 2.6 goes red under A (and under B, which leads with
   tier 2). Assert on equivalence classes, not raw values — the fixture contains the cross-type equal
   pair `9`/`"9"`, and D4a forbids a raw-value assertion there.

   Then re-run all three mutations against the amended guard and update the coverage table in
   `mutation-evidence.md` (2.6's row currently reads pass/pass/pass) plus its closing paragraph.
   If instead you believe 2.6 genuinely must stay non-discriminating, that is an AC5 amendment —
   escalate it rather than recording a self-granted carve-out.

### Non-blocking Suggestions

- `strictlyBefore` (SortStepSpec.scala:63) guards with `x != y`. For the `Double.NaN` element of
  `mixedValues` this leans on boxed-`Any` equality semantics, which are subtle enough to be worth a
  one-line comment naming what `NaN != NaN` does here under `BoxesRunTime`. The guards pass either
  way — this is readability, not correctness.
- Guard 2.1's assertion is `contain theSameElementsAs`, which is a weaker statement than
  irreflexivity per se (it checks no element is lost, not that `x < x` is false). It is exempt from
  discrimination and does hold, so this is not blocking; a comment distinguishing "what this
  actually measures" from the property's name would prevent a future reader over-reading it.
- `mutation-evidence.md` is a genuinely good artifact — the per-mutation predictions, the honest
  "2.4 still passes under C, as predicted" note, and the coverage table are exactly what made this
  review verifiable. Keep the format.
