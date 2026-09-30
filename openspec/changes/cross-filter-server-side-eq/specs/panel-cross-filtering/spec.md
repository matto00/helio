## MODIFIED Requirements

### Requirement: An active cross-filter narrows sibling panels whose field mapping references the filtered column
An active cross-filter SHALL narrow every target panel (any panel other than the originating one) whose Output field mapping references the filter's dimension. When the column is not timestamp-typed and the Output's filter capabilities allow `eq` on that dimension, the narrowing SHALL be applied as a server-side `eq` filter on the panel's Output read, ANDed with that panel's viewer-control selections and its own table filters, so the panel's total count and `hasMore` describe the whole filtered Output. When the capabilities do not allow `eq` on the dimension, the panel SHALL keep the prior behaviour: narrowing the already-loaded rows client-side with the existing loaded-scope disclosure. A panel whose Output lacks the column or whose field mapping does not reference it SHALL be unaffected.

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
- **WHEN** (scoped to numeric-typed columns and to the client fallback path; a string-typed column on the server path compares exact text) a cross-filter's value is a numeric string produced by a scatter-chart selection (e.g.
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

#### Scenario: Cross-filtered table over an Output larger than one page
- **WHEN** a cross-filter is active and a target table panel is bound to an Output with more rows than one page
- **THEN** the panel's Output read carries an `eq` op for the dimension and the panel shows the whole-Output match count and a `hasMore` describing the filtered set

#### Scenario: Cross-filter and a control target the same column
- **WHEN** a viewer control and the cross-filter both constrain the same column on one panel
- **THEN** both apply (intersection), with no override in either direction; when both are an `eq` on the column the cross-filter narrows the control-filtered loaded rows client-side (the backend rejects a duplicate `eq` op), otherwise both are server ops

#### Scenario: Contract disallows eq on the dimension
- **WHEN** the Output's filter capabilities do not list `eq` for the dimension
- **THEN** the panel narrows its loaded rows client-side and shows the loaded-scope disclosure, as before

#### Scenario: Clearing restores server state
- **WHEN** the cross-filter is cleared while a filtered response is still in flight
- **THEN** the panel returns to its prior (unfiltered by cross-filter) server state and the stale filtered response is discarded

#### Scenario: Public dashboards
- **WHEN** a dashboard is viewed publicly
- **THEN** no cross-filter can be set and the public rows route's allowed columns are unchanged

### Requirement: Cross-filter application is announced
When a server-applied cross-filter changes a panel's data, and when it is cleared, the panel's live region SHALL announce the filtered state (dimension, value, result count) and the clearing (result count), once the fetch has settled.

#### Scenario: Announcement
- **WHEN** a cross-filter is set and a target panel's filtered fetch settles
- **THEN** the live region reads "Filtered by <dimension> = <value>: N results."
