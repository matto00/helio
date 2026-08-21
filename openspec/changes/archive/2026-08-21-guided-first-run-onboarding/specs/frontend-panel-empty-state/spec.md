## MODIFIED Requirements

### Requirement: Empty state shown when a dashboard has no panels
The system SHALL display a meaningful empty state in the panel area whenever the active dashboard has no
panels and no fetch is pending, and SHALL NOT leave the panel area blank in any such state.

This SHALL include the state reached by deleting a dashboard's last panel, which returns the panel list
to its unstarted status and clears the record of which dashboard was loaded, with no refetch scheduled.
Conditioning the empty state on a resolved status alone leaves that state rendering nothing at all,
permanently. The condition SHALL therefore also admit the invalidated state, distinguished from the frame
before the first fetch is dispatched by the invalidation record described in the loading-state
capability — not by the unstarted status alone, which both states share.

A guided first-run surface MAY occupy this region in place of the empty state, and when it does the empty
state SHALL NOT also render — two stacked surfaces would put two primary actions in one section. Such a
surface SHALL itself satisfy every guarantee this requirement makes: the region is never blank, and the
panel create action remains available from it. The never-blank guarantee attaches to the **region**, not to
one particular component occupying it. When no such surface is active, the empty state SHALL render exactly
as it does today.

#### Scenario: Empty state renders after successful load with no panels
- **WHEN** a dashboard is selected and panels have loaded with status `succeeded`
- **AND** the panel count is zero
- **AND** no guided first-run surface is active
- **THEN** the panel area displays an icon, the heading "No panels yet", descriptive subtext, and an "Add panel" button

#### Scenario: Empty state renders after the dashboard's last panel is deleted
- **WHEN** the last panel on the selected dashboard is deleted, returning the panel list to its unstarted
  state with that dashboard recorded as invalidated and no refetch scheduled
- **AND** no guided first-run surface is active
- **THEN** the panel area displays the same empty state and its "Add panel" action, and does not render blank

#### Scenario: The post-delete state is also superseded when the guided surface is active
- **WHEN** the last panel on the selected dashboard is deleted while a guided first-run surface is active
- **THEN** that surface occupies the region, the empty state does not also render, and the region is not
  blank

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

#### Scenario: A guided first-run surface supersedes the empty state without leaving the region blank
- **WHEN** a dashboard is selected with no panels and a guided first-run surface is active
- **THEN** that surface renders in the panel area, the "No panels yet" empty state does not also render,
  and the panel create action is still reachable from the region

### Requirement: A failed dashboard create is reported on the panel area's own empty surface
When creating a dashboard from the panel area's empty state fails, that surface SHALL report the failure
with the same treatment as every other full-surface failure: an error intent, an error title, an error
icon, and an announced live region. It SHALL carry the specific message the rejection produced, not a
fixed generic sentence, so the inline surface says what the transient notification used to say.

The error treatment SHALL be applied conditionally within that one branch: with no failure present, the
ordinary first-run empty state SHALL remain neutral, with no announced role, unchanged.

This obligation attaches to whichever surface occupies the panel area's zero-content region. Where a guided
first-run surface supersedes the empty state, that surface SHALL report a failed dashboard create with the
same treatment, so superseding the empty state never silently drops the failure report.

#### Scenario: A failed create renders an announced error empty state
- **WHEN** creating a dashboard from the panel area's empty state fails
- **THEN** that surface renders with error intent, an error title, an error icon, an alert role, and the
  rejection's own message

#### Scenario: The first-run empty state stays neutral
- **WHEN** no dashboards exist and no create has failed
- **THEN** the panel area's empty state renders neutral, with no alert role and no error styling

#### Scenario: A superseding guided surface reports a failed create too
- **WHEN** a guided first-run surface occupies the region and a dashboard create invoked from it fails
- **THEN** that surface reports the failure with an error intent, an announced role, and the rejection's
  own message
