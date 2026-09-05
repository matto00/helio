## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all five artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-sort-op/spec.md` (in `openspec/changes/sortstep-total-order/`).
- Read ground truth for the defect: `backend/src/main/scala/com/helio/domain/steps/SortStep.scala:60-88`
  (per-pair `toDouble` branch confirmed exactly as the ticket describes) and
  `backend/src/main/scala/com/helio/domain/engine/PipelineRowJson.scala:69-78` (`toDouble`:
  Int/Long/Float/Double/BigDecimal/String-via-`toDoubleOption`, else `None`). Note the design doc
  cites this file as `PipelineRowJson.scala:69-78` without the `domain/engine` path — correct lines,
  fine.
- Read the existing baseline requirement `openspec/specs/pipeline-sort-op/spec.md` and diffed it by
  eye against the delta's MODIFIED block.
- Read the HEL-893 guards in `backend/src/test/scala/com/helio/domain/steps/SortStepSpec.scala:6-40`
  and confirmed independently that both fixtures are **all-numeric-looking-string** columns, i.e.
  every value is tier-1 under all three candidate orderings and no non-coercible value exists to
  trigger the all-or-nothing cliff. D6's claim that they pass unmodified under all three orderings is
  therefore true — a green suite genuinely proves nothing about which semantics shipped.

**Ordering analysis I did myself (not taken from the artifacts):** the three-tier relation is a
correct **strict weak ordering** (tier is a function of the value; within-tier comparison is a single
consistent relation; equivalence classes — equal doubles in tier 1, equal strings in tier 2 — are
transitive), which is what `sortWith` requires. Excluding NaN/infinite from tier 1 is necessary and
correctly identified. So D1 as *designed* is sound. The problems below are faithfulness/encoding
problems, not a flaw in the owner's chosen semantics.

### Verdict: REFUTE

Three defects, each a place where the artifacts do not faithfully encode `numeric-tier-first`, plus
one that would make the shipped test suite self-contradictory.

### Change Requests

1. **The spec delta's tier-1 definition contradicts the NaN decision, and the spec is the durable
   artifact.** `specs/pipeline-sort-op/spec.md:16` defines tier 1 as "Values that convert to a number
   (including numeric-looking strings)". `"NaN"` and `"Infinity"` *do* convert to a number
   (`String.toDoubleOption` returns `Some`), but `design.md:80-83` and `tasks.md` 1.1 place them in
   the non-coercible tier. As written, an implementation that satisfies the spec delta literally
   would reintroduce the transitivity break the ticket exists to fix. Amend the spec delta's tier-1
   bullet to say tier 1 is values that convert to a **finite** number, and tier 2 is everything else
   **including `NaN` and the infinities**, so the spec alone is sufficient to derive the correct
   comparator. (Also add a scenario pinning `"NaN"` to tier 2 — see CR 3.)

2. **"The relation SHALL NOT depend on the order in which rows are presented"
   (`specs/pipeline-sort-op/spec.md:11-12`) plus the scenario at lines 59-62 and task 2.6 are false
   for the `9` vs `"9"` case the design itself acknowledges.** `design.md:84-86` correctly states
   that `9` and `"9"` compare equal in tier 1 and that `sortWith`'s stability then decides their
   relative order — which means two different input permutations of a multiset containing both `9`
   and `"9"` yield **different output sequences**. The spec sentence and the scenario "both runs
   return the same sequence of values" are therefore unsatisfiable in general, and task 2.6's guard
   ("assert identical output sequences") will either fail or silently avoid the interesting case.
   Resolve by narrowing the claim, not the semantics: the *relation* is input-order-independent, and
   the output sequence is determined up to the order of values that compare equal. Restate the spec
   sentence and scenario in those terms, and make task 2.6 explicit about whether its fixture
   contains cross-type equal values (if it does, assert equality of the *key* sequence, not the raw
   value sequence).

3. **Task 2.11's discrimination rule contradicts tasks 2.1/2.2 and acceptance criterion 5.** 2.11
   says "a guard that fails under none of the three mutations is not a guard and must be
   strengthened." Irreflexivity (2.1) and antisymmetry (2.2) hold under `numeric-tier-first`,
   `all-or-nothing`, `numeric-tier-last` **and** the pre-fix per-pair comparator (`x < x` is false
   and the two directions disagree in all four). They will fail 2.11's rule by construction, yet AC5
   explicitly requires them and they are the correct guards for the contract. Carve them out: state
   that 2.1/2.2 are contract guards not expected to discriminate, and that the discrimination rule
   applies to 2.3-2.6. As it stands the executor is instructed to "strengthen" two guards that
   cannot be strengthened into discriminators.

4. **The `all-or-nothing` mutation (task 2.8) is not expressible as a comparator swap and the task
   does not say how to perform it.** `all-or-nothing` is a per-*column* mode requiring an O(n)
   pre-scan of `currentRows`; there is no pairwise comparator that implements it (this is exactly
   D2's point). Task 2.8 as written ("swap the comparator for the `all-or-nothing` alternative") is
   ambiguous and the mutation could be performed wrongly — e.g. as a per-pair fallback, which is just
   the pre-fix mutation again, making 2.8 and 2.10 the same experiment and leaving the run's most
   important constraint half-satisfied. Specify the mutation at the `sortWith` **call site**: pre-scan
   the current rows for the key, and if any non-null value does not coerce, compare every pair with
   `toString` lexicographically. Also state the expected outcome up front (2.4 and 2.5 must fail under
   it) so a no-op mutation is caught rather than recorded as evidence.

### Non-blocking notes

- Terminology: the spec and ticket say "total order ... irreflexive, antisymmetric, and transitive".
  Because `9` and `"9"` are equivalent-but-distinct, what actually holds (and what `sortWith`
  requires) is a **strict weak ordering**. The properties listed are the right ones to test; only the
  label is loose. Worth one clause in the spec so a future reader is not misled into asserting
  trichotomy.
- `design.md` D3 justifies reversing the tier order on the grounds that otherwise "`desc` is not the
  reverse of `asc`" — but the null-last exemption in the same sentence already makes `desc` not the
  reverse of `asc`. The decision stands (it is the owner's), the stated rationale is just weaker than
  it reads.
- AC4 (multi-key stability preserved) has no task and no new scenario. The `foldRight` is untouched
  so this is likely safe, but nothing in the plan would notice if it were not; a one-line assertion
  that the existing multi-column guard still passes would close it.
- Task 2.3 asserts transitivity "over all triples of that set, in both `asc` and `desc`" — good. Worth
  noting the property test must also include a raw `Double.NaN` value, not only the string `"NaN"`,
  since `toDouble` reaches NaN by two distinct paths.
