# mobile-dashboard-pull-refresh Specification

## Purpose
Defines the phone dashboard's pull-to-refresh gesture: when it engages, how it contains the browser's overscroll, what a refresh re-requests, and how it behaves at each Motion level.

## Requirements

### Requirement: Pull engages only from the top of the phone dashboard
On the authenticated dashboard at viewport widths of 768px and below with the phone panel stack mounted, the system SHALL engage the pull gesture only for a single-finger touch drag that moves downward, is vertical-dominant, and starts while the dashboard scroller (`.app-content`) is at scrollTop 0 and not inside a nested scroller that is itself scrolled away from its top. Any other drag SHALL scroll the page normally and SHALL NOT be prevented.

#### Scenario: Pull from the top engages
- **WHEN** a touch drag moves downward from a point on the stack while `.app-content` is at scrollTop 0
- **THEN** the pull indicator appears and reflects the pull state (under Full motion the panel list also follows the finger)

#### Scenario: Scrolled page does not engage
- **WHEN** `.app-content` is scrolled below the top and the user drags downward
- **THEN** the page scrolls up natively and no pull indicator appears

#### Scenario: Mouse drag does not engage
- **WHEN** a mouse or pen drags downward on the stack at scrollTop 0
- **THEN** no pull indicator appears and nothing refreshes

### Requirement: Overscroll is contained only on the phone dashboard
The system SHALL set `overscroll-behavior-y: contain` on `.app-content` while, and only while, the phone dashboard stack is mounted at a viewport width of 768px or below.

#### Scenario: Containment on the phone dashboard
- **WHEN** the phone dashboard stack is mounted at 375px
- **THEN** `.app-content` computes `overscroll-behavior-y: contain`

#### Scenario: No containment elsewhere
- **WHEN** the user is on any other page, or on a dashboard wider than 768px
- **THEN** `.app-content` computes `overscroll-behavior-y: auto`

### Requirement: A qualifying release refreshes each output-bound panel once
On a release past the pull threshold the system SHALL call each mounted output-bound panel's existing data refresh exactly once, subject to that panel's in-flight guard, SHALL NOT trigger any pipeline run, and SHALL show a busy indicator until those refreshes settle. A release short of the threshold, or a cancelled touch, SHALL refresh nothing.

#### Scenario: Release past threshold
- **WHEN** a pull is released past the threshold on a dashboard with two output-bound panels and one text panel
- **THEN** exactly two rows requests are sent, no pipeline-run request is sent, and the indicator returns to rest once both settle

#### Scenario: Release short of threshold
- **WHEN** a pull is released short of the threshold
- **THEN** no request is sent and the indicator returns to rest

### Requirement: Motion level governs movement
Under the Full motion level the panel list SHALL follow the finger (damped) and SHALL settle with a transition timed by DESIGN.md §10 motion tokens. Under Subtle, Off, or OS reduced motion nothing SHALL translate; the indicator SHALL snap between its states with no transition, and a qualifying release SHALL still refresh.

#### Scenario: Off snaps
- **WHEN** the Motion setting is Off and a pull past the threshold is held
- **THEN** the panel list has no transform and the indicator shows its ready state without a transition

### Requirement: Desktop unchanged
At viewport widths above 768px the system SHALL NOT attach the pull gesture, render the pull indicator, or change `.app-content`'s overscroll behavior.

#### Scenario: Desktop dashboard
- **WHEN** a dashboard is open at 1280px
- **THEN** no pull indicator exists in the DOM and `.app-content` computes `overscroll-behavior-y: auto`

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
