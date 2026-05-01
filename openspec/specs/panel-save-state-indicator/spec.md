# panel-save-state-indicator Specification

## Purpose
TBD - created by archiving change last-saved-indicator. Update Purpose after archive.
## Requirements
### Requirement: Save state indicator renders in the toolbar when a dashboard is open
The system SHALL display a save-state label in the dashboard command bar whenever a dashboard is selected and the user is on the dashboard view.

#### Scenario: Indicator not shown when no dashboard is selected
- **WHEN** the user is on the dashboard view with no dashboard selected
- **THEN** the save-state indicator is not rendered

#### Scenario: Indicator is shown when a dashboard is open
- **WHEN** the user is on the dashboard view with a dashboard selected
- **THEN** the save-state indicator is visible in the command bar near the dashboard title

### Requirement: Label reflects dirty vs clean save state
The system SHALL show "Unsaved changes" when `pendingPanelUpdates` is non-empty and a "Last saved X ago" relative timestamp when it is empty.

#### Scenario: Dirty state label
- **WHEN** `pendingPanelUpdates` in Redux is non-empty
- **THEN** the indicator label reads "Unsaved changes"

#### Scenario: Clean state label with no prior save
- **WHEN** `pendingPanelUpdates` is empty AND `lastSavedAt` is null
- **THEN** the indicator does not show a relative timestamp (no label or a neutral placeholder)

#### Scenario: Clean state label after a save
- **WHEN** `pendingPanelUpdates` is empty AND `lastSavedAt` is a non-null timestamp
- **THEN** the indicator label reads "Last saved X ago" where X is a live relative time

### Requirement: Relative timestamp updates live without page refresh
The system SHALL tick the "Last saved X ago" label automatically so the displayed time stays current.

#### Scenario: Label transitions from "just now" to seconds ago
- **WHEN** a successful save has occurred within the last 60 seconds
- **THEN** the label displays "Last saved just now" or "Last saved Xs ago" (where X < 60)

#### Scenario: Label transitions to minutes ago
- **WHEN** a successful save occurred more than 60 seconds ago
- **THEN** the label displays "Last saved Xm ago" (where X >= 1)

#### Scenario: Tick interval keeps label current
- **WHEN** time passes without user interaction
- **THEN** the label automatically updates to reflect the new elapsed time without a page refresh

### Requirement: Save now control is revealed on hover
The system SHALL reveal a "Save now" control when the user hovers the save-state indicator.

#### Scenario: Save now is hidden by default
- **WHEN** the user does not hover the save-state indicator
- **THEN** the "Save now" control is not visually prominent (hidden or invisible)

#### Scenario: Save now is shown on hover
- **WHEN** the user hovers over the save-state indicator area
- **THEN** a "Save now" control becomes visible

### Requirement: Save now immediately flushes pending updates
The system SHALL dispatch `updatePanelsBatch` immediately when the user clicks "Save now", clears pending updates, updates the last-saved timestamp, and resets the auto-save timer.

#### Scenario: Save now dispatches updatePanelsBatch
- **WHEN** the user clicks "Save now"
- **THEN** `updatePanelsBatch` is dispatched with all current pending updates
- **AND** `pendingPanelUpdates` is cleared after the successful response
- **AND** `lastSavedAt` is updated to the current time

#### Scenario: Auto-save timer resets after Save now
- **WHEN** the user clicks "Save now"
- **THEN** the 30-second auto-save interval resets so the next auto-save fires 30 seconds after the manual save

#### Scenario: Save now is a no-op when no pending changes
- **WHEN** the user clicks "Save now" with no pending panel updates
- **THEN** no network request is made

### Requirement: Navigation guard prompts on unsaved changes
The system SHALL register a `beforeunload` handler that prompts the user when `pendingPanelUpdates` is non-empty.

#### Scenario: beforeunload fires with pending changes
- **WHEN** `pendingPanelUpdates` is non-empty AND the user closes or navigates away from the page
- **THEN** the browser displays a confirmation prompt warning about unsaved changes

#### Scenario: beforeunload does not fire without pending changes
- **WHEN** `pendingPanelUpdates` is empty AND the user closes or navigates away from the page
- **THEN** no confirmation prompt is shown

