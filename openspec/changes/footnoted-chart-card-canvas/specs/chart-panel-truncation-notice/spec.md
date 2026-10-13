## MODIFIED Requirements

### Requirement: Footnotes never collapse a narrow chart

A chart panel at the grid's minimum height (h=4) on the desktop grid, at ANY width, that shows one or more footnotes
(the annotation, the truncation note, and the histogram skipped-values or time-axis omitted-rows note) SHALL give up
footnote and chrome space before its chart canvas does, in both light and dark themes, at 1440px and 1900px viewports:

- every footnote SHALL be clamped to one line with no extra vertical padding; its full text stays available as a
  tooltip and to assistive technology;
- at the narrowest width (w=2) only, the truncation note uses its short form, the card title is clamped to two lines
  and the footer stays on one line (unchanged from HEL-1398);
- when the card also carries a viewer-control bar with exactly ONE control and that control is a text or dropdown
  control, its label SHALL sit beside its input on one row; a lone numeric-range or date-range control, and a bar with
  two or more controls, keep labels above inputs and SHALL be no taller than they are today;
- at the narrowest width (w=2) only, when the card also carries a viewer-control bar, the annotation footnote SHALL be
  visually hidden (it remains in the accessibility tree and is shown unchanged on the fullscreen and detail views);
  the truncation, skipped-values and time-axis notes stay visible at every width.

The rendered chart canvas SHALL then be at least: 96px with no control bar and at most two footnotes; 84px with no
control bar and three footnotes; 60px with a one-control (text or dropdown) bar and at most two footnotes; 48px with such
a bar and three footnotes. Nothing SHALL overlap the header, the control bar or the footer. Taller cards (h>=5), other panel
kinds, a chart with no footnote, and the mobile stack (HEL-1438) keep their current layout.

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
- **WHEN** a table panel, or a chart panel with no annotation and no truncation note, is placed at w=2, h=4
- **THEN** its title is not line-clamped, and a chart with no footnote keeps its control labels above their inputs

#### Scenario: taller chart cards are unchanged
- **WHEN** a footnoted chart panel with a viewer-control bar is placed at h=5 or taller
- **THEN** its annotation is visible, its footnotes keep the two-line clamp and its control labels sit above their inputs
