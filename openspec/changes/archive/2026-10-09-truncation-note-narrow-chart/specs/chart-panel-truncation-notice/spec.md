## MODIFIED Requirements

### Requirement: Truncated chart panels disclose their loaded scope on the chart

A chart panel SHALL display a visible text note within the panel body, adjacent to the chart, whenever the number of
rows loaded for the panel is less than the Output's total row count as reported by the rows endpoint. The note SHALL
name both the loaded row count and the total row count, with counts formatted with digit grouping. The note SHALL
read "Based on the first {loaded} of {total} rows." When a viewer control filter or a server-applied cross-filter
narrowed the total, the note SHALL read "Based on the first {loaded} of {total} matching rows." The note SHALL be
present in the DOM as text (not only as a tooltip or image), so assistive technology reads it.

When the chart panel is narrow, the visible note SHALL instead read the short form "{loaded} of {total} rows." (or
"{loaded} of {total} matching rows." when narrowed). The full sentence SHALL remain in the DOM as text available to
assistive technology and SHALL remain the note's tooltip.

#### Scenario: chart over the page size shows the note
- **WHEN** a chart panel's Output has 1234 rows and the panel loaded 200
- **THEN** the panel shows "Based on the first 200 of 1,234 rows." under the chart

#### Scenario: chart holding every row shows no note
- **WHEN** a chart panel's Output has 150 rows and the panel loaded all 150
- **THEN** no truncation note is rendered

#### Scenario: aggregated chart over the page size shows the note
- **WHEN** a chart Output is aggregated (grouped client-side) and the panel loaded 200 of 1234 rows
- **THEN** the panel shows the note naming 200 and 1,234

#### Scenario: viewer filter narrows the total
- **WHEN** a viewer control filter is active and the filtered total is 640 with 200 loaded
- **THEN** the note reads "Based on the first 200 of 640 matching rows."

#### Scenario: total not yet known
- **WHEN** the panel's rows have not finished loading
- **THEN** no truncation note is rendered

#### Scenario: narrow chart shows the short form
- **WHEN** a truncated chart panel (200 of 1234 rows) is rendered at the grid's narrowest width (w=2)
- **THEN** the visible note reads "200 of 1,234 rows." and the full sentence "Based on the first 200 of 1,234 rows." is still present in the DOM for assistive technology and as the tooltip

## ADDED Requirements

### Requirement: Footnotes never collapse a narrow chart

A chart panel at the grid's narrowest width (w=2) and minimum height (h=4) that shows both an annotation and the
truncation note and has NO viewer-control bar SHALL keep its chart canvas at least 96px tall, in both light and dark
themes. The footnotes (one-line clamp, short note form) and, on a chart card carrying a footnote only, the card title (two-line
clamp) and footer (one line) SHALL give up space before the chart canvas does. Other panel kinds, and a chart with no
footnote, keep their normal title and footer at this size.

#### Scenario: narrow minimum-height chart with annotation and truncation note, no control bar
- **WHEN** a truncated chart panel with an annotation and no viewer-control bar is placed at w=2, h=4 on the desktop grid
- **THEN** the rendered chart canvas is at least 96px tall, both footnotes remain visible, and nothing overlaps the header or footer

#### Scenario: the same chart with a viewer-control bar stays contained
- **WHEN** the same panel also carries a viewer-control bar
- **THEN** the canvas and both footnotes stay inside the card body with no overlap of the header, the control bar or the footer, and the canvas receives the remaining space (measured 33px; no 96px minimum is promised in this configuration)

#### Scenario: other cards keep their chrome
- **WHEN** a table panel, or a chart panel with no annotation and no truncation note, is placed at w=2, h=4
- **THEN** its title is not line-clamped
