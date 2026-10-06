# output-history-scrubber Specification

## Purpose
The per-Output History view opened from the pipeline Outputs tab: scrubbing retained history points, each point's summary and (when stored) its rows, the next-older comparison point, and the whole-row changed-rows highlight.

## Requirements

### Requirement: History view is opened per Output from the Outputs tab
Each Output card in a pipeline's Outputs tab SHALL offer a "History" action with an accessible name naming the Output, distinct from opening the Output's editor. Activating it SHALL open a History view for that one Output, which fetches `GET /api/outputs/:id/history` and lists that Output's retained points newest first. The pipeline's run-history modal SHALL be unchanged except that its trigger labels come from the same shared trigger-source label helper, so an `auto-run` run reads "Auto-run".

#### Scenario: Opening history
- **WHEN** the user activates "History" on an Output card
- **THEN** a History view for that Output opens and requests `/api/outputs/<id>/history`, and the Output editor does not open

#### Scenario: No history yet
- **WHEN** the history response has zero points
- **THEN** the view renders an EmptyState stating no runs have been recorded for this Output yet

#### Scenario: Fetch failure
- **WHEN** the history request fails
- **THEN** the view renders a visible intent-error message and no point list

### Requirement: Scrubbing selects a point and shows its summary
The History view SHALL provide a keyboard-operable scrubber over the returned points (newest selected by default; arrow keys move older/newer; each point's accessible name contains its localized capture time). The selected point SHALL show its capture time, its trigger source as a human label (`manual`→Manual, `scheduled`→Scheduled, `external`→External, `auto-run`→Auto-run, any other value shown as its sentence-cased raw text, never empty or "undefined"), its row count, and, from its stored summary: the headline metric value when present, and the per-numeric-column count/sum/min/max when present. Summary display SHALL NOT require a payload.

#### Scenario: Default selection
- **WHEN** the view opens with 3 points
- **THEN** the newest point is selected and its row count and capture time are shown

#### Scenario: Keyboard scrubbing
- **WHEN** the scrubber has focus and the user presses ArrowLeft (older)
- **THEN** the next-older point becomes selected and its summary replaces the previous one

### Requirement: Comparison point is the next-older retained point
For a selected point that is not the oldest returned point, the comparison point SHALL be the next-older returned point, labelled "vs <localized capture time>". The oldest returned point SHALL have no comparison point and show no comparison. No copy in the view SHALL contain "previous run".

#### Scenario: Label
- **WHEN** the selected point is newest and the next-older point was captured 2026-10-05T14:02Z
- **THEN** the comparison is labelled "vs" followed by that localized date/time

#### Scenario: Oldest point
- **WHEN** the oldest point is selected
- **THEN** no comparison label, overlay or changed-rows highlight is rendered

### Requirement: Rows are shown only when the selected point has a payload
When the selected point has `hasPayload: true`, the view SHALL fetch `GET /api/outputs/:id/history/:pointId/rows` and render its rows in the table renderer. When `hasPayload` is false the view SHALL show the summary only plus a muted note that rows were not stored for this run, and SHALL NOT request the payload.

#### Scenario: Payload present
- **WHEN** the selected point has `hasPayload: true`
- **THEN** its rows are rendered in a table

#### Scenario: Payload absent
- **WHEN** the selected point has `hasPayload: false`
- **THEN** no rows request is made, the summary is shown, and a note says rows were not stored for this run

### Requirement: Changed-rows highlight uses whole-row content matching and only with both payloads
When the selected point and its comparison point BOTH have payloads, the rendered rows SHALL be compared by whole-row content as a multiset: a selected-point row whose exact content (all keys and values, key order irrelevant) matches an unconsumed comparison row is unchanged; every other selected-point row SHALL be highlighted as "new or changed" (not by colour alone: a leading "Change" column, supplied through a table-renderer leading-column mechanism that never mutates rows and is excluded from sort, filter, pin, column order and persisted table state, reads "New or changed" for each highlighted row). The view SHALL state the count of comparison rows with no match ("N rows from <time> no longer present"). There SHALL be no cell-level highlight. When either point lacks a payload, no row SHALL be highlighted, no "no longer present" count SHALL be shown, and the view SHALL state that row comparison is unavailable for this pair.

#### Scenario: Added and changed rows
- **WHEN** comparison rows are {a:1},{a:2} and selected rows are {a:1},{a:3}
- **THEN** the {a:3} row is highlighted, {a:1} is not, and "1 row … no longer present" is shown

#### Scenario: Duplicates are a multiset
- **WHEN** comparison rows are {a:1} and selected rows are {a:1},{a:1}
- **THEN** exactly one of the two {a:1} rows is highlighted and zero rows are reported no longer present

#### Scenario: Missing comparison payload never reads as removal
- **WHEN** the selected point has a payload and its comparison point does not
- **THEN** the rows render unhighlighted, no "no longer present" count appears, and a note says row comparison is unavailable

### Requirement: Chart Outputs show the point's series with a labelled overlay
For a chart Output, the History view SHALL render the selected point's stored summary `series` as a chart (no payload required), with the comparison point's series as the labelled "vs" overlay defined by `chart-history-overlay`, only when the comparison point exists, its `summary.series` is non-null, it has the same `mode`, `x`, `y` and `agg` as the selected point's series, and (in `rows` mode) neither side has a repeated x value; a downsampled series on either side is permitted here (both sides come from the same server reducer cap, unlike a dashboard's 200-row primary). Otherwise no overlay series and no "vs" legend entry is rendered.

#### Scenario: Chart point
- **WHEN** a chart Output's selected point has a non-null `summary.series`
- **THEN** a chart renders from that series, plus a legend-labelled "vs <time>" overlay from the next-older point

#### Scenario: Auto-run trigger label
- **WHEN** the selected point's `triggerSource` is `auto-run`
- **THEN** the header shows "Auto-run"

#### Scenario: Highlight survives a sort
- **WHEN** both payloads are loaded and the user sorts the history table by a column
- **THEN** the same rows remain highlighted and the "Change" column is not sortable or filterable

#### Scenario: Incompatible comparison series
- **WHEN** the selected point's series has `y: "revenue"` and the comparison point's series has `y: "cost"` (or a different `agg`)
- **THEN** the History chart renders no overlay series and no "vs" legend entry
