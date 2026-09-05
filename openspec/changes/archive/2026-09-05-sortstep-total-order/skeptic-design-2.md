## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read all five artifacts fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-sort-op/spec.md`. Did not rely on `skeptic-design-1.md`'s findings.
- **Ground truth on the defect**: read `backend/src/main/scala/com/helio/domain/steps/SortStep.scala:60-88`
  and `backend/src/main/scala/com/helio/domain/engine/PipelineRowJson.scala:69-78`. The per-pair
  `toDouble`/`toString` fallback and the null branch (`case (None,_) => false; case (_,None) => true`)
  are exactly as the artifacts describe. Note the artifacts cite `PipelineRowJson.scala:69-78` without
  a path; the file is under `domain/engine/`, not `domain/steps/` (non-blocking).
- **Prior CR1 (finite wording)** — FIXED and coherent. Spec tier 1 says "convert to a **finite** number";
  tier 2 explicitly includes `NaN`/`±Infinity` with the transitivity rationale; new scenario
  "NaN and infinity sort as non-coercible, not as numbers" exists; `tasks.md` 1.1 ("accepting **only finite**
  doubles") and 2.1/2.7 match; design Risks bullet matches. No residual contradiction found.
- **Prior CR2 (input-order independence)** — FIXED. Spec now states determinism "up to the order of
  equivalent values" and the scenario asserts equal *sort-key equivalence-class* sequences; design D4a and
  task 2.6 agree. The unqualified claim no longer appears anywhere I could grep.
- **Prior CR3 (discrimination vs. contract guards)** — FIXED and mutually consistent across all three
  places: AC5 exempts irreflexivity/antisymmetry, design D6's first carve-out exempts 2.1/2.2, and the
  `tasks.md` §2 preamble repeats the exemption and scopes 2.11's rule to 2.3-2.6. No contradiction remains.
- **Prior CR4 (`all-or-nothing` is not a comparator swap)** — FIXED. D6's second carve-out and task 2.9
  both specify a call-site pre-scan mutation. I independently checked its expected failures: under
  all-or-nothing, 2.4 yields `10, 9, "n/a"` (lexicographic) and 2.5 yields `"n/a", 9, 10, null` — both
  differ from the expected outputs, so 2.9's stated expectations are true. Task 2.10's are likewise true.
- **D6's load-bearing factual claim verified**: read `SortStepSpec.scala` (40 lines, 2 tests). Both HEL-893
  fixtures are all numeric-looking strings (`"10","9","100"` and `"9","100","10"`), so D6's assertion that
  they pass under all three candidate orderings is correct, not assumed.
- **MODIFIED requirement preserves original content**: diffed the delta against
  `openspec/specs/pipeline-sort-op/spec.md`. The original requirement paragraph (lines 7-10) is reproduced
  verbatim as the delta's opening paragraph, and all five original scenarios (ascending, descending,
  multi-column, empty-`sortBy` no-op, nulls-last) appear verbatim, with four new scenarios appended.
  The file's other three requirements are correctly untouched (not carried into the delta).
- **Ordering semantics as settled** (`numeric-tier-first`, not re-litigated) are encoded consistently in
  proposal "What Changes", design D1/D3, spec tiers, and tasks 1.2/1.3.

### Verdict: REFUTE

Two task-level defects, both of which would mislead the executor at implementation time.

### Change Requests

1. **`tasks.md` 2.5 — the descending fixture's input order is unspecified, and as literally written it
   equals the expected output, violating D5.** The task reads: "Add a descending fixture including a null
   (`"n/a"`, `10`, `9`, null)". That tuple is exactly the expected *output* named in the spec scenario
   "Partly-numeric column reverses tiers when descending". A reader can take it as either the input or the
   expected output; if taken as the input, the fixture's input order equals its output order, which
   `design.md` D5 explicitly forbids ("each is chosen so its correct output ordering **differs from its
   input ordering** — otherwise it could pass by luck of insertion order"). Restate 2.5 with both orders
   named explicitly and distinct — e.g. input `9, null, "n/a", 10` → expected `"n/a", 10, 9, null` — the
   way 2.4 already does.

2. **`tasks.md` 2.11 states an expected mutation failure that will not occur.** It says of Mutation C
   (restoring the pre-fix per-pair comparator): "Expected: at least 2.3 and 2.4 fail." Fixture 2.4 will
   **not** fail. `sortWith` on a 3-element sequence goes through TimSort's binary-insertion path, and under
   the pre-fix comparator every permutation of `{10, 9, "n/a"}` still lands on `9, 10, "n/a"`:
   - input `10, 9, "n/a"`: `9 < 10` numerically → `[9,10]`; `"n/a"` vs `"10"` lexicographically → after →
     `9, 10, "n/a"`.
   - input `"n/a", 10, 9`: `"10" < "n/a"` → `[10,"n/a"]`; `9` vs `"n/a"` → left, `9 < 10` → `9, 10, "n/a"`.
   - input `9, "n/a", 10`: `"9" < "n/a"` → `[9,"n/a"]`; `10` vs `"n/a"` → left, `10 > 9` → `9, 10, "n/a"`.
   The three-element repro exposes the *relation's* non-transitivity, not a wrong output sequence — which is
   precisely why D5 makes the property check the primary guard. As written, the executor will observe 2.4
   passing under Mutation C and, following 2.12's "must be strengthened" instruction, either churn on the
   fixture or edit it until the mutation fails, corrupting a guard that is correct. Restate 2.11 as:
   "Expected: 2.3 (transitivity) fails. Fixture 2.4 is expected to still pass — the pre-fix comparator
   happens to produce the correct 3-element output; its defect is in the relation, not this sequence — and
   2.12's strengthening rule therefore does not apply to 2.4 for this mutation." (2.4 remains a genuine
   discriminator: it fails under Mutations A and B.) If a fixture that *does* fail under Mutation C is
   wanted, it needs a larger/mixed set where TimSort's contract violation actually changes the output —
   optional, not required.

### Non-blocking notes

- `design.md` Context and `tasks.md` 1.1 cite `PipelineRowJson.scala:69-78` without its directory; the file
  is `backend/src/main/scala/com/helio/domain/engine/PipelineRowJson.scala`. Line numbers are correct.
- `tasks.md` 2.8's "the existing multi-column guard" is unlocated. It is
  `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala:1442`
  ("sort: multi-column sort — primary key takes precedence"), not in `SortStepSpec.scala`. Worth naming so
  the AC4 closure is checked against a real test rather than searched for.
- AC4 asks for multi-key *stability*; the guard above pins primary-key precedence. Task 2.13's full
  `sbt test` covers regression, but no guard specifically pins secondary-key stability. Acceptable given
  the fold structure is untouched by this change.
