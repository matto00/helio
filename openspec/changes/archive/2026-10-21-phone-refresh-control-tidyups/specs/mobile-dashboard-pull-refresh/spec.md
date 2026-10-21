## ADDED Requirements

### Requirement: A visible refresh control is a single-pointer alternative to the pull
On the authenticated dashboard at viewport widths of 768px and below with the phone panel stack mounted and at least one output-bound panel mounted, the system SHALL show a visible refresh button with the accessible name "Refresh dashboard". Activating it by a single tap, a click, or the keyboard (Enter or Space) SHALL call each mounted output-bound panel's existing data refresh exactly once, subject to that panel's in-flight guard, SHALL NOT trigger any pipeline run, and SHALL share the pull's busy state: while a refresh round runs (started by either the button or a pull), activating the button or releasing a pull SHALL start nothing new, and the button SHALL show a busy cue. The existing status region SHALL announce "Refreshing" and then "Refreshed" for a button-started round exactly as for a pull. The button SHALL NOT be rendered when no output-bound panel is mounted, and SHALL NOT be rendered at viewport widths above 768px. Showing the button SHALL NOT shift the panel stack's resting position.

#### Scenario: Single tap refreshes each output-bound panel once
- **WHEN** the user taps "Refresh dashboard" on a phone dashboard with two output-bound panels and one text panel
- **THEN** exactly two rows requests are sent, no pipeline-run request is sent, and the button returns from its busy cue once both settle

#### Scenario: Keyboard activation
- **WHEN** the user focuses "Refresh dashboard" with the keyboard and presses Enter
- **THEN** each output-bound panel's rows are requested exactly once, and the status region announces "Refreshing" then "Refreshed"

#### Scenario: Busy round ignores a second activation
- **WHEN** a refresh round is running and the user activates the button again or releases a pull past the threshold
- **THEN** no additional rows request is sent

#### Scenario: Nothing to refresh
- **WHEN** the phone dashboard has no output-bound panel
- **THEN** no "Refresh dashboard" button exists in the DOM

#### Scenario: Desktop has no button
- **WHEN** a dashboard is open at 1280px
- **THEN** no "Refresh dashboard" button exists in the DOM

### Requirement: The indicator never invites a pull while settling after a refresh
After a pull-started refresh round ends, while the panel list settles back to rest, the pull indicator SHALL show a completed state labelled "Refreshed" and SHALL NOT show the "Pull to refresh" label.

#### Scenario: Full motion settle after a refresh
- **WHEN** the Motion setting is Full and a pull-started refresh round ends
- **THEN** until the indicator unmounts, its label reads "Refreshed" and never "Pull to refresh"
