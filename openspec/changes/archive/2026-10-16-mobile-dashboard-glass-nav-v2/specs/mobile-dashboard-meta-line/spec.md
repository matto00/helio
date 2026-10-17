## Purpose

The phone dashboard view shows when the dashboard's data last refreshed, using the same facts as the desktop meta row.

## ADDED Requirements

### Requirement: Phone dashboard view shows the refresh line
On the phone shell's authenticated dashboard view, the dashboard view SHALL show a mono caption line as the first
item of the panel list, directly above the dashboard chip row, with the same refresh fact the desktop meta row shows ("refreshed <ago>",
"last run failed <ago>" or "not refreshed yet"), derived from `useDashboardMeta` through one shared
text helper used by both surfaces. The line SHALL be absent when the refresh state is unknown, absent
on the public shared-dashboard route, and SHALL expose the timestamp through a `<time>` element.

#### Scenario: A dashboard fed by a pipeline that has run
- **WHEN** a phone user opens a dashboard whose feeding pipeline last ran successfully 9 hours ago
- **THEN** "refreshed 9h ago" shows above the chip row, the same text (and, for a failed run, the
  same danger dot) the desktop meta row shows for that dashboard

#### Scenario: Unknown refresh state
- **WHEN** no feeding pipeline is known
- **THEN** no refresh line renders

#### Scenario: The phone command bar height is unchanged
- **WHEN** the line renders at 320px and 375px
- **THEN** the phone command bar keeps its existing height, and the line sits in normal flow above
  the chips, 12px from the screen edge
