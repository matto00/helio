# pipeline-step-lifecycle Specification

## Purpose
Let pipeline authors manage a step's lifecycle beyond create/delete: duplicate a configured step (clone inserted directly after the original) and disable/enable a step without losing its config — with disabled steps excluded from every execution and analysis surface (runs, analyze, proposal analysis, bound-panel projection, preview) until re-enabled.
## Requirements
### Requirement: Disabled steps are excluded from execution, analysis, and preview
A pipeline step SHALL carry a persisted `enabled` flag (default true). When `enabled` is false:
- Full runs and dry runs SHALL execute the pipeline as if the step were absent (remaining steps
  run in their existing order)
- The analyze endpoint SHALL compute schemas over the enabled steps only; the analyze response
  SHALL contain per-step entries for enabled steps only
- Every other analyze entry point consuming step definitions SHALL apply the same exclusion:
  proposal analysis (`POST /api/pipelines/analyze-proposal`) and bound-panel schema projection
  SHALL treat a step definition carrying `enabled: false` as absent (absent `enabled` = true)
- The step-preview endpoint SHALL exclude disabled steps from the executed prefix; requesting a
  preview OF a disabled step SHALL return `422 Unprocessable Entity`
- Disabling SHALL NOT change any step's `position`; re-enabling restores the step to full
  participation with its config intact

#### Scenario: Run skips a disabled step
- **WHEN** a pipeline has steps A (enabled), B (disabled), C (enabled) and a run executes
- **THEN** the result equals running A then C; B's transform is not applied

#### Scenario: Analyze covers enabled steps only
- **WHEN** the analyze endpoint is called for a pipeline with a disabled step
- **THEN** the response's step entries cover only the enabled steps, with schemas flowing as if
  the disabled step were absent

#### Scenario: Preview prefix skips disabled steps
- **WHEN** a preview is requested for enabled step C, and a disabled step B precedes it
- **THEN** the preview rows reflect the prefix with B excluded

#### Scenario: Previewing a disabled step is rejected
- **WHEN** a preview is requested for a step whose `enabled` is false
- **THEN** the response is `422 Unprocessable Entity`

#### Scenario: Re-enable restores behavior with config intact
- **WHEN** a disabled step is re-enabled and the pipeline runs
- **THEN** the step executes with its original config, at its original position

#### Scenario: All steps disabled behaves as a zero-step pipeline
- **WHEN** every step of a pipeline is disabled and a run executes
- **THEN** the run behaves exactly as a pipeline with no steps (source passthrough)

#### Scenario: Proposal analysis excludes a disabled proposed step
- **WHEN** a pipeline proposal is analyzed and one of its step definitions carries
  `enabled: false`
- **THEN** the projected schemas are computed as if that step were absent, matching what the live
  analyze endpoint would report for the same pipeline once applied

### Requirement: POST /api/pipeline-steps/:id/duplicate clones a step after the original
The backend SHALL expose `POST /api/pipeline-steps/:id/duplicate` (no request body) that:
- Requires editor or owner access on the parent pipeline (viewers → `403 Forbidden`; unknown or
  invisible steps → `404 Not Found`, masking existence)
- Creates a new step with the same `type`, `config`, and `enabled` value as the original,
  inserted at the original's list position + 1, renumbering the pipeline's positions contiguously
  within a single transaction (the insert-at machinery)
- Returns `201 Created` with the created step object

#### Scenario: Duplicate lands directly after the original
- **WHEN** a pipeline has steps A, B, C and B is duplicated
- **THEN** the order becomes A, B, B', C with contiguous positions, and B' has B's type, config,
  and enabled value

#### Scenario: Duplicating a disabled step yields a disabled clone
- **WHEN** a disabled step is duplicated
- **THEN** the clone is also disabled

#### Scenario: Viewer cannot duplicate
- **WHEN** a user with only viewer access calls the duplicate endpoint
- **THEN** the response is `403 Forbidden` and no step is created

### Requirement: The editor offers disable/enable and duplicate per step
Each StepCard SHALL offer, as sibling controls in its header actions cluster:
- A disable/enable toggle whose accessible action name reflects the next state (Disable step /
  Enable step); toggling persists via the step PATCH and reflects optimistically, reverting with
  a visible error on failure
- A "Duplicate step" action that invokes the duplicate endpoint and renders the clone directly
  after the original on success, surfacing a visible error on failure
- Disabled cards SHALL render visually muted (design-token styling), with the preview control
  unavailable; the config editor remains visible and editable
- A toggle SHALL refresh analysis (and open previews) so schemas/validation reflect the changed
  effective pipeline

#### Scenario: Toggle disables and mutes a step
- **WHEN** the user activates "Disable step" on an enabled step
- **THEN** the card renders muted, its preview control is unavailable, the change persists, and
  analysis refreshes without the step

#### Scenario: Duplicate from the card
- **WHEN** the user activates "Duplicate step" on a configured step
- **THEN** an identical step appears directly after it and persists across reload

#### Scenario: Failed toggle reverts
- **WHEN** the disable PATCH fails
- **THEN** the card returns to its previous state and a visible error is surfaced

