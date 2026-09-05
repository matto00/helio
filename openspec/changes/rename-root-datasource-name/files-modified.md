# Files modified — HEL-975

**This is a breaking wire change** for any consumer of `GET /api/pipelines/:id/analyze` /
the analyze-proposal response reading `sourceSchemas[].sourceDataSourceName` — the field is
renamed to `dataSourceName` outright, with no dual-read/alias period (design D1). `helio-mcp` is
an in-repo external/agent-facing client and is updated atomically in this change (design D2); an
out-of-repo MCP client built from an older `types.ts` will read `undefined` for this field until
rebuilt.

- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` — renamed `RootSourceSchemaResponse.sourceDataSourceName` field to `dataSourceName` (jsonFormat3 picks up the new spray-json key automatically); preserved the nearby comment narrating the retired singular scalar (design D5).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala` — updated the four `resp.sourceSchemas.head.sourceDataSourceName` assertions to `dataSourceName`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` — added an AC7 wire-level assertion parsing the serialized JSON response body and asserting on the `sourceSchemas` entry's field-key set (contains `dataSourceName`, does not contain `sourceDataSourceName`, value is a non-empty `JsString`). Demonstrated red first by temporarily reverting the field name: observed failure `TreeSet("rootId", "sourceDataSourceName", "sourceSchema") did not contain element "dataSourceName"`, then restored the rename.
- `schemas/pipelines/pipeline-analyze-response.schema.json` — renamed the `RootSourceSchema` `$def`'s `dataSourceName` property and its `required` array entry (`check:schemas` does not cover this nested `$def`/`required` array per design's documented gate gap; verified manually by printing the `$def` block).
- `schemas/pipelines/pipeline-analyze-proposal-response.schema.json` — same rename, manually verified.
- `helio-mcp/src/types.ts` — renamed `RootSourceSchemaResponse.sourceDataSourceName` to `dataSourceName`; left the retired-scalar-narrating comments at `:277`/`:503` untouched (AC8 permitted residue).
- `helio-mcp/src/context.test.ts` — updated the two `sourceDataSourceName` literals (fixture + assertion) to `dataSourceName`.
- `helio-mcp/src/tools/pipelineProposalHandlers.test.ts` — updated the `sourceDataSourceName` literal to `dataSourceName`.
- `openspec/specs/pipeline-analyze-api/spec.md` — updated the per-root source-schema requirement (`:116`) to name the response's `dataSourceName` field explicitly; left the stale singular-scalar mention at `:50` untouched per AC3's scope clarification.
- `frontend/src/features/pipelines/types/pipelineStep.ts` — (cycle 2, skeptic-final-1 CR1) corrected the `HEL-969:` comment above `RootSourceSchema`, which had gone factually stale as of this ticket's own rename: it claimed the wire still sent a `source`-prefixed field and that a truthful, AC3-compliant name was unavailable. It now states the wire sends `dataSourceName` (HEL-975) and that the field stays omitted only because nothing reads it (grep-confirmed zero consumers), not because no honest name exists. Comment-only; the field itself was NOT added to `RootSourceSchema` (no consumer — that would be scope drift). Kept the description generic (`a source-prefix`, not the literal identifier) so this edit does not reintroduce `sourceDataSourceName` into `frontend/src` and disturb AC8.

## Out of scope, deliberately untouched (per ticket/design)

- `PipelineRepository.PipelineSummary.sourceDataSourceName` and its consumers (`PipelineRepository.scala`, `WorkspaceSearchServiceSpec.scala`, `PatchSetPreviewProjection.scala`, `WorkspaceSearchService.scala`) — unrelated list-summary scalar, not a per-root shape.
- `frontend/src` — zero pre-existing references; no frontend change made.
- No database migration — the field is derived at analyze time, never persisted under this name; the shared dev Postgres (concurrent HEL-981/HEL-980 runs) is untouched.

## Verification evidence

- `cd backend && sbt test` — 3838 tests, 0 failures (`254 suites completed, 0 aborted`).
- `npx jest helio-mcp` (from repo root, via root `jest.config.cjs`) — 24 suites / 238 tests passed.
- `helio-mcp && npx tsc --noEmit` — clean, no output.
- `npm run check:schemas` — passes (does NOT cover this field per design's documented gate gap; not relied upon as proof).
- AC8 classified grep (`grep -rn "sourceDataSourceName" backend/src/main/scala/com/helio/api/protocols schemas/pipelines helio-mcp/src frontend/src`) — 8 hits, all classified as comment/description narration of the retired singular scalar, matching the ticket's enumerated permitted list exactly.
