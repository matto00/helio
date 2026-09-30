## ADDED Requirements

### Requirement: Output-bound panels expose a provenance popover in every render path
Every output-bound panel (table, chart, metric and any other output kind) SHALL expose a keyboard-operable, labelled provenance trigger that opens a popover, in the desktop grid, mobile panel stack, fullscreen overlay, detail modal and public dashboard viewer. Panels with no bound output SHALL NOT show the trigger.

#### Scenario: Open on each path
- **WHEN** the trigger is activated on an output-bound panel in any of the five render paths
- **THEN** the popover opens showing source(s), pipeline, node path, last run, row count and check summary

#### Scenario: Unbound panel
- **WHEN** a panel has no bound output
- **THEN** no provenance trigger is rendered

### Requirement: Popover content and degraded states
The popover SHALL render node path entries as human-readable step labels (never raw op ids), last run as relative time with the absolute time on hover/focus, and SHALL distinguish: never run (lastRun null), running, last run failed, ran but produced no rows (lastRun present, status succeeded, rowCount null - the wire cannot distinguish an empty snapshot from an absent one), no assertions defined, checks passed/failed/warned, and 1..N sources. The authenticated variant SHALL show an "Open pipeline" link; the public variant SHALL show no link, ids or error text.

#### Scenario: Never run versus no rows
- **WHEN** lastRun is null
- **THEN** the popover says the output has never been run
- **WHEN** lastRun.status is succeeded and rowCount is null
- **THEN** the popover says "No rows recorded for this output" (never "—" and never a bare 0)

#### Scenario: Public variant
- **WHEN** an anonymous or share-token viewer opens provenance
- **THEN** the public endpoint is used and no Open pipeline link is rendered

### Requirement: Lazy, cached fetch
Provenance SHALL NOT be requested until the popover is first opened; a second open SHALL be served from cache without a new request. The Invalid data badge SHALL open the popover at its checks section rather than duplicate it.

#### Scenario: Second open
- **WHEN** a popover is opened, closed and opened again
- **THEN** exactly one provenance request was made

### Requirement: Popover accessibility
The popover SHALL trap focus while open (Tab/Shift+Tab wrap inside it), return focus to the trigger on close, close on Escape, be announced as a labelled dialog, and meet the shared-popover-touch-targets minimum at phone width.

#### Scenario: Escape
- **WHEN** Escape is pressed while open
- **THEN** the popover closes and focus returns to the trigger

### Requirement: Telemetry hook point
The popover SHALL call a single typed `onProvenanceOpened` hook point on open, with no other logging, for HEL-1208 to fill in.

#### Scenario: Hook invoked once per open
- **WHEN** the popover opens
- **THEN** the hook is called once with the panel id and variant

### Requirement: Popover events do not leak to the host panel or enclosing modal
Clicks and key events inside the popover or on its trigger SHALL NOT open the detail modal via the card/item click handlers, and Escape SHALL close only the popover (not an enclosing fullscreen or detail modal) while it is open.

#### Scenario: Click inside popover on desktop card and mobile stack
- **WHEN** non-button text inside the open popover is clicked
- **THEN** the detail modal does not open

#### Scenario: Escape inside a modal
- **WHEN** the popover is open inside the fullscreen overlay or detail modal and Escape is pressed
- **THEN** only the popover closes; the modal stays open
