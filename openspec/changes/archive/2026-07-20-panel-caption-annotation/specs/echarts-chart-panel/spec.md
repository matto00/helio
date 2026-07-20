## ADDED Requirements

### Requirement: Chart panel supports an optional static annotation

Chart panel config SHALL accept an optional `annotation` string. When `annotation` is a non-blank
string, the chart panel SHALL render it as a subtitle/footnote beneath the chart title area (distinct
from the chart's axis titles). When `annotation` is absent, null, empty, or whitespace-only, no
annotation element SHALL be rendered (the chart appears exactly as today). The annotation text SHALL
scale with the panel and wrap or truncate gracefully (clamped with an ellipsis) rather than overflowing
or shrinking the chart canvas out of view.

#### Scenario: Chart panel with an annotation renders a subtitle
- **WHEN** a chart panel has `config.annotation: "Source: Bureau of Labor Statistics"`
- **THEN** the panel renders the chart with a subtitle/footnote showing that text

#### Scenario: Chart panel without an annotation renders none
- **WHEN** a chart panel has no `annotation` (absent, null, empty, or whitespace-only)
- **THEN** the panel renders only the chart with no annotation element

#### Scenario: A long annotation truncates rather than overflowing
- **WHEN** a chart panel's `annotation` is longer than the panel width
- **THEN** the annotation is clamped within the panel body and does not overflow or collapse the chart

### Requirement: Chart panel annotation round-trips through the panel API

The `PATCH /api/panels/:id` endpoint SHALL accept an optional `annotation` field (string or null) on
chart panels and persist it. Absent `annotation` SHALL leave the stored value unchanged; a `null`,
empty, or whitespace-only `annotation` SHALL clear it (stored as SQL `NULL`). A chart panel response's
`config` SHALL include `annotation` when it is set and SHALL omit `annotation` when it is unset,
following the in-repo spray-json `None`-omission convention (fields are absent, not `null`; see
`collection-panel-type`). Because the panel response carries a per-subtype nested `config`, panels of
other types carry no `annotation` field at all. The annotation SHALL be carried through panel
duplication and dashboard export/import.

#### Scenario: PATCH sets an annotation on a chart panel
- **WHEN** a PATCH request is sent with `annotation: "Preliminary data"` on a chart panel
- **THEN** the response `config` includes `annotation: "Preliminary data"`

#### Scenario: PATCH without an annotation leaves it unchanged
- **WHEN** a PATCH request omits the `annotation` field on a chart panel with an existing annotation
- **THEN** the panel's existing `annotation` is preserved in the response `config`

#### Scenario: PATCH with null annotation clears it
- **WHEN** a PATCH request is sent with `annotation: null` on a chart panel that had an annotation
- **THEN** the response `config` omits `annotation`

#### Scenario: A non-chart panel config carries no annotation field
- **WHEN** a panel whose type is not `chart` is retrieved
- **THEN** its `config` contains no `annotation` field

#### Scenario: Duplicating a chart panel copies its annotation
- **WHEN** a chart panel with `annotation: "Fig. 2"` is duplicated
- **THEN** the duplicate's `annotation` is `"Fig. 2"`

### Requirement: Chart panel config editor exposes the annotation field

The Chart panel's config/display editor SHALL offer a text control for the `annotation`. Editing and
saving the annotation SHALL persist it via `PATCH /api/panels/:id`; clearing the control SHALL clear the
stored annotation.

#### Scenario: Editing the annotation in the config editor persists it
- **WHEN** a user types "Source: internal" into the Chart panel config's annotation control and saves
- **THEN** `PATCH /api/panels/:id` is called with that annotation and the panel re-renders showing the
  subtitle/footnote

#### Scenario: Clearing the annotation control clears the stored annotation
- **WHEN** a user empties the annotation control on a chart panel that had an annotation and saves
- **THEN** `PATCH /api/panels/:id` clears the annotation and the panel re-renders with no annotation
