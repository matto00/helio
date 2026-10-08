# pipeline-output-sheet Specification

## Purpose
Defines the Output side-sheet editor: kind/name/field-mapping driven by capabilities-at-node,
per-kind options, live preview, placements, and delete/aggregate-insertion actions.

## Requirements

### Requirement: Field-mapping slots come from capabilities-at-node
The sheet SHALL derive its available field-mapping slots from `GET /api/pipelines/:id/capabilities?stepId=`
for the Output's node step, not from a client-side static list.

#### Scenario: Slots reflect the node's projected schema
- **WHEN** the sheet opens for an Output on a step whose capabilities list fields A and B only
- **THEN** the mapping slots offer only A and B as selectable fields

### Requirement: Live preview reflects current unsaved config
The sheet SHALL fetch preview rows whenever the in-progress config changes, debounced, and apply
that in-progress config **client-side** over the returned rows before rendering (neither preview
endpoint applies Output config server-side). For a previously-saved Output, rows come from `POST
/api/pipelines/:id/preview?outputId=`. For an Output that has not yet been saved (no `outputId`
exists yet — `previewOutputs` requires a persisted Output and 404s otherwise), rows come from the
existing single-step preview endpoint, `GET /api/pipelines/:id/steps/:stepId/preview`, against the
Output's chosen node step.

#### Scenario: Preview updates after changing chart type (saved Output)
- **WHEN** a user changes the chart type in the sheet for a previously-saved Output
- **THEN** the sheet fetches rows from `POST /api/pipelines/:id/preview?outputId=`, applies the new
  chart type client-side, and the live preview re-renders without requiring a save

#### Scenario: New, not-yet-saved Output previews via the step endpoint
- **WHEN** a user is composing a brand-new Output in the sheet that has never been saved
- **THEN** the sheet fetches rows from `GET /api/pipelines/:id/steps/:stepId/preview` for the
  chosen node step, applies the in-progress config client-side, and renders a live preview

### Requirement: Per-kind option sets
The sheet SHALL show kind-specific option groups: chart type/axes/legend for `chart`; collection
layout for `collection`; timeline sort for `timeline`; table columns/density for `table`; a
literal markdown Content editor for `markdown` (no row binding — see "Markdown Output Content is
literal-only"); a number `format` for `metric`.

#### Scenario: Switching kind swaps the option group
- **WHEN** a user changes an Output's kind from `chart` to `table`
- **THEN** the sheet replaces the chart option group with the table column/density option group

### Requirement: Aggregate-requiring kinds offer tail insertion
If the sheet's kind requires an aggregate the current node does not provide, it SHALL offer
"add as tail with an aggregate step", which inserts a real `aggregate` pipeline step and attaches
the Output to it as a render-only Output.

#### Scenario: Metric kind on a non-aggregated node
- **WHEN** a user selects `metric` kind on a node with no aggregation upstream
- **THEN** the sheet offers "add as tail with an aggregate step"; confirming creates the step then the Output

### Requirement: Placements list and delete warning
The sheet SHALL list every dashboard placement (panel) of the Output with a link to each, and
SHALL warn with the placement count before deleting an Output that has placements.

#### Scenario: Delete with placements
- **WHEN** a user attempts to delete an Output placed on 3 dashboards
- **THEN** the sheet shows a warning naming the count before confirming deletion

### Requirement: Markdown Output Content is literal-only
The Output sheet SHALL offer a markdown Output's Content only as a literal multiline editor. It SHALL NOT offer a field/column-bound mode for Content, and SHALL NOT persist `fieldMapping.content` for a markdown Output.

#### Scenario: No bound mode is offered
- **WHEN** the user selects the Markdown kind in the Output sheet
- **THEN** the Content slot shows only a literal text editor, with no field/literal mode toggle and no column picker

#### Scenario: Saved config carries no mapping
- **WHEN** the user saves a markdown Output with literal content
- **THEN** the persisted config has `content` equal to the literal text and an empty `fieldMapping`

#### Scenario: Legacy mapping is not resurrected
- **WHEN** the sheet opens a markdown Output whose stored config contains `fieldMapping.content`
- **THEN** it opens in literal mode and the next save writes an empty `fieldMapping`

### Requirement: Slotless kinds reject fieldMapping with an explicit message
The Output create/update API SHALL reject a non-empty `fieldMapping` on a kind with no slots (`table`, `markdown`) with 400, and the message SHALL state that the kind has no fieldMapping slots.

#### Scenario: Agent sends a markdown content mapping
- **WHEN** a create or update supplies `fieldMapping: {content: "col"}` for a markdown Output
- **THEN** the response is 400 and the message says markdown has no fieldMapping slots
