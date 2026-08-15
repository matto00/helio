# combined-proposal-apply Specification

## Purpose
Defines the combined proposal apply path that atomically creates a source (if inline), pipeline, run,
dashboard, and panels from a single request — resolving a reserved sentinel in a dashboard panel's
binding into the pipeline's newly-created output DataType id, with full rollback of the pipeline and
source if the dashboard phase fails.
## Requirements
### Requirement: Atomic combined apply
`POST /api/proposals/apply` SHALL accept a `CombinedProposal` (`{ pipeline: PipelineProposal, dashboard: DashboardProposal }`) and, composing only the existing `PipelineProposalService` and `DashboardProposalService` unchanged, atomically create the pipeline's resolved source (if inline), the pipeline, its steps, a run, the dashboard, and its panels — returning the pipeline's own apply response nested alongside the created dashboard and panels.

#### Scenario: A valid combined proposal creates everything
- **WHEN** a caller POSTs a `CombinedProposal` whose dashboard has at least one data panel bound to the reserved sentinel `"$pipelineOutput"`
- **THEN** the response is `201 Created` with the pipeline's created source (if inline)/pipeline summary/output DataType id/run result, plus the created dashboard and its panels, and the referenced panel is bound to the pipeline's real output DataType id

### Requirement: Output-ref sentinel resolves before dashboard creation
The service SHALL substitute the reserved sentinel `"$pipelineOutput"` with the real output DataType id produced by the pipeline apply, before the dashboard proposal is applied, at the one position `ProposalPanelSupport.bindingCandidate` would actually read for that panel's kind — the panel's flat `dataTypeId` if it holds the sentinel; otherwise, only when the panel's type is outside `DashboardProposalService.DataPanelKinds` (`metric`, `chart`, `table`, `collection`, `timeline`) AND the flat `dataTypeId` is absent, `config.dataTypeId` if it holds the sentinel — and SHALL leave every other panel's `dataTypeId`/`config.dataTypeId` unchanged.

#### Scenario: A mixed dashboard binds some panels to the new pipeline and others to an existing type
- **WHEN** a caller POSTs a combined proposal whose dashboard has one panel with `dataTypeId: "$pipelineOutput"` and another panel with `dataTypeId` set to a real, pre-existing pipeline-output DataType id
- **THEN** both panels are created successfully, the first bound to the newly-created output DataType and the second bound to the pre-existing one, unchanged

### Requirement: A dangling output ref creates nothing
The service SHALL reject, with a `400` naming the offending panel and creating nothing, before the pipeline proposal is ever applied, any panel where the sentinel `"$pipelineOutput"` appears anywhere in that panel's JSON representation other than the ONE position described in the "Output-ref sentinel resolves before dashboard creation" requirement above for that panel's specific kind and flat-field state — a sentinel in `config.dataTypeId` on a `DataPanelKinds` panel, or on a panel whose flat `dataTypeId` is already set to something else, is dangling exactly like a sentinel in an unrelated field such as `fieldMapping`.

#### Scenario: A sentinel in an unsupported field is rejected before any creation
- **WHEN** a caller POSTs a combined proposal whose dashboard has a panel with the sentinel `"$pipelineOutput"` set as a `fieldMapping` value rather than `dataTypeId`
- **THEN** the response is a `400 Bad Request` naming that panel, and no source, pipeline, DataType, dashboard, or panel exists that did not exist before the call

#### Scenario: A sentinel in config.dataTypeId on a data panel kind is dangling
- **WHEN** a caller POSTs a combined proposal whose dashboard has a `chart` panel with the flat `dataTypeId` absent and `config: {"dataTypeId": "$pipelineOutput"}`
- **THEN** the response is a `400 Bad Request` naming that panel, and nothing is created — `config.dataTypeId` is never a real binding position for a `chart` panel, regardless of the flat field's state

#### Scenario: A sentinel in config.dataTypeId is dangling when the flat dataTypeId is already set
- **WHEN** a caller POSTs a combined proposal whose dashboard has a non-`DataPanelKinds` panel (e.g. `text`) with a real, pre-existing `dataTypeId` already set on the flat field, and `config: {"dataTypeId": "$pipelineOutput"}`
- **THEN** the response is a `400 Bad Request` naming that panel, and nothing is created — `config.dataTypeId` is consulted only when the flat field is absent, never merely because it holds a different value

### Requirement: Dashboard-phase failure rolls back the pipeline and source
If the dashboard proposal apply fails after the pipeline proposal apply has already succeeded, the service SHALL roll back every resource the pipeline apply created — the pipeline, its output DataType, and, if it created one, the inline source and its companion DataType — before returning the dashboard phase's error, reusing `PipelineProposalService`'s own delete-composed rollback rather than re-implementing it.

#### Scenario: An invalid dashboard panel rolls back the already-created pipeline
- **WHEN** a caller POSTs a combined proposal whose pipeline is valid and creates successfully, but whose dashboard has a panel that fails `DashboardProposalService`'s own validation (e.g. an invalid `chartType`)
- **THEN** the response is an error from the dashboard phase, and counts of sources, pipelines, pipeline steps, and data types are all unchanged from before the call

### Requirement: Standalone proposal paths are unaffected
`POST /api/dashboards/apply-proposal` and `POST /api/pipelines/apply-proposal` SHALL continue to accept and return exactly the request/response shapes they did before this change.

#### Scenario: Existing dashboard and pipeline proposal flows are unchanged
- **WHEN** a caller applies a standalone `DashboardProposal` or a standalone `PipelineProposal` via their existing endpoints
- **THEN** both behave identically to before this change, including a panel whose `dataTypeId` happens to equal the string `"$pipelineOutput"` being treated as an ordinary (and, absent a real DataType with that id, rejected) binding attempt — the sentinel has no special meaning on either standalone path

### Requirement: Non-mutating validation of a CombinedProposal
`CombinedProposalService` SHALL expose `validate(combined, user): Future[Either[ServiceError,
Unit]]`, delegating the pipeline portion to `PipelineProposalService.validate`, checking the
dashboard portion's sentinel-position structure, checking the dashboard's own name is non-blank, and
checking every dashboard panel's pure structural validity (type validity, non-blank title,
chart/divider/timeline field validity, aggregation conflicts) — deferring only the DB-backed
DataType-binding resolution against the dashboard panels, since they reference the reserved
`"$pipelineOutput"` sentinel rather than a real id until the pipeline is actually applied. No side
effects and nothing created, regardless of the result.

#### Scenario: A structurally valid combined proposal passes without creating anything
- **WHEN** `validate` is called with a `CombinedProposal` whose pipeline portion is valid and whose
  dashboard panels correctly reference the `"$pipelineOutput"` sentinel with no structural defects
- **THEN** the result is `Right(())`, and no source, pipeline, run, dashboard, or panel is created

#### Scenario: An invalid pipeline portion fails validation without creating anything
- **WHEN** `validate` is called with a `CombinedProposal` whose pipeline portion is structurally
  invalid
- **THEN** the result is `Left(_)`, and no source, pipeline, run, dashboard, or panel is created

#### Scenario: A structurally invalid dashboard panel fails validation without creating anything
- **WHEN** `validate` is called with a `CombinedProposal` whose pipeline portion is valid but whose
  dashboard portion has a structurally invalid panel (e.g. a blank title, or a chart/aggregation
  conflict)
- **THEN** the result is `Left(_)`, and no source, pipeline, run, dashboard, or panel is created

#### Scenario: A blank dashboard name fails validation without creating anything
- **WHEN** `validate` is called with a `CombinedProposal` whose pipeline portion is valid but whose
  dashboard portion has a blank `dashboardName`
- **THEN** the result is `Left(_)`, and no source, pipeline, run, dashboard, or panel is created

