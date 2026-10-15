# timeline-panel-rendering Specification

## Purpose
Defines how an `output` panel bound to a timeline-kind Output renders its rows as a vertical, chronological event list (marker/connector/time/description per entry), the `time` + `event` field mapping and `sort` direction, height-tiered scaling, and graceful degradation for empty / single-row / long-description data.

## Requirements

### Requirement: Timeline renders bound rows as a vertical chronological event list

An `output` panel bound to a timeline-kind Output SHALL render the Output's loaded rows as a vertical, ordered list of
events. Each entry SHALL show a time/order value (from the `time`-mapped column) and a description (from the
`event`-mapped column), accompanied by a marker and a connector line joining consecutive entries so the result reads
as a timeline — visually distinct from a line/bar chart. Entries SHALL be ordered by comparing the `time` values
(numerically when both parse as finite numbers, otherwise as plain strings) according to the Output's `config.sort`
(`"asc"` chronological by default; `"desc"` reverse-chronological; any other stored value is read as `"asc"`).

#### Scenario: Bound rows render as ordered entries

- **WHEN** a timeline Output has a `time` column and an `event` column mapped
- **THEN** the panel renders one entry per loaded row, each showing the time value and the event text
- **AND** entries appear in ascending time order by default, with a marker and connector per entry

#### Scenario: Reverse-chronological sort

- **WHEN** the timeline Output's `config.sort` is `"desc"`
- **THEN** the rendered entries appear in descending time order

### Requirement: Timeline rendering scales with panel size and degrades gracefully

Timeline rendering SHALL tighten its spacing and text when the panel card is compact (container height under 180px) and
loosen them when it is spacious (container height of at least 280px), and SHALL degrade gracefully at the data edges: a
timeline given no rows SHALL show a "No data" state rather than a broken layout (a fetch that returns no rows shows the
panel-level "No data available" or "Not run yet" state instead); a single row SHALL render as one entry without a
dangling connector; and a long description SHALL wrap within the entry without overflowing the panel.

#### Scenario: Empty data shows an empty state

- **WHEN** a timeline Output is bound but its fetch returns zero rows
- **THEN** the panel shows an empty-state message rather than an empty or broken timeline

#### Scenario: Single row renders cleanly

- **WHEN** the bound snapshot has exactly one row
- **THEN** the panel renders a single entry without a trailing connector to a non-existent next entry

#### Scenario: Long description stays within the panel

- **WHEN** an event description is long relative to the panel width
- **THEN** the text wraps within the entry and does not overflow the panel bounds

#### Scenario: Rendering scales with panel dimensions

- **WHEN** the panel card is resized under 180px or to at least 280px container height
- **THEN** the timeline's entry spacing and text size step down (compact) or up (spacious) respectively

### Requirement: The Output editor sheet maps the timeline time and event fields
For a `timeline` Output the Output editor sheet SHALL present a Time field select and an Event field select and no
sort-direction control. Creating a timeline Output SHALL write `sort: "asc"`. Edit-mode Save SHALL send only the changed
config keys, so a stored `sort` survives an edit. `sort` is set through the Output's `config` (for example `update_output`).

#### Scenario: Mapping the time and event fields
- **WHEN** the user opens the Output editor sheet for a timeline Output and selects a column for Time and a column for Event
- **THEN** the saved Output's `fieldMapping` maps `time` and `event` to those columns and the timeline renders using them

#### Scenario: A new timeline Output is created ascending
- **WHEN** the user chooses kind Timeline in a new Output and saves
- **THEN** the create request's `config.sort` is `"asc"`

#### Scenario: Editing the mapping keeps a stored sort
- **WHEN** the user opens a timeline Output stored with `sort: "desc"`, changes only the Event field, and saves
- **THEN** the PATCH `config` is `{ fieldMapping: { ... } }` and the stored `sort` remains `"desc"`
