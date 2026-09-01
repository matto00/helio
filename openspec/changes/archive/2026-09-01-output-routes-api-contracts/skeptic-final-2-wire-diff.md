## Skeptic Report — final gate (round 2, skeptic-final-2-wire-diff.md)

**Dimension: wire-contract diff only.** Route/ACL correctness and contract+schema consistency
are two sibling skeptics' dimensions this round; deletion-sweep CONFIRMed in round 1.

*Filename note:* `next-report-number.sh` returned `number=1 path=.../skeptic-final-1.md` — it
does not recognize round 1's dimension-suffixed names (`skeptic-final-1-wire-diff.md` etc.), so
its counter is stale. I used the coordinator-specified `skeptic-final-2-wire-diff.md`, which is
collision-free (verified: no such file existed). Not a guessed fallback.

### What I verified (with evidence)

Re-derived fresh at HEAD (`abd7ff22`), not from the executor's narrative.

**CR1 — DELETE /api/pipeline-steps/:id 204→200 (VERIFIED FIXED).**
`specs/pipeline-steps-persistence/spec.md` now carries a `MODIFIED` delta stating `200 OK` with
`{ "removedTailStepCount": <int> }`, explicitly labelled **BREAKING**, with three scenarios.
I independently checked both consumers rather than trusting the claim:
- `frontend/src/features/pipelines/services/pipelineService.ts:119-121` —
  `deletePipelineStep(stepId): Promise<void>` is `await httpClient.delete(...)`; return value
  discarded. Its caller `PipelineDetailPage.tsx:457` is `void deletePipelineStep(stepId).catch(...)`
  — only the rejection path is read.
- `helio-mcp/src/helioApi.ts:1052-1055` — `await this.http.delete(...)` then returns a
  locally-constructed `{ deleted: true, id: stepId }`; the response is never touched.
- Repo-wide grep for a `204`/`NoContent` assertion against this route across `e2e/`,
  `frontend/src`, `helio-mcp/src` and the backend test tree: **zero** live assertions
  (`PipelineStepRoutesSpec.scala:337` mentions "204" in a comment only).
The executor's consumer claim is **true as stated**.

**CR2 — preview `outputId` optional (VERIFIED FIXED).**
`PipelineRunStatusRoutes.scala:53-58` is now `parameters("outputId".optional)` dispatching to
`runService.previewOutputs(pipelineId, outputIdRaw.map(OutputId(_)), user)`.
`PipelineRunService.scala:284-317` implements both arms for real: `Some(id)` → one entry;
`None` → `listByPipelineInternal` fanned out over distinct node keys → one entry per Output.
Envelope matches the schema exactly: `PipelinePreviewResponse(outputs: Vector[OutputPreviewEntry])`
/ `OutputPreviewEntry(outputId: String, preview: RunResultResponse)`
(`PipelineProtocol.scala:160/166`, `jsonFormat2`/`jsonFormat1` at 256/257) vs
`schemas/pipelines/pipeline-preview-response.schema.json`'s
`{ outputs: [{ outputId, preview }] }`, both required, `additionalProperties: false`. Uniform
across both arms.

**CR3 — false verification citation (VERIFIED FIXED).**
`PipelineRunService.scala:319-326` now cites `PipelineRunServiceSpec`'s `previewOutputs` describe
block and `OutputRoutesSpec`. All four cited tests exist and assert what is claimed:
- `PipelineRunServiceSpec.scala:1043` (single-Output arm) and `:1115` (all-Outputs arm) — each
  captures `lastRunStatus`/`lastRunAt` before, and each performs a **real run on a different
  pipeline in between** (`:1053-1059`, `:1130`) to prove the assertion mechanism can detect a
  mutation. This is a genuine guard, not a vacuous green.
- `OutputRoutesSpec.scala:603` and `:644` — HTTP-level, real DB round-trip, both asserting
  `lastRunStatus`/`lastRunAt` remain `None`.

**CR4/CR5 — pipeline-shape-registry (FIXED, one residual — see CR-A below).**
The delta now correctly states the request is `{ "params": <object> }` with **no** `parentStepId`
(matches `ExpandPipelineShapeRequest(params: JsObject)` / `jsonFormat1`,
`PipelineShapeProtocol.scala:53/129-130`), documents the clientId/parentStepId chaining as
**response-side** metadata, and describes `steps` entries as
`{ clientId, kind, config, parentStepId }` (matches `jsonFormat4`, line 132). The unimplementable
`OutputContract` scenario is **gone** — `OutputContract` now appears exactly once in the whole
change dir, as honest prose explaining why `outputs` is always empty.

**CR6 — pipeline-create-api (FIXED).** Delta field names now match shipped byte-for-byte:
`sourceDataSourceId` required, `steps[]` = `{ clientId, type, config, parentStepId?, enabled? }`,
`outputs[]` = `{ nodeStepClientId?, kind, name, config? }`, response = bare
`PipelineSummaryResponse` carrying no step/Output ids — all confirmed against
`PipelineProtocol.scala`'s `CreatePipelineTransactionalStepRequest` /
`CreatePipelineTransactionalOutputRequest` / `CreatePipelineRequest` / `PipelineSummaryResponse`.
The inline-source gap is now genuinely tracked: **HEL-933 carries an "Addendum (2026-09-01)"**
adding it to scope with its own AC (verified directly against Linear, not inferred).

**CR7 — output-routes-api (all four sub-issues FIXED).**
(a) delta now says `?offset=&limit=` and explicitly "NOT a `page`/`pageSize` scheme"; matches
`OutputRoutes.scala:90` and `:112` (`parameters("offset".as[Int].withDefault(...), "limit"...)`).
(b) list is now documented as owner-scoped, with a scenario asserting an editor's Output is
absent from it. (c) 403-vs-404 is now differentiated per route and matches the code's actual
posture. (d) the `config.format` requirement is **removed** from this delta and now appears in
HEL-933's scope (confirmed in the Linear ticket body).

**CR8 — unshipped deltas (VERIFIED DELETED).** `specs/` now contains 10 directories; neither
`dashboard-panel-layouts` nor `data-source-persistence` is among them.

**CR9 — stale scaladoc (VERIFIED FIXED).** `PipelineProtocol.scala:20-21` now states the
compensating-delete "was an earlier cycle's implementation and was deleted outright once the real
transaction" landed — matches D3 and the shipped `runTransactionally`.

**Independent enumeration for further undisclosed breaking wire changes (item 7).**
Systematic, not a spot-check:
- `git diff main...HEAD --stat -- backend/.../api schemas/` → 33 files, all reviewed.
- Every *removed* line in each pre-existing protocol file:
  - `PipelineProtocol.scala` → only `dataTypeId`→`outputId` (route deleted in P1.1, sanctioned)
    and `jsonFormat3`→`jsonFormat5` on `CreatePipelineRequest` (additive, defaulted fields).
  - `PipelineShapeProtocol.scala` → only the disclosed `expand` envelope/entry change.
  - `PipelineStepProtocol.scala` → purely additive (`parentStepId` optional, `jsonFormat4`→`5`;
    new `DeletePipelineStepResponse`).
  - `PaginationProtocol.scala` → two new `PagedResult` instantiations, no existing format touched.
- Grepped every `+`/`-` line under `routes/` matching `NoContent|StatusCodes.|Created|complete(`:
  the ONLY status-code change on a pre-existing route in the entire diff is
  `-ServiceResponse.runNoContent(pipelineService.deleteStep(...))` (CR1, now disclosed).
- `ApiRoutes.scala` removals: import/constructor rewiring plus the `PublicDashboardRoutes`
  constructor gaining two `Option` repos. No route removed or remounted.
- Analyze-schema `type` `enum` narrowings: unchanged from round 1's non-blocking read.

**Conclusion of the enumeration: exactly two breaking wire changes exist in this diff
(`expand` envelope, `DELETE /api/pipeline-steps/:id`), and both are now disclosed.** I found no
third. Round 1's CR1–CR9 are all genuinely fixed.

### Verdict: REFUTE

One residual defect, of the same *class* round 1 flagged (shipped spec delta states a wire shape
the code does not emit) but **not the same finding** — this is a new, distinct sub-issue on the
`pipeline-shape-registry` delta that round 1 did not raise and the two subsequent cycles
introduced/left. This is therefore **not** the "REFUTE on the identical finding → stop and
escalate" condition the coordinator described. It is a one-line wording fix.

### Change Requests

1. **`pipeline-shape-registry` delta promises `outputs: null`; the wire omits the key entirely.**
   The delta states the success body is `{ steps: [...], outputs: null }` and its first scenario
   asserts "`outputs` is `null`". The shipped type is
   `ExpandPipelineShapeResponse(steps: Vector[...], outputs: Option[JsArray] = None)`
   (`PipelineShapeProtocol.scala:88`), serialized by `jsonFormat2` on a trait that extends
   `DefaultJsonProtocol` **without** `NullOptions` (`PipelineShapeProtocol.scala:95`; verified
   `NullOptions` appears **nowhere** in `backend/src/main/scala`). spray-json 1.3.6's
   `ProductFormats.productElement2Field` is
   `case _: OptionFormat[_] if (value == None) => rest` — the field is **dropped**, not written as
   `null` (source read from the resolved
   `spray-json_2.13-1.3.6-sources.jar`). So the actual body today is `{"steps":[...]}` with no
   `outputs` key at all.
   This matters more than usual here: `expand` is one of only two BREAKING routes in this change,
   its consumers are being rewritten under HEL-934, and this delta is the contract they will be
   written against — a consumer coded to `response.outputs === null` gets `undefined`. It is also
   this repo's most repeatedly-costly gotcha (spray-json omits `Option = None`).
   `PipelineShapeRoutesSpec.scala:85` (`resp.outputs shouldBe None`) cannot catch it, because it
   asserts on the *unmarshalled case class*, where an absent key and an explicit `null` are both
   `None`.
   Required: change the delta's response shape to `{ steps: [...] }` and restate the prose/scenario
   as "`outputs` is **absent from the response body** today (spray-json omits a `None` `Option`);
   it is reserved as a forward-compatible optional field." Optionally, pin it with a raw-JSON
   assertion (`responseAs[JsObject].fields.contains("outputs") shouldBe false`) so the wire shape,
   not just the case class, is guarded.

2. *(Fold into the same edit — trivial.)* `specs/pipeline-create-api/spec.md`'s known-gap note
   still reads "**unfiled as of this writing** — flagged for a follow-up ticket". It **is** now
   filed: HEL-933's "Addendum (2026-09-01)" carries the inline-source variant with its own
   acceptance criterion. Replace the parenthetical with the HEL-933 reference so the archived
   spec does not record a stale "unfiled" status for tracked work.

### Non-blocking notes

- The `previewOutputs` all-Outputs arm calls `previewAtNode` once per *distinct node key*
  (`PipelineRunService.scala:305-306`), correctly de-duplicating Outputs that share a node — a
  genuinely good touch, and the resulting per-Output entries are re-expanded from `byNodeKey` so
  the envelope still has one entry per Output. No contract concern; noted as verified-correct.
- `pipeline-preview-response.schema.json` types `preview` as a bare `{"type": "object"}` rather
  than `$ref`-ing a `RunResultResponse` schema. Acceptable (no such schema exists to reference),
  but it means the schema validates nothing about the preview payload itself.
