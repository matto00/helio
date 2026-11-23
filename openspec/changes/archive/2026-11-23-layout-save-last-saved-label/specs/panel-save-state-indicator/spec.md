## MODIFIED Requirements

### Requirement: Label reflects dirty vs clean save state
The system SHALL show "Unsaved changes" when `pendingPanelUpdates` is non-empty or a layout change is pending, and a
"Last saved X ago" relative timestamp when neither is. The timestamp SHALL be the time of the most recent successful save of either kind: a panel
batch save or a dashboard layout save (a drag, resize, Tidy or Undo). The owner's one-time stored-layout repair is not
a save for this purpose and SHALL NOT set the timestamp.

#### Scenario: Dirty state label
- **WHEN** `pendingPanelUpdates` in Redux is non-empty
- **THEN** the indicator label reads "Unsaved changes"

#### Scenario: Clean state label with no prior save
- **WHEN** `pendingPanelUpdates` is empty AND `lastSavedAt` is null
- **THEN** the indicator does not show a relative timestamp (no label or a neutral placeholder)

#### Scenario: Clean state label after a save
- **WHEN** `pendingPanelUpdates` is empty AND `lastSavedAt` is a non-null timestamp
- **THEN** the indicator label reads "Last saved X ago" where X is a live relative time

#### Scenario: Layout-only save sets the label
- **GIVEN** no panel save has happened on the open dashboard (or the last one was minutes ago)
- **WHEN** a dashboard layout save succeeds (for example after a drag) and nothing else is pending
- **THEN** the indicator label reads "Last saved just now"

#### Scenario: Stored-layout repair does not set the label
- **WHEN** the one-time stored-layout repair POST succeeds and no other save has happened
- **THEN** the indicator shows no "Last saved" timestamp

#### Scenario: Timestamp resets on dashboard switch and sign-out
- **WHEN** the user switches to another dashboard, or signs out
- **THEN** the last-saved timestamp is cleared, whichever kind of save set it
