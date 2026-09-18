## MODIFIED Requirements

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

## ADDED Requirements

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
