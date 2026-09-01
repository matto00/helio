## ADDED Requirements

### Requirement: Applying a pipeline proposal creates outputs and placements
Applying an accepted `PipelineProposal` SHALL create the proposed pipeline's steps and outputs, and
create dashboard placements for any proposed Output-backed panels, using the same single-
transaction create path as `POST /api/pipelines`.

#### Scenario: Apply creates outputs and placements atomically
- **WHEN** an accepted pipeline proposal containing outputs and dashboard placements is applied
- **THEN** the pipeline, its outputs, and the placements are created together, or none are, in one
  transaction
