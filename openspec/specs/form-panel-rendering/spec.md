# form-panel-rendering Specification

## Purpose
Defines how a configured `form` panel renders its fields on a dashboard: the control each field
presents, how labels, descriptions and errors are exposed to assistive technology, keyboard completability,
how the panel fits a grid cell, and how inconsistent fields are surfaced.

## Requirements

### Requirement: A configured form panel renders one control per field, in authored order

A `form` panel whose config has at least one field SHALL render, on the panel body, one input control per
field in the authored order. The control presented SHALL follow the field's `control`: `text` renders a
single-line text input; `textarea` a multi-line text input; `number` a numeric input honouring the field's
`step`; `date` a date input; `select` a chooser listing exactly the field's configured `options`, each
option labelled by its value; `checkbox` a boolean on/off control; `counter` a compact value display with
`+`/`-` step affordances honouring the field's `step` (see the dedicated counter-control and
single-counter-field-layout requirements below). The field's `placeholder` SHALL be shown in text-entry
controls. A form panel whose config has no fields SHALL keep rendering the "Form not configured" state.

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
the arrow keys and commits with Enter; the checkbox toggles with Space; a `counter` control's `+`/`-`
affordances are activatable with Enter or Space when focused, and the control's value additionally responds
to ArrowUp (increment by `step`) and ArrowDown (decrement by `step`) when it holds focus. Leaving a control
with Tab SHALL move focus to the next field, never trap it.

#### Scenario: Keyboard-only completion of all six fields
- **WHEN** a user starts before the first field and uses only Tab, typing, arrow keys, Enter and Space
- **THEN** every one of the six fields receives focus in order and ends holding the value the user entered

#### Scenario: Select is operable without a pointer
- **WHEN** the select chooser has focus and the user presses ArrowDown then Enter
- **THEN** the first option is chosen and focus returns to the chooser

#### Scenario: Counter increments via its `+` button with Enter or Space
- **WHEN** a `counter` field's `+` affordance has focus and the user presses Enter (or Space)
- **THEN** one increment activation by the configured `step` is triggered — an immediate submit in the compact
  layout, or a local-value-only update when the field is one of several in a form (see the dedicated
  counter-control requirement below for both behaviors)

#### Scenario: Counter responds to arrow keys when focused
- **WHEN** a `counter` control holds focus and the user presses ArrowUp
- **THEN** one increment activation by the configured `step` is triggered, equivalent to activating `+`

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

### Requirement: Inconsistent fields are surfaced, never dropped

A field the renderer cannot honour SHALL still render its label together with a visible, field-associated
reason and a non-editable control: a `sourceField` the dataset does not declare, a control that does not fit
the declared type, or a `select` whose `options` are not a non-empty list. Such a field SHALL NOT be omitted
from the rendered form.

#### Scenario: Orphaned field is surfaced
- **WHEN** a form field names a `sourceField` the bound dataset no longer declares
- **THEN** the field renders its label with a reason that the dataset does not declare it, as its description

### Requirement: A `file` field renders a keyboard-operable picker with a visible selected-file state

A form field with `control: "file"` SHALL render a file-picker control associated with the field's label by
computed accessible name, reachable by Tab in authored order and operable without a pointer (activatable
with Enter or Space, opening the platform file-selection UI). Before a file is chosen, the control SHALL
expose a visible and programmatically-determinable "no file selected" state. After a file is chosen, the
control SHALL expose the chosen file's name as a visible, programmatically-determinable selected-file state,
replacing the "no file chosen" state. These properties SHALL be asserted by computed accessible name and by
the control's exposed/visible state — never by DOM node presence alone.

#### Scenario: File control has a computed accessible name
- **WHEN** a `file` field has `label: "Attachment"`
- **THEN** its control's computed accessible name is "Attachment"

#### Scenario: Keyboard operates the picker
- **WHEN** the file control has focus and the user presses Enter (or Space)
- **THEN** the platform file-selection UI opens

#### Scenario: Selecting a file updates the visible state
- **WHEN** the user selects a file named `report.pdf`
- **THEN** the control's visible/exposed state shows `report.pdf` in place of "no file chosen"

#### Scenario: No file selected is the initial state
- **WHEN** a `file` field first renders with no `initialValue`
- **THEN** the control's visible/exposed state indicates no file is selected

### Requirement: A `counter`-control field renders compact `+`/`-`/value chrome with computed ARIA state

A form field with `control: "counter"` SHALL render its current value, a `-` affordance, and a `+`
affordance, keyboard-operable per the keyboard-completability requirement above. The control's computed
accessible name SHALL follow the same label/`sourceField` fallback as every other control. The control SHALL
expose its current value and its configured step to assistive technology via computed ARIA state:
`aria-valuenow` equal to the current displayed value and `aria-valuetext` or an equivalent mechanism that
communicates the step size (for example a spinbutton `role` with `aria-valuemin`/`aria-valuemax` where
applicable, or an accessible description stating the step). These properties SHALL be asserted by computed
ARIA state — never by the presence of a `+`/`-` DOM node alone. `step` defaults to `1` when unconfigured.

Activating `+` or `-` behaves differently depending on whether the counter is the panel's sole field (the
compact layout, see the dedicated requirement below) or one field among several:
- **Sole field (compact layout):** activation immediately submits a delta of `+step`/`-step` through the
  panel's existing submit path (`POST /api/panels/:id/submit`) — no new endpoint and no new `PanelKind` — and
  the control's displayed value updates optimistically by that same `±step` to reflect the click, reverting on
  a rejected submit.
- **One field among several:** activation updates only this field's local value by `±step`; nothing is
  submitted. The value is sent as `delta` only when the form's own single Submit control is activated,
  identically to how every other field's local value is sent.

#### Scenario: Value and step are exposed via computed ARIA state
- **WHEN** a `counter` field holds a current value of `5` and a configured `step` of `2`
- **THEN** the control's computed `aria-valuenow` is `5` and its computed accessible state communicates a
  step of `2`

#### Scenario: Unconfigured step defaults to 1
- **WHEN** a `counter` field has no configured `step`
- **THEN** activating `+` changes the value by `1`

#### Scenario: Compact layout — incrementing submits the configured step as a delta immediately
- **WHEN** the panel renders the compact single-counter-field layout, the field's `step` is `5`, and the user
  activates `+`
- **THEN** a submit request is sent immediately through the panel's existing submit path carrying `delta: 5`
  for that field, and the displayed value increases by `5`

#### Scenario: Compact layout — decrementing submits a negative delta immediately
- **WHEN** the panel renders the compact single-counter-field layout, the field's `step` is `5`, and the user
  activates `-`
- **THEN** a submit request is sent immediately carrying `delta: -5` for that field, and the displayed value
  decreases by `5`

#### Scenario: Compact layout — a rejected submit reverts the optimistic value change
- **WHEN** the compact layout's immediate submit is rejected by the server
- **THEN** the displayed value reverts to what it was before the activation that triggered the rejected submit

#### Scenario: Embedded in a multi-field form — activation updates local value only, nothing is submitted
- **WHEN** a form panel renders 2+ fields, one of which is `control: "counter"` with `step: 5`, and the user
  activates that field's `+`
- **THEN** the field's local value increases by `5` and no submit request is sent
- **AND** the sole way to submit the form is its existing single Submit control, unaffected by the counter
  activation

#### Scenario: Embedded field's local value is sent on the form's own submit, like any other field
- **WHEN** a form panel renders 2+ fields including a `counter` field whose local value is `10`, and the user
  activates the form's Submit control
- **THEN** the submit request carries `delta: 10` for that field, alongside every other field's values, in one
  request

### Requirement: A form panel with exactly one `counter`-control field renders compact single-field chrome

A `form` panel whose config has exactly one field, and that field's `control` is `counter`, SHALL render a
compact single-field layout: the counter's value/`+`/`-`/step chrome fills the panel body, in place of the
standard stacked-field-plus-separate-submit-button layout. This layout is a rendering choice only — it
submits through the identical panel-scoped submit API as every other form layout, and every other
field-count/shape (zero fields; exactly one field that is not `control: "counter"`; two or more fields,
including combinations where one is `control: "counter"`) SHALL continue to render via the standard
multi-field form layout, with a `counter` field inside that layout rendering via the ordinary counter
control above (not the compact chrome).

#### Scenario: Single counter field gets compact chrome
- **WHEN** a form panel's config has exactly one field with `control: "counter"`
- **THEN** the panel body renders the compact single-field chrome, not the standard stacked layout

#### Scenario: Single non-counter field keeps the standard layout
- **WHEN** a form panel's config has exactly one field with `control: "text"`
- **THEN** the panel body renders the standard single-field form layout with its own submit button, not the
  compact counter chrome

#### Scenario: Two fields including a counter keep the standard layout
- **WHEN** a form panel's config has two fields, one `control: "counter"` and one `control: "text"`
- **THEN** the panel body renders the standard multi-field layout, with the counter field rendering via the
  ordinary counter control, not the compact chrome

#### Scenario: Zero fields keep the unconfigured state
- **WHEN** a form panel's config has an empty `fields` list
- **THEN** the panel body renders "Form not configured", regardless of any prior field having been a counter

### Requirement: A full submit is completable keyboard-only across the assembled panel

An assembled form panel containing a mix of field types (including `file` and `counter` controls)
SHALL support a complete submit — filling every field and activating the submit control — using only
the keyboard, verified against a running instance of the app (never jsdom). Tab order across the
assembled panel SHALL follow authored field order, including the file field and any counter field,
with no field skipped or trapping focus.

#### Scenario: Full keyboard-only submit succeeds
- **WHEN** a user tabs through every field of an assembled form panel (including a file field and a
  counter field), enters valid values via the keyboard, and activates the submit control with Enter
  or Space
- **THEN** the submission completes successfully, verified against the running app

### Requirement: Focus is managed on submit, on success, and after a server-side rejection

Activating submit SHALL move focus predictably: while a submission is in flight, focus SHALL remain
on or return to the submit control (never lost to the document body); on success, focus SHALL move to
a location that communicates success to a keyboard/AT user; on a **server-side** rejection (not only a
client-blocked one), focus SHALL move to the first invalid/rejected field or to the error summary,
verified against the running app rather than inferred from a client-only code path.

#### Scenario: Focus moves to the first invalid field after a server-side rejection
- **WHEN** a keyboard-only submit is rejected by the server (not blocked client-side)
- **THEN** focus moves to the first field associated with the rejection, or to the error summary,
  measured against the running app

### Requirement: The panel has a computed role and accessible name inside the dashboard grid

The form panel, as placed in the dashboard grid, SHALL expose a computed role and accessible name
identifying it as a form panel to assistive technology. This SHALL be asserted via the computed
accessibility tree of a running instance — never via attribute presence alone.

#### Scenario: Panel role and name are computed, not merely present
- **WHEN** a form panel is placed in a dashboard grid
- **THEN** querying the running app's computed accessibility tree returns a role and accessible name
  for the panel, not just a DOM attribute check limited to presence

### Requirement: An asynchronously-arriving submit error is measured for live-region announcement

Whether an asynchronously-arriving submit error is actually announced to assistive technology SHALL be
measured by asserting computed live-region text change in a running browser, never inferred from a
regression test's mutation count alone. When measurement is inconclusive (e.g. no real AT available in
the harness), the ticket's evidence SHALL state this explicitly rather than asserting the announcement
succeeded.

#### Scenario: Live-region text change is measured, not inferred
- **WHEN** a submit error arrives asynchronously
- **THEN** the evidence records the computed live-region text before and after, and states explicitly
  whether real-AT announcement was verified or is unmeasurable in the harness
