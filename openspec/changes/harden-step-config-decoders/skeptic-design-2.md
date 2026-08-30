## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**1. The corrected "3 of 5 flip" claim is TRUE — verified against the real fixtures, not the narrative.**
`backend/src/test/scala/com/helio/services/patchsets/RefinementEditShapeSpec.scala:265-303`:
- `pivot` — `{"index": "region", ...}`: `JsString` where the decoder reads an array. Wrong **type** → raises
  under D1. Flip is real. (Its `values`/`agg` are `stringOr` scalars supplied as strings, i.e. correct type —
  the flip is carried solely by `index`, which is enough.)
- `unpivot` — `{"valueVars": "q1", ...}`: `JsString` where an array is read. Wrong type → flips.
- `window` — `{"partitionBy": "region", "orderBy": ["revenue"], ...}`: wrong type on `partitionBy` AND a
  wrong element type in `orderBy` (a bare string that does not `convertTo[SortKey]`). Flips twice over.
- `join` — `{"rightDataSourceId": "src_456", "joinType": "inner"}`: `joinKey` **absent**. `JoinConfig.decode`
  (`JoinStep.scala:18-24`) reads it via `StepCodecUtil.stringOr(obj, "joinKey", "")`; an absent key takes the
  default, which D1 explicitly preserves. Cannot flip. Correctly a guard.
- `PatchSetPreviewServiceSpec.scala:592-594` — fixture is
  `JsObject("rightDataSourceId" -> ..., "joinType" -> JsString("inner"))`; `joinKey` absent, as the test's own
  comment states. `validateRawConfig` under D2 rejects wrong-type only, the rejection spec says in terms that
  absence SHALL NOT be rejected, decode succeeds under D1, and `validateEmbeddedStepReferences`
  (`PatchSetApplyResolvers.scala:213-241`) only does a `findByIdOwned` on `rightDataSourceId`, which the
  fixture supplies validly. Preview still returns `Right`. Cannot flip. Correctly a guard.
  **3 flips, 2 guards is the accurate count.** Round 1's CR-1/2/4/5 were addressed in substance in
  design.md D5, ticket.md D5, and tasks.md 6.2/8.4 — not merely reworded.

**2. tasks.md 7.2's replacement PROOF test is achievable.**
`{"rightDataSourceId":"<real id>","joinKey":123}` — `joinKey` present, `JsNumber` where a string is declared.
Task 3.2 orders `validateRawConfig` **before** the existing decode, so the D2 hook fires and returns `Some(msg)`
→ `Left`. It is also independently caught by D1 (`stringOr` on a `JsNumber` becomes a raise), so the test
cannot pass vacuously and there is no ordering hazard that would let it through. Nothing about the
`rightDataSourceId` referential check runs first. The one caveat is in note 2 below.

**3. D3 is coherent with the real machinery; it will not fracture on contact.**
- Analyze: `PipelineAnalyzeService.analyze:61-85` already runs `validateStepConfig(kind, rawConfig)` BEFORE the
  per-kind `infer*` dispatch, falls the output schema back to identity on a validation failure, and joins
  multiple failures for one step into a single message (`validateStepConfig:99-120`). tasks.md 4.3 describes
  exactly that contract. This is an extension of an existing dispatch, not new machinery — the claim checks out.
- Run: `InProcessPipelineEngine.scala:14-35` defines `StepExecutionException(stepId, stepKind, reason)` and
  wraps it around every step in the fold uniformly (`:124-140`), so a required-field check raising an
  `IllegalArgumentException` is automatically attributed to the failing step with its kind. HEL-859's shape is
  real and reusable as claimed.
- "One required-field declaration driving both": achievable, because analyze holds the raw config string while
  the engine holds a decoded config plus `Companion.encodeConfig` (`PipelineStep.scala:80`), so a raw-config
  predicate can serve both surfaces. See note 1 — the plan does not say which side it is evaluated on.

**4. Internal contradictions — one remains, and it is the inverse problem round 2 was asked to look for.**
Grepped every artifact. ticket.md D5, design.md D5, tasks.md 6.2/6.3/7.2/8.4 and all four spec deltas are now
mutually consistent on 3-flips/2-guards. **`proposal.md:49` still reads "4 of HEL-671's 5 characterization tests
flip; the 5th is relabelled as a read-tolerance guard."** That is verbatim the claim round 1 refuted as false,
surviving in the change's proposal — the artifact whose Impact section an executor and the PR author read.
tasks.md 8.4 requires the PR to state "3 of 5"; proposal.md tells it the opposite. Everything else checked
clean: the specs remain correct and the corrections did not invert them.

**5. Scope: wide but not over-budget for 3 cycles; I do not ask for a split.**
The work is 23 mechanical `validateRawConfig` overrides + 23 decoder conversions driven by the 1.1 enumeration
table, both table-driven and repetitive rather than novel; two 1-line wiring sites; one required-field
declaration consumed by two existing dispatches; and a 4-value enum sweep. The only genuinely new surface is
`StepCodecUtil`'s strict extractors (task 2.1), which is small. A split would have to cut D3, and design.md's
argument against that is sound — shipping D2 alone (drafts savable, nothing enforcing completeness) is a net
regression in guarantees. Splitting would be worse than the size risk. Natural cycle ordering if the executor
needs one: (1) enumeration + 2.x read path + 6.x characterization flips; (2) 3.x write path + wiring + 7.1/7.2/7.2b;
(3) 4.x/5.x run/analyze/enums + 7.3/7.4/7.5.

### Verdict: REFUTE

### Change Requests

1. **`proposal.md:49` — apply round 1's CR-1/CR-4 correction here too.** Replace "4 of HEL-671's 5
   characterization tests flip; the 5th is relabelled as a read-tolerance guard." with the corrected statement:
   **3 of the 5 flip** (`pivot`, `unpivot`, `window` — all wrong-**type** fixtures), and **2 are relabelled as
   guards** (`PatchSetPreviewServiceSpec`'s preview test and the `join` decode test, both of which hinge on
   `joinKey` being **absent**, which D1 and D2 deliberately keep tolerant; completeness is enforced instead at
   run and analyze time by D3), with the lost flip replaced by tasks.md 7.2's new present-but-wrong-type
   preview-rejection test. This is the last surviving copy of the exact claim round 1 refuted, and it sits in
   the document the PR's Impact text will be written from.

### Non-blocking notes

- tasks.md 4.1 states the required-field declaration must drive both run and analyze "so the two surfaces
  cannot disagree" but does not say which representation it is evaluated against. Analyze holds a raw config
  string (`validateStepConfig(kind, config)`); the engine holds a decoded config. Suggest stating that the
  predicate operates on the raw config, with the run path obtaining it via `Companion.encodeConfig`, so the
  "cannot disagree" property is structural rather than aspirational.
- tasks.md 7.2's wrong-type join config is caught by BOTH D1's decode raise (→ `BadRequest`/400) and D2's
  `validateRawConfig` (→ the 422 that 3.2 must pin). Since 3.2 orders validate first, the test should assert
  the D2 status and a message naming `joinKey`, otherwise it would still pass if the wiring in 3.2 were
  omitted entirely — i.e. it would stop being proof of the ticket's actual defect.
- design.md's Risks section covers the wrong-type-row-created-after-measurement → 500 case and tasks.md 8.5
  requires the PR to say it out loud. Both round-1 non-blocking notes (the `unpivot` `varName` assertion moving
  to the 2.5 guard, and pinning the preview rejection's `ServiceError`) were folded into tasks.md 6.1 and 3.2.
