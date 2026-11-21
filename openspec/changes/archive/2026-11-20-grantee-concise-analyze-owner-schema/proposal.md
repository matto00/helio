## Why

HEL-1661 made `GET /api/pipelines/:id/analyze` judge a grantee's step validity against the pipeline owner's root
schemas. The concise mode of the same route (`?concise=true`, `PipelineAnalyzeReads.analyzeConcise`), which the
helio-mcp `analyze_pipeline` tool calls, still validates against the caller's own view. A grantee does not own the root,
so its schema is empty and a valid compute step reports a false `validationError`.

## What Changes

- `analyzeConcise` reuses the owner-view validity pass the full analyze route uses: one shared helper in
  `PipelineAnalyzeReads` reads the owner's root schemas (`findByIdOwnedByInternal`) for a non-owner and maps each
  step's error through the existing `nonOwnerValidationError` (schema-independent config problem, an error identical
  to the caller-view one, or the neutral sentence). Both modes call that helper.
- `warnings`, paths and op kinds stay caller-view, exactly as the full route keeps its `warnings`.
- No wire-shape change. The concise response has no cost verdict and no row count, so there is no row count to remove.
- No helio-mcp change: the tool already calls the REST route. The fix reaches MCP users once the backend deploys; no MCP
  redeploy is required.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-analyze-api`: concise mode judges a non-owner's step validity by the owner's schema, with no new source
  detail.

## Non-goals

- Changing `warnings` for grantees (caller-view in both modes, per HEL-1661's ruling).
- Any helio-mcp source change or MCP deploy.
- `analyze-proposal` (no pipeline id, no grantee).

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/PipelineAnalyzeReads.scala`
- New spec `backend/src/test/scala/com/helio/services/pipelines/Hel1799GranteeConciseAnalyzeSpec.scala`
- No migration, no schema file, no frontend change.
