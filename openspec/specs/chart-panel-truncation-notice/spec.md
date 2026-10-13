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

### Requirement: Footnotes never collapse a narrow chart

A chart panel at the grid's minimum height (h=4) on the desktop grid, at ANY width, that shows one or more footnotes
(the annotation, the truncation note, and the histogram skipped-values or time-axis omitted-rows note) SHALL give up
footnote and chrome space before its chart canvas does, in both light and dark themes, at 1440px and 1900px viewports:

- every footnote SHALL be clamped to one line with no extra vertical padding; its full text stays available as a
  tooltip and to assistive technology;
- at the narrowest width (w=2) only, the truncation note uses its short form, and the card title is clamped to two lines
  and the footer stays on one line (HEL-1398) -- on a card carrying a footnote, and equally on a chart-output card
  carrying a viewer-control bar even when it shows no footnote;
- when the card is a chart-output card (known from the Output's kind, never from rendered data, so the layout is the
  same while the chart loads, errors, is empty or shows footnotes) carrying a viewer-control bar with exactly ONE
  control and that control is a text or dropdown control, its label SHALL sit beside its input on one row, show its full
  text, and stay put when a filter empties the result; a lone numeric-range or date-range control, a bar with two or
  more controls, and any non-chart panel keep labels above inputs and SHALL be no taller than they are today;
- at the narrowest width (w=2) only, when the card also carries a viewer-control bar, the annotation footnote SHALL be
  visually hidden (it remains in the accessibility tree and is shown unchanged on the fullscreen and detail views);
  the truncation, skipped-values and time-axis notes stay visible at every width.

The rendered chart canvas SHALL then be at least: 96px with no control bar and at most two footnotes; 84px with no
control bar and three footnotes; 60px with a one-control (text or dropdown) bar and at most two footnotes; 48px with such
a bar and three footnotes. Nothing SHALL overlap the header, the control bar or the footer. Taller cards (h>=5), other panel
kinds, a chart with neither a footnote nor a viewer-control bar, and the mobile stack (HEL-1438) keep their current
layout. A chart-output card with a one-control text or dropdown bar lays the bar out inline whether or not it shows
footnotes.

#### Scenario: narrow minimum-height chart with annotation and truncation note, no control bar
- **WHEN** a truncated chart panel with an annotation and no viewer-control bar is placed at w=2, h=4 on the desktop grid
- **THEN** the rendered chart canvas is at least 96px tall, both footnotes remain visible, and nothing overlaps the header or footer

#### Scenario: wide minimum-height chart with footnotes
- **WHEN** a truncated chart panel with an annotation, and optionally a third footnote, is placed at w=4 or w=6, h=4
- **THEN** each footnote renders on one line, and the canvas is at least 96px tall with two footnotes and at least 84px with three

#### Scenario: the same chart with a viewer-control bar stays contained
- **WHEN** a truncated chart panel with an annotation and a viewer-control bar holding one dropdown (or one text) control is placed at w=2, w=4 or w=6, h=4
- **THEN** the control's label sits beside its input on one row, the truncation note is visible, at w=2 the annotation is not visible but is still exposed to assistive technology (at w=4/w=6 it stays visible on one line), and the canvas is at least 60px tall (48px when a third footnote is present), with nothing overlapping

#### Scenario: a multi-control bar is never taller than today
- **WHEN** the same panel carries a viewer-control bar with two controls, or a single numeric-range control, at w=2 or w=4, h=4
- **THEN** each label stays above its input and the bar is no taller than the same bar on unchanged main

#### Scenario: other cards keep their chrome
- **WHEN** a table panel, or a chart panel with no annotation, no truncation note and no control bar, is placed at w=2, h=4
- **THEN** its title is not line-clamped; a table panel with a one-control bar keeps its label above its input, while a footnote-less chart with a one-control bar lays the label beside its input like a footnoted one

#### Scenario: a filter that empties the result does not move the control being typed into
- **WHEN** a viewer types into the one text control of a chart panel at w=2, h=4 until the result is empty and the footnotes unmount
- **THEN** the input's position and size are unchanged

#### Scenario: taller chart cards are unchanged
- **WHEN** a footnoted chart panel with a viewer-control bar is placed at h=5 or taller
- **THEN** its annotation is visible, its footnotes keep the two-line clamp and its control labels sit above their inputs
