## MODIFIED Requirements

### Requirement: A qualifying release refreshes each output-bound panel once
On a release past the pull threshold the system SHALL refresh each mounted output-bound panel exactly once, SHALL NOT trigger any pipeline run, and SHALL show a busy indicator until those refreshes settle. A panel with no rows request in flight SHALL get its refresh at once. A panel whose rows request is already in flight (including its first load) SHALL NOT get a concurrent request; instead exactly one refresh SHALL be queued for it and sent once the in-flight request settles, and the busy indicator SHALL stay up until that queued request settles. A release short of the threshold, or a cancelled touch, SHALL refresh nothing.

#### Scenario: Release past threshold
- **WHEN** a pull is released past the threshold on a dashboard with two output-bound panels and one text panel
- **THEN** exactly two rows requests are sent, no pipeline-run request is sent, and the indicator returns to rest once both settle

#### Scenario: Release short of threshold
- **WHEN** a pull is released short of the threshold
- **THEN** no request is sent and the indicator returns to rest

#### Scenario: Release during a first load queues one refresh per in-flight panel
- **WHEN** a pull is released past the threshold while each of two output-bound panels' first rows request is still in flight
- **THEN** no request is sent until those settle, then exactly one more rows request is sent per output-bound panel, and the indicator stays busy until the queued requests settle

### Requirement: A visible refresh control is a single-pointer alternative to the pull
On the authenticated dashboard at viewport widths of 768px and below with the phone panel stack mounted and at least one output-bound panel mounted, the system SHALL show a visible refresh button with the accessible name "Refresh dashboard". Activating it by a single tap, a click, or the keyboard (Enter or Space) SHALL refresh each mounted output-bound panel exactly once, SHALL NOT trigger any pipeline run, and SHALL share the pull's busy state: while a refresh round runs (started by either the button or a pull), activating the button or releasing a pull SHALL start nothing new, and the button SHALL show a busy cue. A panel with no rows request in flight SHALL get its refresh at once. A panel whose rows request is already in flight (including its first load) SHALL NOT get a concurrent request; instead exactly one refresh SHALL be queued for it and sent once the in-flight request settles, and the round (busy cue and `aria-disabled`) SHALL stay busy until that queued request settles. The existing status region SHALL announce "Refreshing" and then "Refreshed" for a button-started round exactly as for a pull, once per round. The button SHALL NOT be rendered when no output-bound panel is mounted, and SHALL NOT be rendered at viewport widths above 768px. Showing the button SHALL NOT shift the panel stack's resting position. The per-panel Refresh control, interval polling and pipeline-run refreshes are not rounds and SHALL keep dropping a call made while that panel's request is in flight.

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

#### Scenario: Press during a first load queues one refresh
- **WHEN** the user taps "Refresh dashboard" while each of two output-bound panels' first rows request is still in flight
- **THEN** no request is added while they are in flight; after they settle exactly one more rows request is sent per output-bound panel, never two concurrently for one panel; the button stays busy and the status region does not say "Refreshed" until the queued requests settle

#### Scenario: Repeated presses during a first load do not multiply requests
- **WHEN** the user activates "Refresh dashboard" three times (tap, tap, Enter) while the panels' first rows requests are in flight
- **THEN** exactly one additional rows request per output-bound panel is sent in total, and no further request follows once the round has ended

#### Scenario: Per-panel triggers are unchanged
- **WHEN** an interval poll or a pipeline-run refresh fires for a panel while its rows request is in flight
- **THEN** no request is queued or sent for that call
