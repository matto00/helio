## MODIFIED Requirements

### Requirement: The editor offers disable/enable and duplicate per step
Each StepCard SHALL offer, as sibling controls in its header actions cluster:
- A disable/enable toggle whose accessible action name reflects the next state (Disable step /
  Enable step); toggling persists via the step PATCH and reflects optimistically, reverting with
  a visible error on failure
- A "Duplicate step" action that invokes the duplicate endpoint and renders the clone directly
  after the original on success, surfacing a visible error on failure. This action SHALL be
  guarded against re-entry: while a duplicate request for a given step is in flight, further
  activations of that step's "Duplicate step" action SHALL be ignored, and the guard SHALL clear
  when the request settles (success or failure), re-enabling the action.
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

#### Scenario: Double-activation while a duplicate request is in flight produces exactly one clone
- **WHEN** the user activates "Duplicate step" on a step twice in rapid succession (including two
  synchronous activations in the same event-loop tick) before the first request settles
- **THEN** the system calls the duplicate endpoint exactly once
- **AND** exactly one clone is inserted after the original

#### Scenario: Duplicate step action re-enables after the request settles
- **WHEN** a duplicate request for a step completes, whether successfully or with an error
- **THEN** the "Duplicate step" action for that step is enabled again and a subsequent activation
  issues a new request
