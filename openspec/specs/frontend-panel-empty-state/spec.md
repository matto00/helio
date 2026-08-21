# frontend-panel-empty-state Specification

## Purpose
Empty-state coverage for the dashboard panel area: what the panel area renders when the active
dashboard has no panels, in every reachable no-data state, and the call to action that lets the
user add one.
## Requirements
### Requirement: Empty state shown when a dashboard has no panels
The system SHALL display a meaningful empty state in the panel area whenever the active dashboard has no
panels and no fetch is pending, and SHALL NOT leave the panel area blank in any such state.

This SHALL include the state reached by deleting a dashboard's last panel, which returns the panel list
to its unstarted status and clears the record of which dashboard was loaded, with no refetch scheduled.
Conditioning the empty state on a resolved status alone leaves that state rendering nothing at all,
permanently. The condition SHALL therefore also admit the invalidated state, distinguished from the frame
before the first fetch is dispatched by the invalidation record described in the loading-state
capability — not by the unstarted status alone, which both states share.

#### Scenario: Empty state renders after successful load with no panels
- **WHEN** a dashboard is selected and panels have loaded with status `succeeded`
- **AND** the panel count is zero
- **THEN** the panel area displays an icon, the heading "No panels yet", descriptive subtext, and an "Add panel" button

#### Scenario: Empty state renders after the dashboard's last panel is deleted
- **WHEN** the last panel on the selected dashboard is deleted, returning the panel list to its unstarted
  state with that dashboard recorded as invalidated and no refetch scheduled
- **THEN** the panel area displays the same empty state and its "Add panel" action, and does not render blank

#### Scenario: Empty state is not shown while panels are loading
- **WHEN** a dashboard is selected and panel status is `loading`
- **THEN** the empty state block is not visible

#### Scenario: Empty state is not shown before the first fetch is dispatched
- **WHEN** a dashboard is selected, the panel list is unstarted, and that dashboard is not recorded as
  invalidated
- **THEN** the empty state block is not visible, because a fetch is pending dispatch

#### Scenario: Empty state is not shown when panels exist
- **WHEN** a dashboard is selected and one or more panels are present
- **THEN** the empty state block is not visible and the panel grid renders normally

### Requirement: Empty state CTA opens the panel create form
The system SHALL provide an "Add panel" button in the empty state that opens the same inline panel create form as the header `+` button.

#### Scenario: Clicking "Add panel" in empty state opens the create form
- **WHEN** the empty state is visible
- **AND** the user clicks the "Add panel" button
- **THEN** the inline panel create form becomes visible (identical to clicking the header `+` button)

### Requirement: A failed dashboard create is reported on the panel area's own empty surface
When creating a dashboard from the panel area's empty state fails, that surface SHALL report the failure
with the same treatment as every other full-surface failure: an error intent, an error title, an error
icon, and an announced live region. It SHALL carry the specific message the rejection produced, not a
fixed generic sentence, so the inline surface says what the transient notification used to say.

The error treatment SHALL be applied conditionally within that one branch: with no failure present, the
ordinary first-run empty state SHALL remain neutral, with no announced role, unchanged.

#### Scenario: A failed create renders an announced error empty state
- **WHEN** creating a dashboard from the panel area's empty state fails
- **THEN** that surface renders with error intent, an error title, an error icon, an alert role, and the
  rejection's own message

#### Scenario: The first-run empty state stays neutral
- **WHEN** no dashboards exist and no create has failed
- **THEN** the panel area's empty state renders neutral, with no alert role and no error styling

