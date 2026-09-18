## Purpose

Defines how a configured `form` panel renders its non-file fields on a dashboard: the control each field
presents, how labels, descriptions and errors are exposed to assistive technology, keyboard completability,
how the panel fits a grid cell, and how inconsistent or not-yet-supported fields are surfaced.

## ADDED Requirements

### Requirement: A configured form panel renders one control per field, in authored order

A `form` panel whose config has at least one field SHALL render, on the panel body, one input control per
field in the authored order. The control presented SHALL follow the field's `control`: `text` renders a
single-line text input; `textarea` a multi-line text input; `number` a numeric input honouring the field's
`step`; `date` a date input; `select` a chooser listing exactly the field's configured `options`, each
option labelled by its value; `checkbox` a boolean on/off control. The field's `placeholder` SHALL be shown
in text-entry controls. A form panel whose config has no fields SHALL keep rendering the "Form not
configured" state.

#### Scenario: Six controls render in order
- **WHEN** a form panel's config lists fields with controls `text`, `textarea`, `number`, `date`, `select`,
  `checkbox` in that order
- **THEN** the panel body renders six controls of those kinds in that order

#### Scenario: Select lists the configured options
- **WHEN** a `select` field's `options` are `[1, 2, 3]` on an integer field
- **THEN** the chooser offers exactly three options labelled `1`, `2`, `3` and nothing else

#### Scenario: Empty field list keeps the unconfigured state
- **WHEN** a form panel's config has an empty `fields` list
- **THEN** the panel body renders "Form not configured" and no controls

### Requirement: Every field has a computed accessible name and, when help text is configured, description

Every rendered control SHALL have a computed accessible name equal to the field's `label`, or its
`sourceField` when no label is configured. When a field has `helpText`, the control's computed accessible
description SHALL equal that help text while no error is shown. These properties SHALL be asserted by
computed accessible name and description — never by the presence of a label or text node in the DOM.

#### Scenario: Label gives the accessible name
- **WHEN** a field has `label: "Quantity"`
- **THEN** its control's computed accessible name is "Quantity"

#### Scenario: Source field is the fallback name
- **WHEN** a field has no `label` and `sourceField: "note"`
- **THEN** its control's computed accessible name is "note"

#### Scenario: Help text is the accessible description
- **WHEN** a field has `helpText: "Whole units only"` and no error
- **THEN** its control's computed accessible description is "Whole units only"

### Requirement: Every field is reachable and completable by keyboard alone

Every rendered control SHALL be reachable in authored order with Tab and completable without a pointer:
text, textarea, number and date accept typed input; the select chooser opens and moves between options with
the arrow keys and commits with Enter; the checkbox toggles with Space. Leaving a control with Tab SHALL move
focus to the next field, never trap it.

#### Scenario: Keyboard-only completion of all six fields
- **WHEN** a user starts before the first field and uses only Tab, typing, arrow keys, Enter and Space
- **THEN** every one of the six fields receives focus in order and ends holding the value the user entered

#### Scenario: Select is operable without a pointer
- **WHEN** the select chooser has focus and the user presses ArrowDown then Enter
- **THEN** the first option is chosen and focus returns to the chooser

### Requirement: Required-ness is derived from the config or the dataset declaration

A field SHALL be presented as required when the config sets `required: true` OR the bound dataset declares
the field required, and as optional otherwise. Presentation as required SHALL be exposed to assistive
technology on the control itself.

#### Scenario: Dataset-declared requirement is honoured without a config flag
- **WHEN** the dataset declares `quantity` as required and the form field for `quantity` has no `required`
- **THEN** the `quantity` control is exposed as required

#### Scenario: Config can tighten but the renderer never loosens
- **WHEN** the dataset declares `note` optional and the form field sets `required: true`
- **THEN** the `note` control is exposed as required

### Requirement: Field-level errors are associated with their field by computed ARIA state

When a field is left with a value that fails a field-level rule — a required field left empty, or a
`number` control holding a value that is not a valid value of the declared type (a non-integer for an
integer field, a non-number for either numeric type) — the renderer SHALL show an error message naming the
field, mark the control invalid, and make the error text the control's computed accessible description. No
error SHALL be shown for a field the user has not yet left. Correcting the value SHALL clear the error and
restore the help text as the description. Association SHALL be asserted by computed ARIA state, never by
the presence of an alert node.

#### Scenario: Required field left empty
- **WHEN** a required `number` field is focused and left empty
- **THEN** the control is marked invalid and its computed accessible description is the error naming the field

#### Scenario: Non-integer in an integer field
- **WHEN** a `number` field on an integer-typed dataset field is left holding `1.5`
- **THEN** the control is marked invalid and its description says a whole number is required

#### Scenario: No error before interaction
- **WHEN** a form panel with a required, empty field first renders
- **THEN** no control is marked invalid and no error message is shown

#### Scenario: Correcting clears the error
- **WHEN** an invalid field is corrected and left again
- **THEN** the control is no longer marked invalid and its description is its help text, if any

### Requirement: A field is prefilled from its initial value

A field with an `initialValue` SHALL start holding that value; a field without one SHALL start empty
(unchecked for `checkbox`, no option chosen for `select`). Prefill never changes what a dataset stores for an
omitted field.

#### Scenario: Prefilled number
- **WHEN** a `number` field has `initialValue: 5`
- **THEN** its control initially holds `5`

### Requirement: The renderer loads the declared schema and surfaces its loading and failure states

Rendering requires the bound dataset's declared schema. While it loads, the panel body SHALL show a loading
state; if it cannot be loaded, the panel body SHALL show an inline error with a retry action rather than
rendering fields from the config alone.

#### Scenario: Schema fails to load
- **WHEN** the declared schema request fails
- **THEN** the panel body shows an error with a retry action and no field controls

### Requirement: Inconsistent or not-yet-supported fields are surfaced, never dropped

A field the renderer cannot honour SHALL still render its label together with a visible, field-associated
reason and a non-editable control: a `sourceField` the dataset does not declare, a control that does not fit
the declared type, a `select` whose `options` are not a non-empty list, or a `file` control (not yet
supported). Such a field SHALL NOT be omitted from the rendered form.

#### Scenario: Orphaned field is surfaced
- **WHEN** a form field names a `sourceField` the bound dataset no longer declares
- **THEN** the field renders its label with a reason that the dataset does not declare it, as its description

#### Scenario: File control is surfaced as not yet supported
- **WHEN** a form field has `control: "file"`
- **THEN** the field renders its label with a note that file upload is not yet available

### Requirement: A form panel is sized for a grid cell

The form body SHALL fit the panel card: fields stack in one column, the body scrolls vertically inside the
card when the fields exceed its height rather than overflowing it, and density tightens in a short card.
An auto-layout re-flow SHALL clamp a `form` panel to a minimum of 3 columns wide and 5 rows tall.

#### Scenario: Overflowing fields scroll inside the card
- **WHEN** a form panel's fields are taller than its card
- **THEN** the body scrolls within the card and the card's own bounds are unchanged

#### Scenario: Auto-layout clamps an undersized form
- **WHEN** an auto-layout request includes a `form` panel with `w: 1, h: 2`
- **THEN** the packed item is at least `w: 3, h: 5`

### Requirement: No submit affordance is rendered yet

Until the submit path ships, the form SHALL render no submit control, and pressing Enter inside a text field
SHALL NOT navigate, reload, or submit anything.

#### Scenario: Enter in a text field is inert
- **WHEN** the user presses Enter inside a `text` field
- **THEN** the page does not navigate and no request is sent
