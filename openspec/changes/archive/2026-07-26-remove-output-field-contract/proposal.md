## Why

`OutputFieldContract` and `OutputContract.fields` (HEL-391) have zero producers and zero consumers across
the completed HEL-337 epic — every shape declares `fields = Vector.empty` and nothing reads it. It also
cannot be populated as designed: `outputContract` is a static `val` with no access to `params`. The user
decided against making it param-aware (HEL-399 binds panels via the runtime DataType schema post-run, not
static field contracts) and confirmed deletion. This mirrors HEL-391's own design-gate call to drop the
speculative `role` field for the same reason.

## What Changes

- Remove `OutputFieldContract` from `backend/src/main/scala/com/helio/domain/shapes/OutputContract.scala`;
  `OutputContract` becomes `rowCount` + `description` only. `rowCount` (consumed by HEL-399 panel-kind
  matching) and `description` are untouched. **BREAKING** (wire format): the `outputContract.fields` array
  is removed from the `GET /api/pipeline-shapes` catalog response.
- Update all five registered shapes (`passthrough`, `single-row`, `top-n`, `time-series`, `pivot-matrix`)
  to drop the now-removed constructor argument.
- Update catalog JSON serialization (spray-json protocol) to stop emitting `fields`.
- Update `schemas/pipeline-shape-catalog.schema.json` to drop the `fields` property from `outputContract`.
- Update `openspec/specs/pipeline-shape-registry/spec.md` capability spec to match.
- Sweep `helio-mcp/` (HEL-400's workspace-context catalog snapshot) and `frontend/` (HEL-402 shape-picker,
  HEL-399 instantiate flow) for any TypeScript type or code referencing `fields` on a catalog/output-contract
  shape, even if currently unused/dead.
- No behavior change: no shape's `expand`, validation, or output rows change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-shape-registry`: the shape catalog's `outputContract` no longer includes a `fields` array —
  the contract is `rowCount` + `description` only.
- `mcp-pipeline-shape-tools`: the `list_pipeline_shapes` tool description no longer notes that
  `outputContract.fields` is always empty, since the `fields` member no longer exists on the wire.

## Non-goals

- Making `outputContract` param-aware (explicitly rejected by the user; a future ticket if a real need
  emerges).
- Any change to shape expansion logic, row counts, or panel-binding behavior (HEL-399's runtime
  DataType-schema binding is unaffected).

## Impact

- Backend: `OutputContract.scala`, the five shape implementations (`PipelineShape.scala` /
  `shapes/*.scala`), catalog JSON protocol, existing shape unit tests (drop the argument, no other edits).
- Contracts: `schemas/pipeline-shape-catalog.schema.json`, `openspec/specs/pipeline-shape-registry/spec.md`.
- MCP: `helio-mcp/` catalog snapshot types, if any reference `fields`.
- Frontend: shape-picker / instantiate-flow TypeScript types, if any reference `fields`.
