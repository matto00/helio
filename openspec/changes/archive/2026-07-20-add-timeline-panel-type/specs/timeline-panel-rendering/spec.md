## ADDED Requirements

### Requirement: Timeline renders bound rows as a vertical chronological event list

A timeline panel SHALL render the rows of its bound DataType snapshot as a vertical, ordered list of
events. Each entry SHALL show a time/order value (from the `time`-mapped field) and a description
(from the `event`-mapped field), accompanied by a marker and a connector line joining consecutive
entries so the result reads as a timeline — visually distinct from a line/bar chart. Entries SHALL be
ordered by the `time` field according to the config `sort` direction (`"asc"` chronological by
default, `"desc"` reverse-chronological).

#### Scenario: Bound rows render as ordered entries

- **WHEN** a timeline panel is bound to a DataType whose rows expose a time field and an event field
- **THEN** the panel renders one entry per row, each showing the time value and the event text
- **AND** entries appear in ascending time order by default, with a marker and connector per entry

#### Scenario: Reverse-chronological sort

- **WHEN** the timeline config sets `sort: "desc"`
- **THEN** the rendered entries appear in descending time order

### Requirement: Timeline field mapping is configurable in the panel config editor

The timeline panel config editor SHALL let the user map the bound DataType's columns to the `time`
and `event` slots, and SHALL let the user choose the chronological `sort` direction. Changing the
mapping SHALL re-render the timeline from the newly mapped columns.

#### Scenario: Mapping the time and event fields

- **WHEN** the user opens a timeline panel's config editor and selects a column for the `time` slot
  and a column for the `event` slot
- **THEN** the timeline renders using those columns for the time value and event description

#### Scenario: Sort direction is configurable

- **WHEN** the user toggles the sort direction in the config editor
- **THEN** the rendered entry order reflects the chosen direction and the choice persists on save

### Requirement: Timeline rendering scales with panel size and degrades gracefully

Timeline rendering SHALL scale proportionally with the panel's dimensions (consistent with the other
v1.5 panel types) and SHALL degrade gracefully at the data edges: an empty snapshot SHALL show an
empty-state message rather than a broken layout; a single row SHALL render as one entry without a
dangling connector; and a long description SHALL wrap or truncate within the entry without overflowing
the panel.

#### Scenario: Empty data shows an empty state

- **WHEN** a timeline panel is bound but its snapshot has zero rows
- **THEN** the panel shows an empty-state message rather than an empty or broken timeline

#### Scenario: Single row renders cleanly

- **WHEN** the bound snapshot has exactly one row
- **THEN** the panel renders a single entry without a trailing connector to a non-existent next entry

#### Scenario: Long description stays within the panel

- **WHEN** an event description is long relative to the panel width
- **THEN** the text wraps or truncates within the entry and does not overflow the panel bounds

#### Scenario: Rendering scales with panel dimensions

- **WHEN** the panel is resized larger or smaller
- **THEN** the timeline's spacing and text scale proportionally, consistent with other v1.5 panels
