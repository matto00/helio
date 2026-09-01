## Skeptic Report — final gate (round 2, skeptic-final-2-contracts.md, contracts+schema dimension)

Verified fresh against HEAD `abd7ff22`.

### What I verified (with evidence)

1. **Hard requirements still hold.**
   - `git diff origin/main...HEAD -- backend/.../DashboardProposalService.scala helio-mcp/src/tools/proposal.ts` → **0 lines**. Still untouched after cycles 9 and 10.
   - `node scripts/check-schema-drift.mjs` → `schemas in sync with JsonProtocols (73 checked across 48 protocol files)`, `panel-type enums in sync`, exit 0.
   - `npx openspec validate output-routes-api-contracts --strict` → `Change 'output-routes-api-contracts' is valid` (run twice, both green — item 6).

2. **`specs/pipeline-preview-api/spec.md` vs shipped code — round 1's real defect is genuinely fixed.**
   - Route `PipelineRunStatusRoutes.scala:53-58`: `path("preview") { post { parameters("outputId".optional) { ... previewOutputs(pipelineId, outputIdRaw.map(OutputId(_)), user) } } }` — `outputId` is now truly optional, matching the spec.
   - Service `PipelineRunService.previewOutputs` (l.284-317) matches the delta clause-for-clause: single arm resolves via sharing-aware `outputRepo.findById`, 404s on cross-pipeline mismatch; absent arm gates at `pipelineRepo.findByIdShared`, computes `distinctNodeKeys` **once** and fans back out, `collectFirst` returns the FIRST failure rather than a partial envelope, zero Outputs yields `PipelinePreviewResponse(Vector.empty)` → `{outputs: []}`.
   - Envelope: `PipelinePreviewResponse(outputs: Vector[OutputPreviewEntry])`, `OutputPreviewEntry(outputId, preview: RunResultResponse)` (PipelineProtocol.scala:160/166, formats l.256-257) — identical in both arms, matching `schemas/pipelines/pipeline-preview-response.schema.json`.
   - Cited tests exist and are per-arm (`PipelineRunServiceSpec.scala:993`, `:1043`, `:1115`) — not a false citation this time.

3. **`specs/pipeline-shape-registry/spec.md`** — request shape now correctly states `{ "params": <object> }` with no request-side `parentStepId`, matching `ExpandPipelineShapeRequest(params: JsObject)` (PipelineShapeProtocol.scala:53). `steps` entry shape matches `ShapeStepExpansionResponse(clientId, kind, config, parentStepId)` (l.66). The unimplementable OutputContract-outputs scenario is gone. **One residual inaccuracy — see CR1.**

4. **`specs/output-routes-api/spec.md`** — all four round-1 sub-issues fixed:
   - Pagination is `offset`/`limit` and explicitly disclaims `page`/`pageSize`; matches `OutputRoutes.scala:90` / `:112` (`Page.Default.offset`=0, `Page.Default.limit`=200, clamped by `Page.MaxLimit`=500, negative offset → 400). Spec's "default offset 0, limit 200" matches `pagination.scala:11`.
   - Ownership scoping is worded owner-only and names `findAllByOwner`; matches `OutputService.listAll` → `outputRepo.findAllByOwner(user.id, page)` (l.51-52), including the scenario that an editor's Output is absent from `GET /api/outputs`.
   - 403-vs-404 wording matches shipped: 403 for an authenticated non-grantee on create, 404 for a non-owner grantee on PATCH/DELETE (owner-only RLS).
   - `grep -rn "HEL-876|config.format"` across this change's `specs/` → **no matches**; the unshipped requirement text is gone.

5. **Deferred deltas actually deleted.** `ls .../specs/` shows 10 dirs; `dashboard-panel-layouts` and `data-source-persistence` are absent (deleted, not edited).

### Verdict: REFUTE

One narrow, concrete contract-vs-wire inaccuracy. It is the **same class** as round 1's findings (a spec delta asserting a shape the code does not produce) but a **different, new instance** — not a repeat of any round-1 item, all four of which I confirmed fixed above.

### Change Requests

1. **`specs/pipeline-shape-registry/spec.md` — `outputs` is ABSENT on the wire, not `null`.**
   The delta states the success body is `{ steps: [...], outputs: null }`, and the "Expand succeeds for a registered shape with valid params" scenario asserts "`outputs` is `null`". The shipped type is `ExpandPipelineShapeResponse(steps: Vector[...], outputs: Option[JsArray] = None)` serialized by `jsonFormat2` (PipelineShapeProtocol.scala:88, :133-134), and spray-json **omits** `Option = None` rather than writing `null` — proved in this repo by `PipelineProposalProtocolSpec.scala:122` (`json.fields.keySet should not contain "sourceId"`) and documented in eight protocol files (e.g. `ApiTokenProtocol.scala:9`, `PipelineAnalyzeProtocol.scala:182`). The protocol's own scaladoc already says `{steps, outputs?}` (l.57, l.84), which contradicts the spec delta. `PipelineShapeRoutesSpec.scala:85` asserts `resp.outputs shouldBe None` on the **deserialized case class**, so it cannot catch this — nothing tests the raw JSON. A P1.4 TS client written against the archived spec (`resp.outputs === null`) would see `undefined`.
   Fix: reword the requirement and that scenario to say the `outputs` key is OMITTED from the response today (optional/absent, `outputs?`), consistent with the protocol scaladoc. Optionally add a raw-JSON assertion in `PipelineShapeRoutesSpec` that `fields.keySet should not contain "outputs"`, mirroring `PipelineProposalProtocolSpec:122`.

### Non-blocking notes

- `schemas/pipelines/pipeline-preview-response.schema.json` types `preview` as a bare `{"type": "object"}` rather than `$ref`-ing the existing run-result shape. Accurate but weak; `check-schema-drift` is green either way.
- `POST /api/pipeline-shapes/:id/expand` has no response schema file under `schemas/` (the preview endpoint got one). Not required by the drift gate; worth a follow-up for parity given the BREAKING bare-array → `{steps, outputs}` envelope change.
