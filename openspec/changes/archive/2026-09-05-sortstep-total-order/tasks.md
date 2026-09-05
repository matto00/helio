## 1. Backend

### Backend

- [x] 1.1 In `SortStep.scala`, add a private tier classifier mapping a non-null value to tier 1 (via `PipelineRowJson.toDouble` in `backend/src/main/scala/com/helio/domain/engine/PipelineRowJson.scala:69-78`, accepting **only finite** doubles — `NaN` and both infinities fall through) or tier 2.
- [x] 1.2 Replace the per-pair coercion fallback in `SortStep.apply` (lines 76-83) with the three-tier comparison: tier 1 numeric ascending, tier 2 lexicographic ascending, tier 1 entirely before tier 2.
- [x] 1.3 Apply `desc` by reversing both the within-tier ordering and the relative order of tiers 1 and 2, leaving the existing null-last branch (lines 73-74) untouched in both directions.
- [x] 1.4 Rewrite `SortStep`'s object-level scaladoc to state the three-tier ordering, and record the two rejected alternatives (all-or-nothing per column; numeric-tier-last) with the reason each lost, per design.md D1.
- [x] 1.5 Note in the same scaladoc that this commits the codebase to a numbers-before-strings cross-type rule not stated elsewhere (design.md D4), and that the relation is a strict weak ordering (`9` and `"9"` are equivalent), not a strict total order.
- [x] 1.6 Confirm no call site outside `SortStep` changes and no migration is added; `PipelineRowJson.toDouble` must be read-only.

## 2. Tests

### Tests

Guards 2.1-2.2 are **contract guards**: they are required by AC5 but are NOT expected to discriminate between the candidate orderings (they hold under all three and under the pre-fix comparator). The discrimination rule in 2.12 applies to 2.3-2.7 only. Do not "strengthen" 2.1/2.2 to try to make them discriminate.

- [x] 2.1 Add a property-style irreflexivity guard over a mixed value set: numbers, numeric-looking strings, non-coercible strings, the string `"NaN"`, a raw `Double.NaN`, `"Infinity"`, nulls, and duplicates of each.
- [x] 2.2 Add antisymmetry over all pairs of that set, written to permit equivalence (e.g. `9` vs `"9"`) rather than demand strict inequality, per design.md Risks.
- [x] 2.3 Add transitivity over all triples of that set, in both `asc` and `desc`, including transitivity of equivalence.
- [x] 2.4 Add a fixture guard for the ticket's exact repro (`10`, `9`, `"n/a"` ascending → `9`, `10`, `"n/a"`), with input order deliberately different from expected output order.
- [x] 2.5 Add a descending fixture including a null, with input and expected output explicitly distinct: input `9, null, "n/a", 10` → expected `"n/a", 10, 9, null`, asserting tier reversal with nulls still last.
- [x] 2.6 Add an input-order-independence guard comparing sort-key **equivalence classes**, not raw value sequences, per design.md D4a. State explicitly in the test whether its fixture contains cross-type equal values; if it does, assert on the key sequence.
- [x] 2.7 Add a fixture pinning `"NaN"`/`"Infinity"` to tier 2 (spec scenario "NaN and infinity sort as non-coercible, not as numbers").
- [x] 2.8 Verify HEL-893's two existing guards in `SortStepSpec.scala` still pass **unmodified** — do not edit them. Likewise confirm the existing multi-column guard at `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala:1442` ("sort: multi-column sort — primary key takes precedence") still passes, closing AC4.
- [x] 2.9 Mutation A (`all-or-nothing`): mutate at the `sortWith` **call site**, not the comparator — pre-scan the rows for the key and, if any non-null value fails to coerce, compare every pair with `toString` lexicographically. Expected: 2.4 and 2.5 fail. Record the transcript, then restore.
- [x] 2.10 Mutation B (`numeric-tier-last`): swap the tier precedence so tier 2 leads in `asc`. Expected: 2.4 and 2.5 fail. Record the transcript, then restore.
- [x] 2.11 Mutation C (pre-fix per-pair comparator): restore the original lines 76-83. Expected: 2.3 (transitivity) fails. Fixture 2.4 is expected to STILL PASS — under the pre-fix comparator every permutation of `{10, 9, "n/a"}` happens to land on `9, 10, "n/a"` via TimSort's binary-insertion path, because the defect is in the relation, not in this 3-element output sequence. Do NOT edit 2.4 to force a failure here; 2.12's strengthening rule does not apply to 2.4 for this mutation (2.4 remains a genuine discriminator — it fails under Mutations A and B). Record the transcript, then restore.
- [x] 2.12 Write the three mutation transcripts (command, failing test names, output) to an evidence file. A guard among 2.3-2.7 that fails under **none** of the three mutations is not a discriminator and must be strengthened; 2.1/2.2 are exempt by the carve-out above. A mutation under which nothing fails is a failed experiment, not evidence.
- [x] 2.13 Run `sbt test` in the worktree and record the full green result.
- [x] 2.14 (final-gate skeptic, skeptic-final-1.md) Mutation D — drop `finiteNumeric`'s `.filter(_.isFinite)` so `NaN`/both infinities move into tier 1. Mutations A/B/C only perturb tier *order*; this perturbs tier *membership*, which was previously unpinned (the whole suite, including 2.7, stayed green under it). Strengthen 2.7's fixture with a non-coercible value (`"0aa"`) that sorts before `"Infinity"`/`"NaN"` lexicographically but after them under `Double.compare`, so the two tierings diverge. Expected: 2.7 fails by name. Record the transcript in `mutation-evidence.md`, add a coverage-table column, then restore and re-confirm Mutations A/B still reproduce their existing red sets.
