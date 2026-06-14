## ADDED Requirements

### Requirement: PipelineRepository exposes last successful run timestamp lookup by output DataType
`PipelineRepository` SHALL provide `findLastRunAtByOutputDataTypeId(id: DataTypeId): Future[Option[Instant]]`
that returns the most recent `last_run_at` across all pipelines whose `output_data_type_id` matches the
given DataType id AND whose `last_run_status = 'succeeded'`. Only successful runs indicate actual data
freshness; failed runs SHALL be excluded. The query runs in system context (ACL-bypassing) because the
caller (panel response assembly) does not carry a pipeline owner identity. When no matching pipeline exists,
all matching pipelines have `last_run_at = null`, or all runs have failed, the method SHALL return `None`.

#### Scenario: Returns latest successful last_run_at when pipeline has run successfully
- **WHEN** `findLastRunAtByOutputDataTypeId(dtId)` is called for a DataTypeId that has one or more pipelines with `last_run_status = 'succeeded'` and non-null `last_run_at`
- **THEN** the method returns `Some(maxLastRunAt)` — the most recent `last_run_at` among successful runs

#### Scenario: Returns None when no pipeline matches
- **WHEN** `findLastRunAtByOutputDataTypeId(dtId)` is called for a DataTypeId with no associated pipelines
- **THEN** the method returns `None`

#### Scenario: Returns None when pipeline has never run
- **WHEN** `findLastRunAtByOutputDataTypeId(dtId)` is called for a DataTypeId whose associated pipeline has `last_run_at = null`
- **THEN** the method returns `None`

#### Scenario: Returns None when pipeline has only failed runs
- **WHEN** `findLastRunAtByOutputDataTypeId(dtId)` is called for a DataTypeId whose pipeline's most recent run has `last_run_status = 'failed'/'succeeded' (any non-'succeeded' terminal status)`
- **THEN** the method returns `None` (failed runs do not indicate data freshness)

#### Scenario: Returns most recent successful run when multiple pipelines share the same output DataType
- **WHEN** two pipelines write to the same DataType and have different `last_run_at` values with `last_run_status = 'succeeded'`
- **THEN** the method returns `Some(laterSuccessfulTimestamp)`

### Requirement: Panel API response includes dataAsOf field
`GET /api/dashboards/:id/panels` SHALL include a top-level `dataAsOf: string | null` field on
every `PanelResponse`. (No `GET /api/panels/:id` route exists in the codebase; AC #2 is satisfied
by the dashboard panels list endpoint alone.) The value SHALL be an ISO-8601 timestamp string when
the panel is bound to a DataType and that DataType's associated pipeline has a non-null
`last_run_at`; otherwise it SHALL be `null`.

#### Scenario: Bound panel with pipeline run returns ISO timestamp
- **WHEN** `GET /api/dashboards/:id/panels` is called and a panel has a bound DataType whose associated pipeline has run
- **THEN** the response panel object includes `"dataAsOf": "<ISO-8601 string>"`

#### Scenario: Bound panel with never-run pipeline returns null
- **WHEN** `GET /api/dashboards/:id/panels` is called and a panel has a bound DataType whose associated pipeline has never run
- **THEN** the response panel object includes `"dataAsOf": null`

#### Scenario: Unbound panel returns null
- **WHEN** `GET /api/dashboards/:id/panels` is called and a panel has no bound DataType (typeId is absent or empty)
- **THEN** the response panel object includes `"dataAsOf": null`

### Requirement: Frontend panel displays freshness indicator when dataAsOf is non-null
The panel card (in the dashboard grid) SHALL render a "Data as of [relative time]" indicator
below the panel title when `panel.dataAsOf` is a non-null, non-empty string. The relative time
SHALL be computed using the existing `formatRelativeTime` utility. The indicator SHALL be hidden
(not rendered) when `panel.dataAsOf` is `null` or `undefined`.

#### Scenario: Bound panel with run shows freshness indicator
- **WHEN** a panel with `dataAsOf` set to a valid ISO timestamp is rendered in the panel grid
- **THEN** a "Data as of [relative time]" label is visible below the panel title (e.g. "Data as of 2 hours ago")

#### Scenario: Unbound panel hides freshness indicator
- **WHEN** a panel with `dataAsOf: null` is rendered in the panel grid
- **THEN** no "Data as of" label is rendered

#### Scenario: Panel with never-run pipeline hides freshness indicator
- **WHEN** a panel with `dataAsOf: null` (pipeline has never run) is rendered in the panel grid
- **THEN** no "Data as of" label is rendered

### Requirement: PanelBase TypeScript interface includes dataAsOf
The `PanelBase` interface in `panel.ts` SHALL include `dataAsOf?: string | null` as an optional
field. All panel discriminated union members inherit this field via `PanelBase`. Existing fixtures
and test factories that do not set `dataAsOf` remain valid (the field is optional).

#### Scenario: Panel hydrated from API carries dataAsOf
- **WHEN** the Redux store normalizes an API panel response that includes `"dataAsOf": "2026-05-11T10:00:00Z"`
- **THEN** `panel.dataAsOf` equals `"2026-05-11T10:00:00Z"` in the Redux state

#### Scenario: Panel hydrated without dataAsOf defaults to undefined/null
- **WHEN** the Redux store normalizes an API panel response where `dataAsOf` is `null`
- **THEN** `panel.dataAsOf` is `null` in the Redux state
