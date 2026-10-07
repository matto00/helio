## MODIFIED Requirements

### Requirement: Comparison point is the next-older retained point
For a selected point that is not the oldest returned point, the comparison point SHALL be the next-older returned point, labelled "vs <localized capture time>". The oldest returned point SHALL have no comparison point and show no comparison. No copy in the view SHALL contain "previous run". The selected point's capture-time label and the comparison point's capture-time label SHALL never render identically: when the two fall in the same minute the labels SHALL include seconds; when they fall in the same second the labels SHALL include milliseconds; and when the two instants are identical to the millisecond the comparison label SHALL carry the suffix "(older capture)". Every place the view renders the comparison's "vs" label (summary caption, metric baseline, chart overlay legend, rows comparison notes) SHALL use the same disambiguated label.

#### Scenario: Label
- **WHEN** the selected point is newest and the next-older point was captured 2026-10-05T14:02Z
- **THEN** the comparison is labelled "vs" followed by that localized date/time

#### Scenario: Oldest point
- **WHEN** the oldest point is selected
- **THEN** no comparison label, overlay or changed-rows highlight is rendered

#### Scenario: Same-second capture times
- **WHEN** the selected point was captured 2026-10-05T14:02:03.900Z and its comparison point 2026-10-05T14:02:03.100Z
- **THEN** the header and the "vs" label render different text, each including milliseconds

#### Scenario: Identical capture times
- **WHEN** the selected point and its comparison point have the same `capturedAt`
- **THEN** the "vs" label ends with "(older capture)" and differs from the header text

### Requirement: Changed-rows highlight uses whole-row content matching and only with both payloads
When the selected point and its comparison point BOTH have payloads, the rendered rows SHALL be compared by whole-row content as a multiset: a selected-point row whose exact content (all keys and values, key order irrelevant) matches an unconsumed comparison row is unchanged; every other selected-point row SHALL be highlighted as "new or changed" (not by colour alone: a leading "Change" column, supplied through a table-renderer leading-column mechanism that never mutates rows and is excluded from sort, filter, pin, column order and persisted table state, reads "New or changed" for each highlighted row). The view SHALL state the count of comparison rows with no match ("N rows from <time> no longer present"). When both payloads are loaded and the diff finds no new-or-changed row and no row no longer present, the view SHALL state "No row changes vs <time>". The comparison note SHALL render directly below the table's rendered rows rather than below a fixed-height empty area: the table area SHALL size to its content up to a 360px cap, scrolling within the cap for longer tables. There SHALL be no cell-level highlight. When either point lacks a payload, no row SHALL be highlighted, no "no longer present" count and no "No row changes" note SHALL be shown, and the view SHALL state that row comparison is unavailable for this pair.

#### Scenario: Added and changed rows
- **WHEN** comparison rows are {a:1},{a:2} and selected rows are {a:1},{a:3}
- **THEN** the {a:3} row is highlighted, {a:1} is not, and "1 row … no longer present" is shown

#### Scenario: Duplicates are a multiset
- **WHEN** comparison rows are {a:1} and selected rows are {a:1},{a:1}
- **THEN** exactly one of the two {a:1} rows is highlighted and zero rows are reported no longer present

#### Scenario: Identical payloads
- **WHEN** both payloads are loaded and contain the same rows
- **THEN** no row is highlighted, no "no longer present" count appears, and "No row changes vs <time>" is shown

#### Scenario: Missing comparison payload never reads as removal
- **WHEN** the selected point has a payload and its comparison point does not
- **THEN** the rows render unhighlighted, no "no longer present" count and no "No row changes" note appears, and a note says row comparison is unavailable

#### Scenario: Short table
- **WHEN** the selected point's payload has 2 rows
- **THEN** the comparison note renders immediately below those rows, not below a 360px-tall table area
