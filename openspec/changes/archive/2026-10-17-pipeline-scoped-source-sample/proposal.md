## Why

HEL-1628's `GET /api/data-sources/:id/sample` is owner-only, and the client hook only samples sources the caller owns.
An editor grantee on a shared pipeline (who can run it, HEL-1492) sees "Sample unavailable" on every source card, so
once HEL-1631 wires the live draft preview, collaborators get no preview at all. `data_sources` is owner-only RLS, so
there is no way for a grantee to read the rows today except by running the pipeline.

## What Changes

- The existing sample route gains an optional `pipelineId` query parameter. When the caller does not own the source,
  the sample is served only if the caller holds a qualifying grant on that pipeline (grant level per owner ruling,
  see design D1) AND the pipeline currently uses the source as a root or as a join/union/lookup secondary input.
  Every failed check answers the same `404` body as an unknown id.
- The source is read on the privileged path only after that check, with `ConnectorResolveContext.Internal`, exactly
  as a grantee's run reads it. Same HEL-505 source-fetch bucket, keyed to the caller; never the pipeline-run guard.
- Sample response schema unchanged. The full analyze response gains a required, permission-only `callerRole`
  (`owner|editor|viewer`) as the client's signal; the analyze schema is extended in this change.
- Client: the sample hook, store thunk and refresh pass the pipeline scope for sources the caller does not own when
  the caller may sample them; viewers who may not sample see no sample label instead of "Sample unavailable".

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `source-sample-api`: access widens from owner-only to owner or a qualifying pipeline grantee whose pipeline uses
  the source; the limiter requirement names the caller's bucket.
- `pipeline-analyze-api`: analyze names the caller's access role (`callerRole`).
- `pipeline-source-sample-store`: the page captures granted sources' samples through the pipeline scope.

## Impact

Backend: `SourceSampleService`, `DataSourcePreviewRoutes`, `ApiRoutes` wiring, new RLS specs on
`TwoUserRlsApiFixture`; analyze protocol/service (`PipelineAnalyzeReads`) and
`schemas/pipelines/pipeline-analyze-response.schema.json` (+ helio-mcp's mirrored type). Frontend: analyze type, `useSourceSamples`, `sourceSamplesSlice`, `dataSourceService`, `SourceSampleLabel`,
`usePipelineDetailPage`. No migration expected.

## Non-goals

- Sampling a source a draft references but the saved pipeline does not (HEL-1631 territory).
- Editor root add/remove RLS defects (HEL-1652).
- Upsert write targets (not a read input) and form-panel bindings.
