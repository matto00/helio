## Skeptic Report — final gate (round 5, skeptic-final-5-wire-diff.md)

Narrow scope: verify commit `b923666d`'s `parentStepId` fix, and trust-but-verify round 4's
claim that there are EXACTLY three response-side omitted-vs-null instances in this change.

### What I verified (with evidence)

**1. Spec wording — CONFIRMED correct.**
`openspec/changes/output-routes-api-contracts/specs/pipeline-shape-registry/spec.md`:
- L11 requirement wire shape: `parentStepId?: String` (optional-key form, not `String | null`).
- L16-18: "**for the FIRST step, the `parentStepId` key is OMITTED from that entry entirely,
  never present as a literal `null`**", grounded in `jsonFormat4` + no `NullOptions`.
- Scenario 1 (L46-50) and Scenario 2 (L56-57) both say OMITTED, and Scenario 1 explicitly
  states why a case-class `shouldBe None` is insufficient.
No `String | null` phrasing remains for this field.

**2. Tests — CONFIRMED genuinely raw-JSON.**
`backend/src/test/scala/com/helio/api/routes/pipelines/PipelineShapeRoutesSpec.scala`:
- Single-step test (L76-98): `val rawJson = responseAs[JsObject]` — the raw response body, not
  the unmarshalled case class. L88-89 destructure `steps` as a `JsArray` and assert
  `rawFirstStep.fields.keySet should not contain "parentStepId"` (key-absence on the raw object).
  Also asserts `rawJson.fields.keySet should not contain "outputs"`.
- Multi-step test (L102-125): `rawSteps` derived from `rawJson.fields("steps")`; asserts
  `rawSteps.head.fields.keySet should not contain "parentStepId"` (absence on entry 1) AND
  `rawSteps(1).fields("parentStepId") shouldBe JsString("step-0")` (presence as a real
  `JsString` on entry 2). Both are true raw-wire assertions, not case-class-level.

**3. Gates — both re-run by me, PASS.**
- `npx openspec validate output-routes-api-contracts --strict` → `Change 'output-routes-api-contracts' is valid`
- `node scripts/check-schema-drift.mjs` → `schemas in sync with JsonProtocols (73 checked across 48 protocol files)`; `panel-type enums in sync (7 surfaces checked)`

**4. Exhaustiveness pass — round 4's enumeration was NOT exhaustive. A fourth (and fifth) instance exists.**

Round 4 enumerated `Option[...]` fields in the touched `*Protocol.scala` files. That framing
missed the actual defect class, which is *spec text asserting `null` for a field that is in fact
omitted*. I re-derived it from the other direction: grepped every `null` claim across
`openspec/changes/output-routes-api-contracts/specs/`, then checked each against the real
serializer. Two surviving false `null` claims:

- `specs/pipeline-create-api/spec.md:37` — "`lastRunStatus: null`, `lastRunAt: null`"
- `specs/pipeline-list-api/spec.md:43` — "`lastRunStatus` (string or null), `lastRunAt`
  (ISO-8601 string or null), and `lastRunRowCount` (number or null)"
- `specs/pipeline-list-api/spec.md:58` — "**THEN** `lastRunStatus`, `lastRunAt`, and
  `lastRunRowCount` are all `null` in the response"

Ground truth: these are `PipelineSummaryResponse.lastRunStatus/lastRunAt/lastRunRowCount`,
`Option[...]` at `PipelineProtocol.scala:49-51`, serialized by
`PipelineProtocol.scala:215`: `jsonFormat9(PipelineSummaryResponse.apply)`. I re-confirmed
`grep -rn "NullOptions" backend/src/main/scala/` returns **nothing**. Therefore spray-json's
default `OptionFormat` DROPS these keys when `None` — the freshly-created-pipeline response has
NO `lastRunStatus` key at all, not `lastRunStatus: null`. This is byte-for-byte the same defect
just fixed three times (`outputs`, `nodeStepId`, `parentStepId`), by the identical proof.

Blind spot confirmed the same way too: `grep -rn "lastRunStatus" backend/src/test/scala/` shows
every assertion is case-class-level (`shouldBe None` / `shouldBe Some(...)`, e.g.
`OutputRoutesSpec.scala:619,661`, `PipelineRepositorySpec.scala:130,270`). Nothing anywhere
asserts the raw body, so nothing would ever catch this.

**Mitigating (why this is a narrow, cheap fix, not a scope expansion):** this wording is
inherited verbatim from main (`git show main:openspec/specs/pipeline-create-api/spec.md:19-20`
and `main:openspec/specs/pipeline-list-api/spec.md:44-45,58` are identical). This change did not
introduce it. But both are `## MODIFIED Requirements` bodies that this change is already
rewriting, and on archive this text becomes the new canonical spec on main — shipping a known-false
wire claim into the source of truth, in the exact requirement the change is editing.

### Verdict: REFUTE

The `parentStepId` fix itself is correct and well-tested (items 1-3 all clean). I am refuting
solely on item 4: the enumeration that justified closing this pattern was not exhaustive, and the
fourth instance is a live false claim in text this change ships.

### Change Requests

1. `openspec/changes/output-routes-api-contracts/specs/pipeline-create-api/spec.md:37` — replace
   "`lastRunStatus: null`, `lastRunAt: null`" with omitted-key wording, e.g. "no `lastRunStatus`
   and no `lastRunAt` key (both `Option` fields are `None` and are OMITTED by `jsonFormat9`, never
   present as a literal `null`)". Match the phrasing already used in the `pipeline-shape-registry`
   delta.

2. `openspec/changes/output-routes-api-contracts/specs/pipeline-list-api/spec.md:43` — change
   "`lastRunStatus` (string or null), `lastRunAt` (ISO-8601 string or null), and `lastRunRowCount`
   (number or null)" to optional-key form: `lastRunStatus?: String`, `lastRunAt?: String`
   (ISO-8601), `lastRunRowCount?: Number` — omitted when the pipeline has never run.

3. `openspec/changes/output-routes-api-contracts/specs/pipeline-list-api/spec.md:58` — the
   never-run scenario's THEN must say the three keys are ABSENT from the response object, not
   "all `null`".

4. Close the test blind spot for at least the never-run case, mirroring what `b923666d` did for
   `parentStepId`: add a raw-`JsObject` assertion (`responseAs[JsObject]`, then
   `fields.keySet should not contain "lastRunStatus"`) on the `GET /api/pipelines` or
   `POST /api/pipelines` never-run response. Every existing `lastRunStatus` assertion is
   case-class-level and cannot distinguish omitted from null.

### Non-blocking notes

- `scripts/concertino/next-report-number.sh` returned `number=1` for `skeptic-final` even though
  `skeptic-final-1-acl.md`, `-1-contracts.md`, `-1-wire-diff.md`, ... already exist — its scan
  does not match the `-N-<suffix>.md` variants this run has been using. Not blocking here (I used
  the orchestrator-supplied `skeptic-final-5-wire-diff.md`, verified absent), but it is a real
  collision hazard for any run that trusts it. Fix belongs upstream in Concertino, not here.
- Suggest a standing lint/check: any spec sentence asserting `X: null` for a field backed by a
  Scala `Option` on a non-`NullOptions` protocol is wrong by construction. This pattern has now
  cost four cycles.
