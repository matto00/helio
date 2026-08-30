## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**Round 3 CR-1 — RESOLVED.** design.md D1 now carries the paragraph "Knowingly reversed: HEL-860's
read-tolerance guarantee for a wrong-TYPE stored row", naming `PipelineStepRoutesSpec.scala:1019-1035`, the
`rowToDomain` 500 consequence, the 0-of-233 justification, and the PR-disclosure obligation. The
`pipeline-step-config-rejection` delta's paragraph beginning "The read path SHALL NOT remain tolerant for a
stored key that is present but whose JSON type cannot represent the declared shape" says in spec terms exactly
what design.md claims it says, including the "narrows an earlier guarantee ... deliberate" framing. The
`pipeline-step-config-read-strictness` delta adds the scenario "A previously-tolerated stored wrong-type
configuration now fails to decode". tasks.md 2.6 covers the test update and labels it PROOF. Substance matches
across all four artifacts.

**Round 3 CR-2 — RESOLVED.** The `pipeline-step-config-validation` delta's "proposal analyze surface" scenario
now reads "the typed decoder independently **fails** for the same raw configuration" (was: "yields an empty cast
map"). The "stored-pipeline analyze surface cannot report such a key" scenario now grounds its THEN on "the
configuration cannot be decoded for analysis at all". The stale "dropped key destroyed by the read round-trip"
paragraph is replaced by "This property SHALL NOT be claimed of the stored-pipeline analyze surface for a
wrong-typed key ...". tasks.md 2.7 covers `PipelineAnalyzeProposalRoutesSpec.scala:429-434`, labelled PROOF.

**Round 3 CR-3 — RESOLVED.** design.md's Evidence plan Guards line now reads "HEL-860's cast/rename
**write-path rejection** tests (those remain green)", and a new "Tests this change also moves, beyond HEL-671's
five" section names both moved tests as PROOF. The "flipping preview test" phrase is gone from the proof list
(grep for `flipping preview` across the change dir returns nothing outside the skeptic reports).

**No scenario name dropped from either MODIFIED delta.** Compared `### Requirement` + `#### Scenario` headings
in `openspec/specs/{pipeline-step-config-rejection,pipeline-step-config-validation}/spec.md` against the deltas:
rejection base has 1 requirement + 7 scenarios, delta has the same requirement + the same 7 names + 4 new;
validation base has 1 requirement + 11 scenarios, delta has the same 11 names + 4 new. Both are strict supersets;
openspec's "MODIFIED must not drop a scenario" rule is satisfied.

**Independent sweep (item 3) — three unacknowledged impacts found.** Grepping `openspec/specs/**` for
tolerant-decode requirements and the whole backend test tree for `decode(` assertions on defaulting/coercion
turned up material no artifact mentions. See CRs 1–3. Prior rounds did not probe these: grep across the change
dir for `assert-op|AssertStepSpec|AssertConfig|ChunkByTokenCountStepSpec|PipelineStepConfigCodecSpec` matches
only two incidental `chunkbytokencount.encoding` mentions in proposal.md:26 and tasks.md 5.1.

### Verdict: REFUTE

### Change Requests

1. **D1 contradicts a shipped, live spec requirement — `pipeline-assert-op` — and no delta modifies it.**
   `openspec/specs/pipeline-assert-op/spec.md:19-23` states: "`AssertConfig.decode` SHALL NOT throw for **any**
   input, including a config missing the `rules` key entirely ... and a `rules` array containing entries with
   missing or **malformed** fields (each malformed field defaulting rather than causing the entry, or the whole
   config, to be rejected)." That is not an absence-only guarantee — "malformed" and "or the whole config"
   directly cover D1's wrong-TYPE cases and task 2.3's "a mismatched array element fails the whole
   configuration". This is the same defect class round 3 caught for HEL-860, one layer deeper: a binding
   requirement silently reversed with no delta. Required: either add a `pipeline-assert-op` MODIFIED delta
   narrowing that requirement to absence/emptiness with the same measured justification D1 uses, or explicitly
   exempt `assert` from D1 in design.md with a stated reason — and reflect the choice in task 2.2's per-file
   conversion.

2. **Three existing tests that D1/D4 move are named nowhere, in a section that presents itself as the complete
   account of test impact.** design.md's "Tests this change also moves, beyond HEL-671's five" names exactly two
   files. At minimum these also move:
   - `backend/src/test/scala/com/helio/domain/steps/AssertStepSpec.scala:48-53` — `{"rules":["not-an-object", 42,
     null]}` asserts 3 all-defaults rules (wrong element type in an array → task 2.3 fails the whole config);
     `:70-73` — `params: "not-an-object"` asserts `JsObject.empty` (non-object for an object-valued key → D1
     raises); `:55-58` — `AssertConfig.decode("42")` asserts `AssertConfig(Vector.empty)`, which is precisely the
     `StepCodecUtil.asObject` fallback task 2.4 leaves undecided. Task 2.4 must name this test as the thing its
     decision moves or preserves.
   - `backend/src/test/scala/com/helio/domain/steps/ChunkByTokenCountStepSpec.scala:145-149` — "falls back to
     o200k_base for an unrecognized encoding value" asserts the exact coercion D4 abolishes for
     `chunkbytokencount.encoding`.
   - `backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodecSpec.scala:262-265` —
     "dedupe — malformed keep value falls back to first" asserts `DedupeConfig(Vector("id"), "first")` for
     `keep:"bogus"`, the exact coercion D4 abolishes for `dedupe.keep`.
   Required: extend that design.md section and add tasks covering each, labelled proof or guard per the run's
   evidence rule.

3. **D4 never states at which layer enum/numeric rejection happens, and the two readings differ in blast
   radius.** tasks.md 5.1 ("Case-normalize then reject unknown values for `filter.combinator`, `dedupe.keep`,
   `splittext.mode`, `chunkbytokencount.encoding`") names decoder-level concerns and reads as an instruction to
   edit `DedupeConfig.decode`/`ChunkByTokenCountConfig.decode`. Under that reading a stored row with a
   correct-TYPE but unknown enum value raises in `decode` → `PipelineStepRepository.rowToDomain:261` →
   **500 on listing steps** — the failure mode D1's own rationale calls "off the table", and one the 233-row
   measurement does not cover: that measurement counted wrong-JSON-type configs and missing/empty required
   fields, never unknown-but-correctly-typed enum values. Under the other reading (rejection at analyze/run
   only, decode merely case-normalizes) the `pipeline-step-config-validation` delta's scenarios are satisfied
   and CR-2's two enum tests stay green. Both readings are available from the current text; the deltas settle it
   only by omission. Required: state the layer explicitly in D4 and in task 5.1 — decode normalizes case and
   stays tolerant of unknown values, rejection lives at analyze/run (or the converse, with a measurement of
   stored unknown enum values backing it, as D1 has for wrong types). Whichever is chosen determines CR-2's
   labelling, so it must be resolved before execution rather than during it.

### Non-blocking notes

- `openspec/specs/pipeline-lookup-op/spec.md:63` and `pipeline-union-op/spec.md:37` already require a run-time
  failure naming the step for "the tolerant-decode default of an empty string". That is consistent with D3 and is
  useful in-repo precedent for D3's shape; worth citing in the `pipeline-step-config-runtime-completeness` delta.
- `LimitConfig.decode` (`LimitStep.scala:19-25`) returns `0` for a wrong-TYPE `count` as well as a
  non-representable one; D1 covers the first and D4 the second. Task 5.2 speaks only to the second — harmless, but
  the 1.1 table should make the split explicit so neither is missed.
