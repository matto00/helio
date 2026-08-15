## ADDED Requirements

### Requirement: Non-mutating validation of a PipelineProposal
`PipelineProposalService` SHALL expose `validate(proposal, user): Future[Either[ServiceError,
Unit]]`, performing structural validation (mirroring the checks `apply` already runs before
resolving or creating anything) plus, for a source reference to an existing `sourceId`, a read-only
ownership/existence check — with no side effects and nothing created, regardless of whether the
result is `Left` or `Right`.

#### Scenario: A structurally valid proposal referencing an existing, owned source passes
- **WHEN** `validate` is called with a `PipelineProposal` whose source references an existing data
  source owned by the caller, and whose steps are structurally well-formed
- **THEN** the result is `Right(())`, and no pipeline, source, or run is created

#### Scenario: A structurally invalid proposal is rejected without creating anything
- **WHEN** `validate` is called with a `PipelineProposal` with a blank name, no steps, or a
  malformed step
- **THEN** the result is `Left(ServiceError.BadRequest(_))`, and no pipeline, source, or run is
  created

#### Scenario: A proposal referencing a nonexistent or unowned existing source is rejected
- **WHEN** `validate` is called with a `PipelineProposal` whose source references a `sourceId` that
  does not exist, or exists but is owned by a different user
- **THEN** the result is `Left(ServiceError.NotFound(_))`, and no pipeline, source, or run is
  created
