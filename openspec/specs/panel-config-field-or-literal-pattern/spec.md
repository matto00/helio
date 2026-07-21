# panel-config-field-or-literal-pattern Specification

## Purpose
Defines the reusable "bind to a DataType field, or use fixed text" config-slot pattern (the `BoundOrLiteralField` control and its mode-default heuristic) established by the Metric panel config redesign, so HEL-244 (Text), HEL-245 (Markdown), and HEL-247 (Collections) can mirror it for their own field-or-literal slots.
## Requirements
### Requirement: Field-or-literal config slots expose a bind-to-field/fixed-text toggle
Any panel config slot whose value can be either a DataType field binding or literal text SHALL expose a mode toggle (bind-to-field vs fixed-text) alongside a single input that switches between a field-select dropdown and a text field depending on the selected mode.

#### Scenario: Metric Label control toggles between bind-to-field and fixed text
- **WHEN** the user opens the Metric panel's Label control
- **THEN** a bind-to-field/fixed-text toggle is shown; selecting "Bind to field" shows a DataType
  field dropdown, and selecting "Fixed text" shows a text input

#### Scenario: Metric Unit control toggles between bind-to-field and fixed text
- **WHEN** the user opens the Metric panel's Unit control
- **THEN** a bind-to-field/fixed-text toggle is shown; selecting "Bind to field" shows a DataType
  field dropdown, and selecting "Fixed text" shows a text input

#### Scenario: Mode defaults to fixed text when a literal value is already configured
- **WHEN** a Metric panel has `config.label` set (a literal override) and the Label control is opened
- **THEN** the toggle defaults to "Fixed text" with the current literal value shown

#### Scenario: Mode defaults to bind-to-field when no literal is set
- **WHEN** a Metric panel has no `config.label` set but has `fieldMapping.label` bound to a column,
  and the Label control is opened
- **THEN** the toggle defaults to "Bind to field" with the bound column selected

### Requirement: Literal label/unit are editable after panel creation
The Metric panel's edit-mode Data section SHALL allow setting, changing, and clearing the literal `label`/`unit` override (previously settable only at creation time, HEL-293) via the field-or-literal Label/Unit controls, persisted through `PATCH /api/panels/:id`.

#### Scenario: Setting a literal label after creation
- **WHEN** the user opens an existing Metric panel with no literal label, switches the Label control
  to "Fixed text", types "Revenue", and saves
- **THEN** `PATCH /api/panels/:id` is called with `config.label = "Revenue"` and the panel re-renders
  with "Revenue" as its label

#### Scenario: Clearing a literal label after creation
- **WHEN** the user opens an existing Metric panel with `config.label = "Revenue"`, switches the
  Label control to "Bind to field", and saves
- **THEN** `PATCH /api/panels/:id` is called with `config.label = null`

### Requirement: The field-or-literal pattern is documented as reusable for follow-on config-redesign tickets
The `BoundOrLiteralField` component and its interaction model (mode toggle + single switched input, mode defaults from existing config state) SHALL be documented as the control pattern for HEL-244 (Text), HEL-245 (Markdown), and HEL-247 (Collections) config redesigns, each of which will have at least one slot that is either a DataType field binding or literal content once that panel type's DataType-binding infrastructure exists.

#### Scenario: Design doc documents the reusable contract
- **WHEN** a follow-on ticket (e.g. HEL-244) needing a field-or-literal slot begins design
- **THEN** the pattern's location (`frontend/src/features/panels/ui/editors/BoundOrLiteralField.tsx`),
  props contract, and mode-default heuristic are looked up from this capability's spec and this
  change's design.md rather than re-derived from scratch

#### Scenario: Design doc documents the binding-infrastructure prerequisite for Text/Markdown
- **WHEN** HEL-244 or HEL-245 begins design and consults this capability's spec
- **THEN** it finds an explicit note that `TextPanelConfig`/`MarkdownPanelConfig` currently have no
  `dataTypeId`/`fieldMapping` — that panel type's own DataType-binding infrastructure must be added
  before its `content` slot can be wired to `BoundOrLiteralField`

### Requirement: Field-or-literal control supports a multiline literal input

`BoundOrLiteralField` SHALL accept an optional `literalMultiline` prop; when `true`, the literal-mode
input SHALL be a multiline textarea instead of a single-line text field. Omitting the prop SHALL preserve
today's single-line behavior for existing callers (Metric's Label/Unit controls).

#### Scenario: Text's Content control uses a multiline literal input
- **WHEN** the Text panel's Content control is rendered with `literalMultiline: true` and mode is "Fixed
  text"
- **THEN** a multiline textarea is shown for the literal value instead of a single-line text field

#### Scenario: Metric's Label/Unit controls are unaffected
- **WHEN** Metric's Label or Unit control is rendered (no `literalMultiline` prop passed)
- **THEN** the literal-mode input remains a single-line text field, unchanged from today

### Requirement: Text is the pattern's first non-Metric consumer

The Text panel's Content control SHALL directly consume this capability's reusable contract
(`BoundOrLiteralField` + `useBoundOrLiteralState`), without re-deriving the mode-toggle interaction model
or the mode-default heuristic.

#### Scenario: Text's Content control reuses the mode-default heuristic
- **WHEN** a Text panel with an existing literal `config.content` (and no `fieldMapping.content`) opens
  its Content control
- **THEN** the mode toggle defaults to "Fixed text" (Static), matching `defaultBoundOrLiteralMode`'s
  existing literal-is-set heuristic

### Requirement: Chart Annotation is a consumer of the field-or-literal pattern

The Chart panel's Annotation control SHALL consume this capability's reusable contract
(`BoundOrLiteralField` + `useBoundOrLiteralState` + `defaultBoundOrLiteralMode`) without re-deriving the
mode-toggle interaction model or the mode-default heuristic. The literal value SHALL persist to
`config.annotation` and the bound value to `fieldMapping.annotation`, matching the pattern's
"literal in a dedicated config field, binding in `fieldMapping.<slot>`" convention. Because charts already
carry `dataTypeId`/`fieldMapping`, the Chart Annotation slot needs no new binding infrastructure — unlike
the Text/Markdown/Image prerequisites documented elsewhere in this capability.

#### Scenario: Chart Annotation reuses the mode-default heuristic

- **WHEN** a chart panel with an existing literal `config.annotation` (and no `fieldMapping.annotation`)
  opens its Annotation control
- **THEN** the mode toggle defaults to "Fixed text", matching `defaultBoundOrLiteralMode`'s literal-is-set
  heuristic

#### Scenario: Chart Annotation defaults to bind-to-field when only a binding is set

- **WHEN** a chart panel with `fieldMapping.annotation` set and no literal `config.annotation` opens its
  Annotation control
- **THEN** the mode toggle defaults to "Bind to field" with the bound column selected

