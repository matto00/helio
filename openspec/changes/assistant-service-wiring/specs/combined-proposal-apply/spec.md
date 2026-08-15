## ADDED Requirements

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
