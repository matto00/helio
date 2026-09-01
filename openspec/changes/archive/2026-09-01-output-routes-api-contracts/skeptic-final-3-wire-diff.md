## Skeptic Report — final gate (round 3, skeptic-final-3-wire-diff.md)

Narrow verification of commit `4c1b9541`'s fix for round 2's single finding
(`expand`'s `outputs` key: omitted, not `null`). Wire-contract dimension only.

### What I verified (with evidence)

1. **Spec wording fixed — CORRECT.**
   `specs/pipeline-shape-registry/spec.md` lines 11–31 now state the response is
   `{ steps, outputs? }`, and explicitly: "**The `outputs` key is OMITTED from the response
   entirely today, never present as `outputs: null`**", with the correct mechanism
   (`Option[JsArray] = None` + `jsonFormat2` + no `NullOptions`). I independently confirmed
   the mechanism against ground truth:
   - `backend/.../protocols/pipelines/PipelineShapeProtocol.scala:88` —
     `ExpandPipelineShapeResponse(steps: Vector[...], outputs: Option[JsArray] = None)`
   - `:133-134` — `jsonFormat2(ExpandPipelineShapeResponse.apply)`
   - `grep -rn "NullOptions" backend/src/main/scala` → **zero hits**, so the default
     `OptionFormat` drops the field. Spec text matches the code.
   - Scenario at line 42-45 was updated to assert absence of the key, and to explain why
     `resp.outputs shouldBe None` is insufficient.

2. **Raw-JSON assertion is real and passes — CONFIRMED.**
   `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineShapeRoutesSpec.scala`
   (expand-envelope test) now does:
   ```scala
   val rawJson = responseAs[JsObject]
   rawJson.fields.keySet should contain("steps")
   rawJson.fields.keySet should not contain "outputs"
   val resp = rawJson.convertTo[ExpandPipelineShapeResponse]
   ```
   This inspects the raw parsed response body's key set, not the unmarshalled case class —
   exactly the gap round 2 named. Ran it myself:
   `sbt "testOnly com.helio.api.routes.pipelines.PipelineShapeRoutesSpec"` →
   `Tests: succeeded 7, failed 0`. Both assertions are ordinary failable ScalaTest
   `keySet` assertions (the passing `should contain("steps")` on the same object proves the
   raw object is genuinely populated, so `not contain "outputs"` is not vacuous).

   **Round 2's finding is genuinely fixed.** This is not the same finding surviving.

3. **HEL-933 reference — CONFIRMED.**
   `specs/pipeline-create-api/spec.md:25` now reads
   "**Known gap, not implemented in this change (filed as an addendum on HEL-933, …)**".
   `grep` for "unfiled" in that file returns nothing.

4. **Systemic spot-check of other Option-typed wire claims — FOUND ONE MORE.**
   I checked every `null`/`nullable`/`absent` claim across the change's spec deltas against
   the shipped protocol case classes + formats:

   - `specs/output-routes-api/spec.md:25` — "the response is `201 Created` with an Output
     whose `nodeStepId` is null". **This is wrong in exactly the same way.**
     `backend/.../protocols/pipelines/OutputProtocol.scala:19` declares
     `OutputResponse.nodeStepId: Option[String]`, serialized at `:54` by
     `jsonFormat10(OutputResponse)` on a trait with no `NullOptions`. A root-bound Output
     (`nodeStepId = None`) therefore serializes with **no `nodeStepId` key at all**, not
     `nodeStepId: null`. Line 20's request-side wording ("`nodeStepId` absent or null SHALL
     bind … to the pipeline root") is fine — this is purely the response-side scenario.
     This matters for the same reason round 2's did: `output-routes-api` is the headline
     NEW API of this change and HEL-934's consumers will be written from this text; a client
     writing `output.nodeStepId === null` gets `undefined` and silently mis-branches.

   - `specs/pipeline-list-api/spec.md:43,58` (`lastRunStatus`/`lastRunAt`/`lastRunRowCount`
     "are all `null`") and `specs/pipeline-create-api/spec.md:37`
     (`lastRunStatus: null, lastRunAt: null`) have the same imprecision
     (`PipelineSummaryResponse` at `PipelineProtocol.scala:44-54` is `jsonFormat9` with
     three `Option` fields → keys omitted). **However**, I verified via
     `git show main:openspec/specs/{pipeline-list-api,pipeline-create-api}/spec.md` that this
     exact wording is **pre-existing on `main`** and unchanged by this change, on
     non-breaking pre-existing routes. Inherited debt, not a regression introduced here →
     non-blocking note, not a change request.

   Note for contrast: `CreatePipelineRequest`'s format (`PipelineProtocol.scala:185-206`) is
   deliberately hand-rolled to write `"tag" -> … .getOrElse(JsNull)`, confirming this codebase
   writes explicit nulls only where it opts in — the default really is omission.

### Verdict: REFUTE

**This is a NEW finding, not the round-2 finding surviving.** Round 2's specific defect
(`pipeline-shape-registry` / `expand`) is fixed, spec-corrected, and now guarded by a real
raw-JSON test that I ran. The dimension-3 sweep the coordinator asked for turned up one more
instance of the same class in a different, newly-added delta. It is a one-line spec wording
fix with no code change.

### Change Requests

1. `openspec/changes/output-routes-api-contracts/specs/output-routes-api/spec.md:25` — the
   scenario "Owner creates an Output at the pipeline root" claims the created Output's
   `nodeStepId` "is null". It is not: `OutputResponse.nodeStepId` is `Option[String]`
   serialized by `jsonFormat10` with no `NullOptions` (`OutputProtocol.scala:19`, `:54`), so
   the key is **omitted entirely** from the `201` body. Reword to optional-key semantics
   (e.g. "…with an Output that has **no `nodeStepId` key** — root binding is represented by
   the key's absence, not by `nodeStepId: null`"), matching the wording pattern just adopted
   in `pipeline-shape-registry/spec.md`. Also consider mirroring it in the requirement text
   at line 20 so the request-side ("absent or null both accepted") and response-side
   ("always omitted when root-bound") asymmetry is explicit — that asymmetry is real and
   easy for a consumer to get wrong.
2. Add a raw-JSON assertion for this to the Outputs route spec, mirroring the one added to
   `PipelineShapeRoutesSpec` in `4c1b9541`: on the root-bound-create test, assert
   `responseAs[JsObject].fields.keySet should not contain "nodeStepId"`. Without it, the
   same "asserted on the deserialized type" hole that produced this finding twice stays open
   on the change's most consumer-facing new route.

### Non-blocking notes

- `specs/pipeline-list-api/spec.md:43,58` and `specs/pipeline-create-api/spec.md:37` describe
  `lastRunStatus`/`lastRunAt`/`lastRunRowCount` as `null` in the response when in fact those
  keys are omitted. **Pre-existing wording carried unchanged from `main`** on pre-existing
  routes — do not churn this change for it; worth a small standalone cleanup ticket
  (or an addendum on HEL-933) covering the whole spec corpus.
- `specs/pipeline-shape-registry/spec.md:80` still says "the new `{ steps, outputs }`
  envelope" in the additive/no-persistence scenario. Harmless in context (it names the
  envelope, not the key set), but `{ steps, outputs? }` would be consistent with the
  corrected text above it.
- Everything else in scope for this round verified clean. Route/ACL and deletion-sweep
  dimensions were not re-run, per the coordinator's instruction.
