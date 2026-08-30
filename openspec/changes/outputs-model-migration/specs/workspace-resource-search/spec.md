## MODIFIED Requirements

### Requirement: WorkspaceContextService's existing behavior is unaffected
`find`/`get_resource` SHALL compose over the same resource surface `WorkspaceContextService`
already assembles for `get_workspace_context`, now sourced from pipelines' Outputs and sources'
`inferredSchema` instead of DataTypes/Metrics; pre-existing dashboard/pipeline/source search
behavior SHALL otherwise remain unchanged.

#### Scenario: DataTypes and Metrics are no longer a searchable kind
- **WHEN** `find` is called after the outputs-model migration
- **THEN** its result kinds no longer include `dataType` or `metric`; Outputs are reachable via
  their owning pipeline until a dedicated Output search kind lands (P1.3/P1.4)

#### Scenario: Dashboard/pipeline/source search is unaffected
- **WHEN** `find` searches for a dashboard, pipeline, or source name
- **THEN** results are unchanged from before this migration

#### Scenario: WorkspaceContextService's existing test suite is unaffected
- **WHEN** the existing `WorkspaceContextServiceSpec` suite (and its sibling specs) is run after
  this change
- **THEN** every existing test passes unmodified (rewritten to source pipelines'/sources'
  Output/inferredSchema data instead of DataTypes/Metrics, but asserting equivalent behavior)
