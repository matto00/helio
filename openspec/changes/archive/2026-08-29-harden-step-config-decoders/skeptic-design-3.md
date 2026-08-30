## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round 2's blocking CR (proposal.md:49) — RESOLVED.**
proposal.md's Impact now reads "3 of HEL-671's 5 characterization tests flip (`pivot`, `unpivot`, `window` — all
wrong-**type** fixtures). The other 2 are relabelled as guards..." Grep across all non-skeptic artifacts for a
surviving 4th-flip / preview-flips claim (`4 of 5|fourth flip|preview test would flip|all 5|all five`) returns only
`ticket.md:41` ("all 5 of these tests should fail") and `ticket.md:133`, both inside the ticket's own historical
framing — line 133 is the RESOLVED-DESIGN-DECISIONS block explicitly correcting line 41. No live artifact claim
remains. No new inconsistency introduced.

**The 3 flips are genuinely wrong-TYPE; the 2 guards genuinely cannot flip (verified against fixtures, not reports).**
`RefinementEditShapeSpec.scala:271-303`:
- pivot: `{"index": "region", ...}` — JsString for an array key. Wrong type. Flips under D1.
- unpivot: `{"valueVars": "q1", ...}` — JsString for an array key. Wrong type. Flips. (Its second assertion
  `varName shouldBe "variable"` is an *absence* default — tasks 6.1 correctly relocates it to the 2.5 guard.)
- window: `{"partitionBy": "region", "orderBy": ["revenue"], ...}` — non-array `partitionBy` AND a bare-string
  element in `orderBy`. Both wrong type. Flips.
- join: `{"rightDataSourceId": "src_456", "joinType": "inner"}` — `joinKey` genuinely absent. Cannot flip under D1/D2.
`PatchSetPreviewServiceSpec.scala:595` fixture: `JsObject("rightDataSourceId" -> ..., "joinType" -> ...)`, comment
"joinKey is OMITTED entirely (never `\"\"` explicitly)". Absence. Cannot flip. D5's table is accurate.

**The two note edits are correct.**
- tasks 4.1 (raw config string): consistent with the `pipeline-step-config-validation` delta's existing
  raw-config-string contract for the proposal analyze surface, and with 4.3's `validationError` routing. No conflict
  with D2/D3.
- tasks 7.2 (assert 422 + a message naming `joinKey`, not any `Left`): correct and necessary — `{"joinKey":123}` is
  also a D1 decode raise, which `validateEmbeddedStepReferences` surfaces as a 400, so a bare-`Left` assertion would
  pass with 3.2's wiring omitted. Task 3.2 already requires pinning that status, so 7.2 is satisfiable.

**Step-kind count**: `backend/src/main/scala/com/helio/domain/steps/` holds 25 entries = 23 step files + `README.md`
+ `StepCodecUtil.scala`. "23 step kinds" is correct.

**New finding (neither prior round probed this).** D1 breaks a shipped, spec-backed, test-backed HEL-860 guarantee,
and the plan neither acknowledges nor budgets for it. See CR-1/CR-2.

### Verdict: REFUTE

### Change Requests

1. **D1 silently reverses HEL-860's AC3 read-tolerance guarantee for wrong-TYPE legacy rows, and no artifact says so.**
   `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala:1019-1035` raw-inserts a legacy
   row `'{"casts":[{"field":"amount","to":"double"}]}'` and asserts `GET /pipelines/:id/steps` returns **200** with
   `resp.config.casts shouldBe empty`, under the comment "this change only adds a WRITE-path check; CastConfig.decode's
   tolerance is untouched". `CastConfig.decode` (`CastStep.scala:20-27`) matches `Some(o: JsObject)` and falls through
   to `Map.empty` for a JsArray. Under D1 + task 2.2 ("an object-valued key whose value is not a JSON object" SHALL
   fail), that stored row now raises → `PipelineStepRepository.rowToDomain:261` throws → **500 on listing steps** —
   precisely the failure mode D1's own rationale says is "off the table" for absence, now reachable for wrong type.
   The 233-row measurement argues no *production* row is affected, but a deliberate contract and its test are.
   Required: state this explicitly in design.md (D1) as a knowingly-reversed HEL-860 decision with its rationale,
   add a task to update that test to its new expected behavior, and add a matching clause to the
   `pipeline-step-config-read-strictness` and `pipeline-step-config-rejection` deltas — the latter currently says only
   "The read path SHALL be unchanged for absent and empty keys", which does not disclose that it *is* changed for a
   present wrong-type stored key.

2. **The `pipeline-step-config-validation` delta retains two scenarios that D1 makes unsatisfiable, and one existing
   test that D1 makes red.** The delta keeps:
   - "The proposal analyze surface reports a key the typed decoder would discard" — whose second THEN clause is "the
     typed decoder independently yields an empty cast map for the same raw configuration". Under D1 the decoder
     **raises** for that raw configuration instead. `PipelineAnalyzeProposalRoutesSpec.scala:434` asserts exactly this
     (`CastConfig.decode(...).casts shouldBe empty`) and will fail.
   - "The stored-pipeline analyze surface cannot report such a key" — GIVEN a persisted cast step with that shape,
     THEN "no `validationError` is reported for that step". Under D1 that pipeline no longer analyzes at all (500 per
     CR-1); the GIVEN has no satisfiable instance once every wrong-type config raises.
   The retained mechanism paragraph ("a dropped key is destroyed by the read round-trip before inference runs") is
   likewise stale: after D1 there is no dropped key. Required: revise both scenarios and that paragraph so they are
   consistent with the read-strictness delta, and add a task covering the `PipelineAnalyzeProposalRoutesSpec:429-434`
   assertion.

3. **design.md's Evidence plan misclassifies these tests as guards.** It lists "the existing HEL-860 cast/rename
   rejection tests" under **Guards** ("green before and after"). CR-1 and CR-2 show at least two HEL-860 assertions are
   *not* green after. Required: correct the evidence plan, and extend D5's impacted-test table beyond HEL-671's five to
   name the HEL-860 tests this change also moves — the table's current framing ("3 of 5") reads as a complete account of
   test impact and is not one.

### Non-blocking notes

- tasks 1.1 says "all 23 files in `backend/src/main/scala/com/helio/domain/steps/`"; the directory holds 25 files (23
  step files + `README.md` + `StepCodecUtil.scala`). The intent is unambiguous, but the two-directional enumeration
  that 1.1 itself demands would be cleaner phrased as "23 step-kind files".
- design.md D5's evidence plan lists "the flipping preview test" among proof items; per D5's own table the preview test
  does not flip — the proof there is the *new* 7.2 test. Wording only, but it is the same phrase round 1 refuted.
