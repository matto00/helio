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
- **WHEN** a user creating a new Output changes its kind from `chart` to `table`
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

### Requirement: Edit-mode Save preserves untouched stored config and sends explicit clears

When saving an existing Output, the Output editor sheet SHALL send in `config` only the top-level keys whose value the user changed in the sheet relative to the state it opened with, and SHALL omit `config` entirely when nothing changed. Every stored config key the user did not change SHALL be omitted from the request, so that the server's shallow config merge preserves it byte-for-byte. A field the user cleared SHALL be sent as an explicit `null` rather than omitted. A chart or metric `fieldMapping`, whenever sent, SHALL NOT contain an `annotation`, `label` or `unit` slot that the editor's current state does not bind to a field, and a save of an Output whose stored `fieldMapping` contains such a stale slot SHALL send the repaired `fieldMapping`. Creating a new Output SHALL continue to send the full config for its kind, including defaults.

#### Scenario: Collection layout is not overwritten
- **WHEN** a collection Output stored with `layout: "list"` is opened in the editor and saved after changing only its format
- **THEN** the PATCH request's `config` does not contain `layout`, and the stored `layout` remains `"list"`

#### Scenario: Timeline sort is not overwritten
- **WHEN** a timeline Output stored with `sort: "desc"` is opened and saved after changing only its field mapping
- **THEN** the PATCH request's `config` does not contain `sort`, and the stored `sort` remains `"desc"`

#### Scenario: Untouched save sends no config
- **WHEN** any existing, non-damaged Output (no stale `fieldMapping` slot, see below) is opened and saved without changing any config control (for a table, whether Save is clicked before or after the node's columns have loaded)
- **THEN** the PATCH request carries no `config`, and every stored config key is unchanged afterwards

#### Scenario: Metric label and unit literal cleared by switching to a field binding
- **WHEN** a metric Output stored with literal `label` and `unit` has both switched to field mode, bound to fields, and is saved
- **THEN** the PATCH request sends `label: null` and `unit: null` with the bindings in `fieldMapping`, and the stored literals no longer render

#### Scenario: Table column order reset to natural
- **WHEN** a table Output stored with a `columnOrder` has every column made visible in natural order and is saved
- **THEN** the PATCH request sends `columnOrder: null`, and the table renders the same as an Output with no stored `columnOrder`

#### Scenario: Hidden columns stay hidden
- **WHEN** a table Output stored with `columnOrder: ["b","a"]` over fields `a,b,c` has `a` moved above `b` and is saved
- **THEN** the PATCH request sends `columnOrder: ["a","b"]` (not `null`), and column `c` stays hidden

#### Scenario: Removed chart annotation field does not survive
- **WHEN** a chart Output stored with `fieldMapping.annotation` has its annotation binding removed or switched to a literal and is saved
- **THEN** the PATCH request's `fieldMapping` contains no `annotation` key, and every other stored `fieldMapping` key is unchanged

#### Scenario: Already-damaged fieldMapping is repaired on save
- **WHEN** a chart Output stored with a literal `annotation` and a stale `fieldMapping.annotation` (or a metric with a literal `label` and a stale `fieldMapping.label`) is opened and saved without other changes
- **THEN** the PATCH request sends `fieldMapping` without the stale slot and no other config key, except that for a metric the paired `aggregation` is sent with it so the metric stays bound

#### Scenario: Aggregated metric stays bound
- **WHEN** a metric Output stored as `{fieldMapping:{value:"amt"}, aggregation:{agg:"sum"}}` is opened and saved untouched, or saved after binding only its label to a field
- **THEN** an untouched save sends no `config`; the label-only edit sends `fieldMapping` (still containing `value: "amt"`) together with `aggregation`, and the stored metric remains bound to `amt` with `sum`

#### Scenario: Create still writes defaults
- **WHEN** a new collection or timeline Output is created from the sheet
- **THEN** the create request's `config` includes `layout: "grid"` (collection) or `sort: "asc"` (timeline) as today

### Requirement: An existing Output's kind is fixed in the editor
When the Output editor sheet is opened for an existing Output, the Kind control SHALL be disabled, SHALL show the
Output's stored kind, and SHALL show a short visible reason that the kind cannot be changed after creation. The reason
SHALL be exposed to assistive technology as the Kind control's accessible description, and the disabled control SHALL
NOT be reachable by keyboard focus or open its option list. A Save from the edit sheet SHALL never send a different
kind's configuration. When the sheet is opened to create a new Output, the Kind control SHALL be enabled and SHALL show
no such reason.

#### Scenario: Edit mode shows Kind disabled with a reason
- **WHEN** a user opens the editor for an existing `chart` Output
- **THEN** the Kind control shows "Chart", is disabled, and its accessible description is the cannot-be-changed reason

#### Scenario: Disabled Kind cannot be changed
- **WHEN** a user clicks the disabled Kind control in edit mode or tabs through the sheet
- **THEN** no option list opens, focus skips the control, and the kind-specific option group stays the stored kind's

#### Scenario: Create mode is unchanged
- **WHEN** a user opens the editor to create a new Output
- **THEN** the Kind control is enabled, has no cannot-be-changed reason, and selecting another kind swaps the option group
