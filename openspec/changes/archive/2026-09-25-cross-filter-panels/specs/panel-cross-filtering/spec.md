## Purpose

Defines dashboard-scoped, client-side cross-filtering: an explicit action in a chart panel's
Inspect view narrows sibling panels sharing that data column to the matching subset, with a
dismissible dashboard-level indicator and honest disclosure when the loaded rows are truncated.

## ADDED Requirements

### Requirement: An explicit Inspect-view action sets a dashboard-scoped cross-filter
The Inspect view (chart-drilldown-inspect) SHALL offer an action, alongside its existing
clear/return control, that sets a single dashboard-scoped active cross-filter from the Inspect
view's current selection (`dimension`, `value`, and the originating panel id), and closes the
Inspect view. A chart element click alone SHALL NOT set or change the active cross-filter — it
SHALL continue to only open the Inspect view (chart-drilldown-inspect, unchanged). Activating the
action while viewing a different selection than any currently active cross-filter SHALL replace
the active cross-filter, not combine with it. Activating the action again for the identical
selection SHALL leave the active cross-filter unchanged (idempotent, not a toggle).

#### Scenario: Opening Inspect and clicking the filter action sets the dashboard's cross-filter
- **WHEN** the user opens the Inspect view for a selection mapped to column "quarter", category
  "Q1", and activates its "Filter dashboard by quarter: Q1" action
- **THEN** the dashboard's active cross-filter becomes `dimension: "quarter", value: "Q1"`
- **AND** the Inspect view closes

#### Scenario: A chart click alone does not set a cross-filter
- **WHEN** the user clicks a chart element
- **THEN** the Inspect view opens (chart-drilldown-inspect, unchanged) and no cross-filter is set
  or changed

#### Scenario: Activating the filter action for a different selection replaces the cross-filter
- **WHEN** a cross-filter is active and the user activates the filter action for a different
  Inspect selection
- **THEN** the active cross-filter is replaced by the new selection, not combined with the
  previous one

#### Scenario: Re-activating the filter action for the identical selection is a no-op
- **WHEN** the active cross-filter already matches the Inspect view's current selection and the
  user activates the filter action again
- **THEN** the active cross-filter is unchanged

#### Scenario: The filter action is reachable by keyboard
- **WHEN** a keyboard user opens Inspect via the panel's `ActionsMenu` "Inspect" entry
- **THEN** the filter action is reachable and operable without a pointer

### Requirement: An active cross-filter narrows sibling panels whose field mapping references the filtered column
While a cross-filter is active, every Output-kind panel on the current dashboard, OTHER than the
panel that originated the selection, whose field mapping references a column matching the
cross-filter's `dimension` by exact name, SHALL render only the rows whose value in that column
equals the cross-filter's `value` (comparing numerically when both values parse as numbers, so
differing numeric string formatting still matches). For a table panel, "field mapping references
a column" means the column is part of the table's effective displayed-column set. A panel whose
field mapping does not reference a matching column SHALL render unaffected, with no visible
change, even if its underlying data happens to contain a same-named column it does not map. The
originating panel SHALL always render its own full, unfiltered data.

#### Scenario: A sibling panel whose field mapping references the column narrows to the matching subset
- **WHEN** a cross-filter `dimension: "quarter", value: "Q1"` is active
- **AND** a sibling chart panel's field mapping maps its x-axis to a "quarter" column
- **THEN** that chart panel renders only rows whose "quarter" value is "Q1"

#### Scenario: A panel with an unmapped, same-named column is unaffected
- **WHEN** a cross-filter is active
- **AND** a sibling panel's underlying data contains a column matching the cross-filter's
  dimension, but no part of that panel's own field mapping references it
- **THEN** that panel's rendered rows are unchanged

#### Scenario: A numeric selection matches a differently-formatted sibling column
- **WHEN** a cross-filter's value is a numeric string produced by a scatter-chart selection (e.g.
  `"3"`)
- **AND** a sibling panel's matching column stores the equal value with different formatting
  (e.g. `"3.0"`)
- **THEN** that sibling panel still narrows to the matching rows

#### Scenario: The originating panel is not filtered by its own selection
- **WHEN** the filter action is activated from panel A's Inspect view, setting a cross-filter on
  one of panel A's own mapped columns
- **THEN** panel A continues to render its full, unfiltered data

#### Scenario: A metric or aggregating panel recomputes over the filtered subset
- **WHEN** a cross-filter narrows the rows reaching a metric panel
- **THEN** the metric panel's displayed value is derived from the filtered subset, not the full
  loaded set

### Requirement: The active cross-filter is shown via a dismissible dashboard-level indicator
While a cross-filter is active, the system SHALL render exactly one dashboard-level indicator
stating the active filter (naming the dimension and value) with a control that clears it. This
indicator's clear control is the only way to clear an active cross-filter (aside from panel
deletion or dashboard switch). The indicator SHALL be announced to assistive technology when the
filter changes (set, replaced, or cleared).

#### Scenario: The indicator appears when a cross-filter becomes active
- **WHEN** a cross-filter becomes active
- **THEN** a dashboard-level indicator naming the filtered dimension and value is visible

#### Scenario: The indicator's clear control removes the filter
- **WHEN** the user activates the indicator's clear control
- **THEN** the active cross-filter is cleared and every panel returns to its unfiltered data

#### Scenario: A filter change is announced to assistive technology
- **WHEN** the active cross-filter is set, replaced, or cleared
- **THEN** the change is exposed via an accessible live-region announcement

### Requirement: A cross-filtered panel discloses when its own data is truncated
When a panel is being narrowed by an active cross-filter AND that panel's own loaded rows are
truncated (more rows exist upstream than are currently loaded), the panel SHALL disclose that the
filtered result reflects only the currently loaded rows, rather than implying it is complete.

#### Scenario: A cross-filtered, truncated panel discloses its loaded scope
- **WHEN** a cross-filter narrows a panel whose own data is truncated
- **THEN** the panel discloses that only the currently loaded rows are reflected in the filtered
  result

#### Scenario: A cross-filtered panel with fully loaded data discloses nothing extra
- **WHEN** a cross-filter narrows a panel whose own data is NOT truncated
- **THEN** no truncation disclosure is shown for that panel

### Requirement: The cross-filter is dashboard-scoped view state, never persisted
The active cross-filter SHALL be transient view state, not persisted to the backend dashboard
layout or any panel record. It SHALL be cleared when the user navigates to a different dashboard,
and when the panel that originated it is deleted.

#### Scenario: Switching dashboards clears the cross-filter
- **WHEN** a cross-filter is active on dashboard A and the user navigates to dashboard B
- **THEN** dashboard B renders with no active cross-filter, and returning to dashboard A also
  shows no active cross-filter

#### Scenario: Deleting the originating panel clears the cross-filter
- **WHEN** a cross-filter is active and the panel that originated it is deleted
- **THEN** the active cross-filter is cleared

#### Scenario: Reloading the page does not restore a cross-filter
- **WHEN** a cross-filter is active and the page is reloaded
- **THEN** no cross-filter is restored — it was never persisted
