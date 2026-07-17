# collection-config-editor Specification

## Purpose
Defines the detail-modal editor for collection panels: base-type extension point, DataType binding, shared field-mapping slots with bound-or-literal label/unit, layout control, and mobile touch-target sizing.
## Requirements
### Requirement: Detail modal presents a collection editor
The panel detail modal SHALL present a collection-specific editor for `collection` panels composing:
a base-type control (offering `metric` today, rendered as a visible extension point — present but
constrained to the single valid option), the DataType binding picker, shared field-mapping slots
derived from the active base type, and a layout control offering `grid` and `list`. For the
`metric` base type, the `value` slot SHALL be bind-only while `label` and `unit` SHALL use the
bound-or-literal pattern (`BoundOrLiteralField` family, HEL-243): bound selections persist to
`fieldMapping`, literal entries persist to `itemOptions.metric`.

#### Scenario: Collection editor sections are shown
- **WHEN** the detail modal opens for a collection panel in edit mode
- **THEN** the editor shows base type, DataType binding, field-mapping slots, and a grid/list
  layout control

#### Scenario: Label slot accepts bound or literal
- **WHEN** the user switches the label slot to literal mode and types a value, then saves
- **THEN** the persisted config carries the literal under `itemOptions.metric.label` and no
  `fieldMapping.label` binding

### Requirement: Saving the collection editor issues one config PATCH
Saving SHALL issue a single config PATCH carrying only the touched concerns, following the
absent-vs-null convention (absent = unchanged, `null` = clear, value = set) so an untouched concern
is never clobbered.

#### Scenario: Layout change patches only layout
- **WHEN** the user changes only the layout from grid to list and saves
- **THEN** the PATCH config contains `layout` and does not carry unrelated cleared fields

### Requirement: Collection editor controls meet mobile touch-target size
Every interactive control the collection editor adds to the detail modal SHALL, at viewport
widths ≤ 768px, have a hit target of at least 44px height, following the existing
`@media (max-width: 768px)` pattern in `PanelDetailModal.css`, and the CSS-lock test SHALL cover
the new rules.

#### Scenario: Touch targets at mobile width
- **WHEN** the detail modal renders a collection panel's editor at 390px viewport width
- **THEN** the layout control, base-type control, and field-mapping inputs each present a ≥44px
  hit target

