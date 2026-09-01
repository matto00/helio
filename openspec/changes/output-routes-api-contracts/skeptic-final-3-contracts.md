## Skeptic Report — final gate (round 3, skeptic-final-3-contracts.md)

Narrow re-verification of the single round-2 REFUTE finding (expand response `outputs`
described as `null` when it is actually an omitted key). Dimension: contract + schema
consistency only. Nothing else re-reviewed.

### What I verified (with evidence)

1. **Spec wording corrected — CONFIRMED.**
   `specs/pipeline-shape-registry/spec.md` now states the wire shape as `{ steps, outputs? }`
   (line 11-12) and, lines 20-30, explicitly: "**The `outputs` key is OMITTED from the response
   entirely today, never present as `outputs: null`**", grounded in
   `ExpandPipelineShapeResponse.outputs` being an `Option` serialized by `jsonFormat2` with no
   `NullOptions`. It names the semantics correctly ("optional-key semantics, `outputs?`, not a
   nullable-value field") and keeps the forward-compatible-present-array case. The **scenario
   text matches** (lines 36-44): "the raw response JSON has NO `outputs` key at all (not
   `outputs: null`) — asserted against the raw parsed `JsObject`, not just the unmarshalled case
   class". No surviving `outputs: null` claim anywhere in the file (grepped all `outputs`
   occurrences).

2. **Raw-JSON assertion is real — CONFIRMED.**
   `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineShapeRoutesSpec.scala:84-86`:
   ```scala
   val rawJson = responseAs[JsObject]
   rawJson.fields.keySet should contain("steps")
   rawJson.fields.keySet should not contain "outputs"
   ```
   This is a genuine raw-`JsObject` key-set assertion taken **before** any case-class
   conversion (`rawJson.convertTo[ExpandPipelineShapeResponse]` happens afterward, line 88), so
   it does distinguish omitted from `null` — an `outputs: null` body would put `"outputs"` in
   `fields.keySet` and fail. The weaker `resp.outputs shouldBe None` is retained additionally,
   not as a substitute.
   Fresh run: `sbt -batch 'testOnly ...PipelineShapeRoutesSpec'` → `Tests: succeeded 7, failed 0`.

3. **HEL-933 reference — CONFIRMED.** `specs/pipeline-create-api/spec.md:25` now reads
   "(filed as an addendum on HEL-933, with its own ...)"; no `unfiled` occurrence remains in
   the file.

4. **Validators re-run — CONFIRMED.**
   - `openspec validate output-routes-api-contracts --strict` → "Change 'output-routes-api-contracts' is valid" (exit 0)
   - `node scripts/check-schema-drift.mjs` → "schemas in sync with JsonProtocols (73 checked
     across 48 protocol files)", "panel-type enums in sync" (exit 0)

### Verdict: CONFIRM

The round-2 finding is genuinely fixed at both the documentation and the executable-evidence
level, and the fix is guarded by an assertion that would have caught the original error.

### Non-blocking notes
- The spec prose in lines 20-30 is unusually long-form for a requirement body; it reads more
  like a design rationale note. Accurate, so not blocking, but a future edit could move the
  spray-json mechanics into design.md and leave the requirement crisp.
