## MODIFIED Requirements

### Requirement: WorkspaceContextService's existing behavior is unaffected
`find`/`get_resource` SHALL compose over the same resource surface `WorkspaceContextService`
already assembles for `get_workspace_context`, now sourced from pipelines' Outputs and sources'
`inferredSchema` instead of DataTypes/Metrics; pre-existing dashboard/pipeline/source search
behavior SHALL otherwise remain unchanged.

#### Scenario: Metrics are no longer a searchable kind; the `dataType` kind is retained as a transitional label now carrying Outputs
- **WHEN** `find` is called after the outputs-model migration
- **THEN** its result kinds no longer include `metric` (Metrics were deleted outright); the
  `dataType` result kind is RETAINED as a transitional wire label — its results are now sourced
  from `OutputRepository` rather than the deleted `DataTypeRepository`. Renaming this wire value
  is deferred to whichever P1.4-adjacent ticket rewires the 30+ frontend/MCP consumers of
  `dataType`-kind search results (see design.md's wire-naming exemption list); it is not part of
  this migration's scope

#### Scenario: Dashboard/pipeline/source search is unaffected
- **WHEN** `find` searches for a dashboard, pipeline, or source name
- **THEN** results are unchanged from before this migration

#### Scenario: WorkspaceContextService's existing test suite is unaffected
- **WHEN** the existing `WorkspaceContextServiceSpec` suite (and its sibling specs) is run after
  this change
- **THEN** every existing test passes unmodified (rewritten to source pipelines'/sources'
  Output/inferredSchema data instead of DataTypes/Metrics, but asserting equivalent behavior)
