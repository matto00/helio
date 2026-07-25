## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket + planning artifacts read**: `ticket.md`, `proposal.md`, `design.md`,
  `specs/mcp-pipeline-shape-tools/spec.md`, `tasks.md` — internally consistent; no `TODO`/`TBD`/
  placeholder language found in any of them.

- **Backend endpoint claims (design's "no new backend endpoint")**:
  - `backend/src/main/scala/com/helio/api/routes/PipelineShapeRoutes.scala` — confirmed
    `pathPrefix("pipeline-shapes")` with `GET` (catalog) and `POST :id/expand`, constructed with
    `AuthenticatedUser` — genuinely authenticated.
  - `backend/src/main/scala/com/helio/api/ApiRoutes.scala:275` — confirmed
    `new PipelineShapeRoutes(pipelineShapeService, authenticatedUser).routes` is wired into the
    live authenticated route tree (not dead code).
  - `backend/src/main/scala/com/helio/services/PipelineShapeService.scala` — `expand` maps unknown
    id → `ServiceError.NotFound`, params failure → `ServiceError.UnprocessableEntity`, exactly as
    design/ticket claim.
  - `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala:64` — confirmed
    `UnprocessableEntity` → HTTP 422, and (separately) `NotFound` → HTTP 404 — the design's claimed
    status-code mapping is real, not asserted from memory.
  - `openspec/specs/pipeline-shape-registry/spec.md:606,613` — independently confirms the same
    404/422 contract for the `expand` endpoint (HEL-402 spec, already on `main`).
  - Conclusion: "no new backend endpoint" is **correct** — the endpoint genuinely exists,
    is authenticated, and behaves as claimed. Nothing in the ticket's scope requires a capability
    this endpoint doesn't already provide.

- **Shape registry claims**: `backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala`
  — `Registry` = exactly `passthrough`/`single-row`/`top-n`/`time-series`/`pivot-matrix`, matching
  the ticket brief and design/spec verbatim. Spot-checked `TopNShape.scala` — `paramsSchema`
  (`measure`/`direction`/`n`/`ties`) and `expand` producing `sort` then `limit`
  (`SortStep.Kind`/`LimitStep.Kind`) matches the spec's `top-n` scenario exactly
  (`sort` then `limit`).

- **Wire-shape claims** (`PipelineShapeProtocol.scala`): `ShapeParamDescriptor` has exactly 5
  fields (`name`/`label`/`dataType`/`required`/`description`, `jsonFormat5`) matching
  `tasks.md` 1.1's planned `ShapeParamDescriptorResponse`. `RowCountContract` is a closed 3-case
  union (`ExactlyOne`/`AtMostParam(paramName)`/`Unbounded`) matching design Decision 5's
  three-string flattening plan (`"exactly-one"`/`"at-most-param:<paramName>"`/`"unbounded"`).
  `OutputContract.fields` is genuinely populated as `Vector.empty` in every shape file I checked
  (grep across `TopNShape`/`SingleRowShape`/`TimeSeriesShape`/`PivotMatrixShape`/
  `PassthroughShape` — none set `fields` to anything but the empty default), confirming the
  brief's "always empty" claim and justifying design's decision to drop it from the workspace
  projection.

- **MCP-side claims**:
  - `helio-mcp/src/tools/write.ts` / `read.ts` / `proposal.ts` — `guarded()`/`HelioApiError`
    pattern is real and identical across all three files (not paraphrased). `create_pipeline` /
    `add_pipeline_step` / `run_pipeline` are indeed three separate tools with the "build, then
    run" split the design cites for Decision 3. `list_connectors` (read.ts:159) is a genuine
    existing catalog-read tool the design's Decision 1 / proposal cite as the mirrored pattern
    for `list_pipeline_shapes` — confirmed structurally identical (thin pass-through, `guarded`).
  - `helio-mcp/src/helioApi.ts` — `getPipeline` really does compose `{...summary, steps}` via
    `Promise.all` (lines 211-218), confirmed as the `PipelineWithSteps` pattern design's Planner
    Notes says `create_pipeline_from_shape`'s return will mirror.
  - `helio-mcp/src/httpClient.ts` — `describeError` (lines 159-171) extracts the backend's
    `{"message": ...}` body and `dispatch` throws `HelioApiError` for any non-2xx — confirmed the
    verbatim-message propagation path design/spec rely on for the 404/422 scenarios.
  - `helio-mcp/src/context.ts` — `buildWorkspaceContext`'s `Promise.all` currently fans out
    exactly 4 calls (`listDataSources`/`listDataTypes`/`listDashboards`/`listPipelines`) before
    the separate per-pipeline `analyze` fan-out — confirms design's "existing four" and the
    "4 + N(pipelines)" budget it says stays same-shape with a 5th flat call added.
  - `helio-mcp/src/tools/proposal.ts` — `propose_dashboard` is genuinely a no-writes assembler:
    it only calls `api.listDataTypes()` (read) and returns `{proposal, warnings, applyReady}`
    with zero write calls anywhere in the tool body. This substantiates Decision 4's claim that
    threading a write (shape instantiation) into it would break a real, currently-enforced
    "assemble then review" contract — not an invented excuse.
  - `helio-mcp/scripts/verify.ts` — genuinely spawns a real `StdioClientTransport` + MCP SDK
    `Client` against the built `dist/index.js`, calls real tools over the protocol, and requires
    `HELIO_API_BASE_URL`/`HELIO_PAT` env vars — a real end-to-end harness, not a stub, matching
    what tasks.md 5.2/5.3 assume it is.
  - `helio-mcp/src/types.ts` — existing `*Response` interfaces (e.g. `ConnectorMetadataResponse`)
    follow the exact naming/shape convention the design's planned
    `PipelineShapeCatalogEntryResponse` etc. would extend.

### Judgment on the five review questions

1. **"No new backend endpoint" correctness** — Correct, verified against the live route tree,
   not just design-doc assertion.
2. **Validate-before-write ordering** — Sound and matches real backend behavior: `expand` is
   `Future.successful` over a pure computation (`PipelineShapeService.scala:50-56`), no
   persistence occurs on failure, so calling `expand` before `createPipeline` genuinely avoids
   ever creating an orphan pipeline for a bad shape id / bad params.
3. **Decision 4 (leave `propose_dashboard` unchanged)** — Defensible, not a cop-out. The ticket
   says "if propose_dashboard can reference shapes, thread that through" — conditional language.
   `propose_dashboard`'s real, code-verified contract is no-writes; instantiating a shape is a
   write with its own 422 failure surface. Threading a write into a documented no-writes tool
   would be the actual design smell. The alternative sequential flow (`create_pipeline_from_shape`
   → `run_pipeline` → `propose_dashboard`) is coherent and mirrors the existing hand-assembled
   flow's shape.
4. **`pipelineShapes` in `buildWorkspaceContext`** — Justified, not scope creep: explicitly
   posed as a "design question to settle deliberately" in the orchestrator brief (#2), tied to a
   recorded lesson (helio-news) in the user's own project memory, and the cost claim (one flat
   call, not per-pipeline) is accurate against the current 4-call `Promise.all`.
5. **AC ↔ tasks.md gap check** — All 5 ACs trace to at least one task: discovery+instantiation →
   tasks 3.1/3.2; tool descriptions → 3.2; single-source-of-truth reuse → verified structurally
   (MCP composes `expand`+`createPipeline`+`addPipelineStep`, no reimplemented logic); tests →
   5.1 (build)/5.2/5.3 (verify harness); backward compatibility → inherent to the additive-only
   task list (no existing tool's `inputSchema` or return shape is touched). No new backend
   endpoint means "backend test for the instantiation endpoint if one is added" is correctly
   inapplicable and tasks.md correctly omits it.

No placeholders, no internal contradictions between proposal/design/tasks, no ambiguity a
competent implementer would misread, and the one piece of scope the ticket left conditional
(`propose_dashboard` threading) is resolved with a specific, code-grounded rationale rather than
punted.

### Verdict: CONFIRM

### Non-blocking notes

- `httpClient.ts`'s `describeError` prefixes the backend message with `"<status> <statusText>: "`
  (e.g. `"422 Unprocessable Entity: top-n shape: missing required field 'n'..."`) rather than
  returning the backend message byte-for-byte alone. The spec's "verbatim" language is still
  accurate in substance (the exact backend text is present, unmodified), but the executor should
  not assert an *exact string equality* test against the bare backend message — it should assert
  substring/contains, or the verify-harness check may be written too strictly and flake.
- Tasks.md doesn't have an explicit line item for "confirm existing tool schemas/behavior are
  byte-for-byte unchanged" (AC5, backward compatibility) — this is implicitly satisfied by the
  additive-only nature of the planned diff, but the executor/evaluator should still diff
  `read.ts`/`write.ts`/`context.ts` against `main` at implementation time to confirm no existing
  `inputSchema` or tool description was inadvertently touched beyond `get_workspace_context`'s
  description (task 4.3, which is an intentional, additive text update).
