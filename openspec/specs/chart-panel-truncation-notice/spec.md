# chart-panel-truncation-notice Specification

## Purpose
Makes a dashboard chart panel say, on the chart itself, when it is drawn from fewer rows than its Output holds, so a
truncated chart is never mistaken for a complete one.

## Requirements

### Requirement: Truncated chart panels disclose their loaded scope on the chart

A chart panel SHALL display a visible text note within the panel body, adjacent to the chart, whenever the number of
rows loaded for the panel is less than the Output's total row count as reported by the rows endpoint. The note SHALL
name both the loaded row count and the total row count, with counts formatted with digit grouping. The note SHALL
read "Based on the first {loaded} of {total} rows." When a viewer control filter or a server-applied cross-filter
narrowed the total, the note SHALL read "Based on the first {loaded} of {total} matching rows." The note SHALL be
present in the DOM as text (not only as a tooltip or image), so assistive technology reads it.

#### Scenario: chart over the page size shows the note
- **WHEN** a chart panel's Output has 1234 rows and the panel loaded 200
- **THEN** the panel shows "Based on the first 200 of 1,234 rows." under the chart

#### Scenario: chart holding every row shows no note
- **WHEN** a chart panel's Output has 150 rows and the panel loaded all 150
- **THEN** no truncation note is rendered

#### Scenario: aggregated chart over the page size shows the note
- **WHEN** a chart panel's Output is aggregated (grouped client-side) and the panel loaded 200 of 1234 rows
- **THEN** the panel shows the note naming 200 and 1,234

#### Scenario: viewer filter narrows the total
- **WHEN** a viewer control filter is active and the filtered total is 640 with 200 loaded
- **THEN** the note reads "Based on the first 200 of 640 matching rows."

#### Scenario: total not yet known
- **WHEN** the panel's rows have not finished loading
- **THEN** no truncation note is rendered

### Requirement: The note appears on every chart surface, authenticated and public

The truncation note SHALL appear on every surface that renders a chart panel: the dashboard grid card, the mobile
panel stack, the fullscreen view, the panel detail modal, and public/shared dashboards. On public dashboards it SHALL
use only the row total the public panel rows endpoint already returns; no new data SHALL be exposed publicly.

#### Scenario: public dashboard chart over the page size
- **WHEN** a public dashboard's chart panel's public rows response reports total 1234 and returns 200 rows
- **THEN** the public panel shows "Based on the first 200 of 1,234 rows."

#### Scenario: fullscreen view of a truncated chart
- **WHEN** a viewer opens a truncated chart panel in fullscreen or the detail modal
- **THEN** the same note is shown there

### Requirement: The compare overlay stays hidden for truncated charts

Adding the truncation note SHALL NOT change when the "vs" compare overlay draws: a chart panel whose loaded rows are
fewer than its Output's total SHALL continue to show no overlay.

#### Scenario: truncated chart with compare configured
- **WHEN** a chart Output has `config.compare` set, 1234 rows, and the panel loaded 200
- **THEN** the truncation note is shown and no "vs" overlay is drawn
