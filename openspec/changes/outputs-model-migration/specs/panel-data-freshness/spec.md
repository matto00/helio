## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: PipelineRepository exposes last successful run timestamp lookup by output DataType
`PipelineRepository` SHALL provide `findLastRunAtByOutputOutput/nodeId(id: Output/nodeId): Future[Option[Instant]]`
that returns the most recent `last_run_at` across all pipelines whose `output_data_type_id` matches the
given Output/node id AND whose `last_run_status = 'succeeded'`. Only successful runs indicate actual data
freshness; failed runs SHALL be excluded. The query runs in system context (ACL-bypassing) because the
caller (panel response assembly) does not carry a pipeline owner identity. When no matching pipeline exists,
all matching pipelines have `last_run_at = null`, or all runs have failed, the method SHALL return `None`.

#### Scenario: Returns latest successful last_run_at when pipeline has run successfully
- **WHEN** `findLastRunAtByOutputOutput/nodeId(dtId)` is called for an Output/nodeId that has one or more pipelines with `last_run_status = 'succeeded'` and non-null `last_run_at`
- **THEN** the method returns `Some(maxLastRunAt)` — the most recent `last_run_at` among successful runs

#### Scenario: Returns None when no pipeline matches
- **WHEN** `findLastRunAtByOutputOutput/nodeId(dtId)` is called for an Output/nodeId with no associated pipelines
- **THEN** the method returns `None`

#### Scenario: Returns None when pipeline has never run
- **WHEN** `findLastRunAtByOutputOutput/nodeId(dtId)` is called for an Output/nodeId whose associated pipeline has `last_run_at = null`
- **THEN** the method returns `None`

#### Scenario: Returns None when pipeline has only failed runs
- **WHEN** `findLastRunAtByOutputOutput/nodeId(dtId)` is called for an Output/nodeId whose pipeline's most recent run has `last_run_status = 'failed'/'succeeded' (any non-'succeeded' terminal status)`
- **THEN** the method returns `None` (failed runs do not indicate data freshness)

#### Scenario: Returns most recent successful run when multiple pipelines share the same output DataType
- **WHEN** two pipelines write to the same Output/node and have different `last_run_at` values with `last_run_status = 'succeeded'`
- **THEN** the method returns `Some(laterSuccessfulTimestamp)`

### Requirement: Panel API response includes dataAsOf field
`GET /api/dashboards/:id/panels` SHALL include a top-level `dataAsOf: string | null` field on
every `PanelResponse`. (No `GET /api/panels/:id` route exists in the codebase; AC #2 is satisfied
by the dashboard panels list endpoint alone.) The value SHALL be an ISO-8601 timestamp string when
the panel is bound to an Output/node and that Output/node's associated pipeline has a non-null
`last_run_at`; otherwise it SHALL be `null`.

#### Scenario: Bound panel with pipeline run returns ISO timestamp
- **WHEN** `GET /api/dashboards/:id/panels` is called and a panel has a bound Output/node whose associated pipeline has run
- **THEN** the response panel object includes `"dataAsOf": "<ISO-8601 string>"`

#### Scenario: Bound panel with never-run pipeline returns null
- **WHEN** `GET /api/dashboards/:id/panels` is called and a panel has a bound Output/node whose associated pipeline has never run
- **THEN** the response panel object includes `"dataAsOf": null`

#### Scenario: Unbound panel returns null
- **WHEN** `GET /api/dashboards/:id/panels` is called and a panel has no bound Output/node (typeId is absent or empty)
- **THEN** the response panel object includes `"dataAsOf": null`
