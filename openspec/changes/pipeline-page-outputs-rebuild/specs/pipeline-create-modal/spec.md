## REMOVED Requirements

### Requirement: CreatePipelineModal renders three required fields
**Reason**: The "Output type name" field is DataType-bound; HEL-903 dropped DataType-per-pipeline
as the panel-binding concept (pipelines produce Outputs now, not a bound DataType), and the
shipped `CreatePipelineRequest` (`PipelineProtocol.scala`) has no `outputDataTypeName` field at
all — sending one was already a no-op against the real backend.
**Migration**: See the new `pipeline-new-flow` capability (this same change) — `CreatePipelineModal`
now offers a pipeline-name field, a "pick an existing source" select, and a "Create a new source"
action (nesting the existing `AddSourceModal`, covering paste-table/CSV/URL/REST/text-markdown).
No output-type field exists any more.

### Requirement: Successful submission creates the pipeline and navigates
**Reason**: The wire contract this requirement describes (`POST /api/pipelines` with
`{ name, sourceDataSourceId, outputDataTypeName }`, followed by a `fetchPipelines` refresh) is
superseded on two counts: `outputDataTypeName` no longer exists on the request, and the
refresh-via-refetch approach was already replaced (F-104, pre-dating this change) by
`createPipeline.fulfilled` pushing the created pipeline directly into `state.items`.
**Migration**: See `pipeline-new-flow`'s "Pipeline-plus-steps-plus-outputs creation is a single
call" requirement (this same change) for the current request shape and navigation behavior.
