## MODIFIED Requirements

### Requirement: Caption, live marker and stale states
While a draft exists the view SHALL show the caption "Rendered from the draft. Nothing is written until you save and run.". The "live" marker (success-intent dot and lowercase mono "live") SHALL show only while the displayed frame is the current draft's; while a newer draft frame exists but has not yet been rendered (the render is settling), and while a server fallback for the node is in flight, the view SHALL show "updating" and the last rendered frame; while an upstream step is in error or the frame is a last-good one it SHALL show "stale". An upstream error's message SHALL NOT be repeated in the view's note, since the step editor and the preview table already show it. With no draft the view SHALL show no "live" marker.

#### Scenario: Error upstream
- **WHEN** a draft edit puts a step above the Output's node in error
- **THEN** the view keeps the last good render, shows "stale", the "live" marker is absent, and the error message appears in the editor and preview table but not in the Output view

#### Scenario: Settling after an edit
- **WHEN** a draft edit changes the Output's node rows and the newer frame has not rendered yet
- **THEN** the view shows "updating" instead of "live" until the newer frame renders, then shows "live"

#### Scenario: Unrelated re-render
- **WHEN** the page re-renders for a reason that does not change the Output's node frame (a dialog opens, a run status changes)
- **THEN** the view keeps its marker and does not show "updating"

#### Scenario: No draft
- **WHEN** the page is open with no draft
- **THEN** the view renders the saved pipeline over the sample and no "live" marker is shown

## ADDED Requirements

### Requirement: A continuous burst of edits still updates the view
While draft edits keep arriving without a pause, the live Output view SHALL still render the latest frame at least
once every 1500 ms plus at most one idle timeout, whether or not the browser provides `requestIdleCallback`.

#### Scenario: Edits every 100 ms for 3 s
- **WHEN** draft edits arrive every 100 ms for 3 seconds
- **THEN** the view renders an intermediate frame before the burst ends, not only after it
