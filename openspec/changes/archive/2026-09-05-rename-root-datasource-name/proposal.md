## Why

HEL-913 replaced the pipeline's singular source scalar with a `roots[]` array and produced two per-root
response shapes that name the same concept differently: `PipelineRootSummaryResponse` calls it
`dataSourceName`, while `RootSourceSchemaResponse` kept the inherited `source`-prefixed
`sourceDataSourceName`. HEL-969 hit this directly — its AC barred the identifier from `frontend/src`
while the analyze API still sent a field by exactly that name, so the frontend could satisfy the AC or
name the wire field truthfully, but not both. It chose to drop the field. Aligning the wire name now
unblocks any future consumer from modelling it truthfully.

## What Changes

- **BREAKING (wire).** Rename `RootSourceSchemaResponse.sourceDataSourceName` to `dataSourceName`. This
  changes the JSON emitted by `GET /api/pipelines/:id/analyze` and the analyze-proposal response. There
  is no dual-read/alias period — the old key is removed outright, matching the precedent HEL-913 set for
  the scalar it replaced.
- Update the spray-json formatter, the backend route specs, and the four `PipelineAnalyzeProposalRoutesSpec`
  assertions that read the field.
- Update both `schemas/pipelines/` JSON Schemas (`pipeline-analyze-response`, `pipeline-analyze-proposal-response`)
  in their `properties` and `required` arrays, keeping the `npm run check:schemas` drift gate green.
- Update `helio-mcp/src/types.ts`'s `RootSourceSchema` and its test consumers. helio-mcp is an
  external/agent-facing client, which is what makes this a breaking wire change rather than an internal rename.
- Add a serialized-JSON assertion so the renamed field is proven present with a real value on the wire,
  not merely on a decoded case class.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-analyze-api`: the per-root source-schema requirement changes the wire name of the entry's
  data-source-name field from `sourceDataSourceName` to `dataSourceName`.

## Impact

- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala`
- `schemas/pipelines/pipeline-analyze-response.schema.json`, `schemas/pipelines/pipeline-analyze-proposal-response.schema.json`
- `helio-mcp/src/types.ts`, `helio-mcp/src/context.test.ts`, `helio-mcp/src/tools/pipelineProposalHandlers.test.ts`
- `openspec/specs/pipeline-analyze-api/spec.md`
- API consumers of `GET /api/pipelines/:id/analyze` reading `sourceSchemas[].sourceDataSourceName`.

## Non-goals

- No frontend change. `frontend/src` has zero references to the identifier; re-adding the field to
  `RootSourceSchema` under the corrected name is a separate follow-up.
- No rename of `PipelineRepository.PipelineSummary.sourceDataSourceName` or the pipeline-list/edit-flow
  specs — those name the unrelated list-summary scalar, not a per-root shape.
- No database migration, and no deprecation/alias window for the old key.
