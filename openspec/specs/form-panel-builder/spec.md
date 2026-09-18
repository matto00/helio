# form-panel-builder Specification

## Purpose
Defines the authoring surface for a `form` panel: how a form panel is created from a dashboard, how its fields are
built against the bound dataset's declared schema, what mismatches are surfaced at author time, and the keyboard
and screen-reader behaviour of every control the builder introduces.

## Requirements

### Requirement: A form panel is created from the add-panel picker by binding a dataset

The add-panel picker SHALL offer a Form entry alongside the content-panel kinds. Activating it SHALL NOT create a
panel immediately; it SHALL present the user's `dataset`-kind sources to choose from, with the same search and
keyboard behaviour as the picker's Output list, and a way back to the main list. Choosing a dataset SHALL create a
`form` panel bound to that dataset with no fields and an `append` submit, titled after the dataset. When the user
has no `dataset`-kind source, the step SHALL show an empty state with a call to action to create one.

#### Scenario: Form entry is offered
- **WHEN** the add-panel picker opens in place mode
- **THEN** a Form entry is shown with the content-panel kinds

#### Scenario: Choosing a dataset creates a bound form panel
- **WHEN** the user activates Form and then chooses a dataset
- **THEN** a `form` panel bound to that dataset, with an empty field list and `append` submit, is created on the
  dashboard and the picker closes

#### Scenario: No datasets to bind
- **WHEN** the user activates Form and owns no `dataset`-kind source
- **THEN** an empty state explains that a dataset is needed and offers a way to create one

#### Scenario: Dataset step is keyboard-operable
- **WHEN** the user reaches the dataset step by keyboard
- **THEN** arrow keys move between datasets, Enter chooses the focused one, and a Back control returns to the
  main list — all without a pointer

### Requirement: The builder offers the bound dataset's declared fields and fitting controls

The panel sheet for a `form` panel SHALL render a field builder as its kind-specific section. The builder SHALL
show which dataset the form is bound to and SHALL allow switching it to another `dataset`-kind source. For each
form field the builder SHALL offer the bound dataset's declared fields by name — showing each field's declared
type and whether the dataset declares it required — rather than a free-text name, and SHALL offer only the
presentation controls that fit the chosen field's declared type, with the type's default control first. A declared
field already used by another form field SHALL NOT be offered again.

#### Scenario: Declared fields are offered, not typed
- **WHEN** the user adds a field to a form bound to a dataset declaring `quantity` (integer) and `note` (string)
- **THEN** the field chooser lists exactly `quantity` and `note`, each with its declared type, and there is no
  free-text field-name input

#### Scenario: Only fitting controls are offered
- **WHEN** the user chooses the declared field `quantity` (integer)
- **THEN** the control chooser offers `number` first, then `select` and `text`, and does not offer `checkbox`,
  `date`, `textarea`, or `file`

#### Scenario: A used field is not offered twice
- **WHEN** `quantity` is already a form field and the user adds another field
- **THEN** `quantity` is not offered in the new field's chooser

#### Scenario: Switching the bound dataset re-offers that dataset's fields
- **WHEN** the user switches the bound dataset to one declaring different fields
- **THEN** the field choosers offer the new dataset's declared fields, and existing fields are kept for the
  mismatch check below rather than dropped

### Requirement: A form that does not match the bound dataset's schema is surfaced at author time

The builder SHALL check the form's fields against the bound dataset's live declared schema when the sheet opens,
when the bound dataset is switched, and on every field edit, and SHALL surface each mismatch as an error
associated with the offending field: a field naming an undeclared dataset field, a control that does not fit the
declared type, a `select` whose options are missing, empty, or not valid values of the declared type, an initial
value that is not a valid value of the declared type, a `step` on a non-number control, and a duplicate field.
While any such error exists the builder SHALL NOT save, and SHALL say why. Fixing every error SHALL re-enable
saving. If the write API rejects the save (for example because the dataset's schema changed after it was read),
the rejection SHALL be shown inline and the schema re-read; the user's edits SHALL be preserved.

#### Scenario: Orphaned field surfaced on open
- **WHEN** the sheet opens for a form whose field `legacy` is not declared by the bound dataset
- **THEN** that field shows an error naming `legacy` as undeclared with a Remove affordance, and Save is
  disabled with the reason stated

#### Scenario: Dataset switch surfaces the mismatch immediately
- **WHEN** the user switches the bound dataset to one that does not declare an existing field
- **THEN** that field's error appears without saving, and Save stays disabled until the field is removed or
  re-mapped

#### Scenario: Unfit stored control is surfaced
- **WHEN** the sheet opens for a form whose stored field uses `checkbox` on a `string` field
- **THEN** that field shows an error naming the mismatch and the fitting controls

#### Scenario: Wrongly typed option or initial value is surfaced
- **WHEN** a `select` on an integer field carries a stored option that is not an integer, or an initial value
  that is not an integer
- **THEN** the field shows an error naming the offending value, and Save is disabled

#### Scenario: Fixing every error re-enables saving
- **WHEN** the user removes or re-maps every field that had an error
- **THEN** no error remains and Save is enabled

#### Scenario: Server rejection is shown inline and edits are kept
- **WHEN** the write API rejects the save with a 400
- **THEN** the message is shown inline next to Save, the declared schema is re-read, and no edit is lost

### Requirement: The builder authors fields, their order, and their attributes

The builder SHALL let the user add a field, remove a field, and move a field up or down; the authored order SHALL
be the persisted order. Per field it SHALL let the user set label, placeholder, help text, required, initial
value, `step` (shown only for the `number` control), and options (shown only for the `select` control, one typed
value per option). Required SHALL be tighten-only: a field the dataset declares required SHALL be shown as
required and not un-checkable, and its config SHALL omit `required` rather than write `false`; a field the
dataset does not declare required SHALL persist `required: true` when checked and no `required` key when
unchecked. Changing a field's control SHALL visibly drop an attribute the new control does not accept rather than
persist it. Saving SHALL persist the whole form config; discarding SHALL restore the last saved state.

#### Scenario: Reorder persists
- **WHEN** the user moves the second of three fields up and saves
- **THEN** the persisted field order is the moved order, and reopening the sheet shows that order

#### Scenario: Dataset-required field cannot be loosened
- **WHEN** the bound dataset declares `quantity` required
- **THEN** the field's Required control is checked and disabled with a hint naming the dataset, and the saved
  config carries no `required` key for that field

#### Scenario: Form-level requirement is added
- **WHEN** the dataset does not declare `note` required and the user checks Required on it and saves
- **THEN** the saved config carries `required: true` for `note`

#### Scenario: Step is only authorable for a number control
- **WHEN** the user changes a field's control from `number` (with a `step`) to `text`
- **THEN** the step input disappears, a hint says the step was cleared, and the saved config carries no `step`

#### Scenario: Options are authored as typed values
- **WHEN** the user sets a `select` control on an integer field and enters options
- **THEN** each option is entered through a numeric input and the saved config's options are integers

#### Scenario: Discard restores the saved state
- **WHEN** the user edits fields and then discards
- **THEN** the builder shows the last saved fields and the sheet reports no unsaved changes

### Requirement: The builder is keyboard-operable and screen-reader-labelled

Every builder control SHALL be reachable and operable by keyboard alone, including reordering. Every control SHALL
have an accessible name that identifies the field it belongs to. Every error SHALL be associated with its control
and announced, not only shown. After adding a field, focus SHALL move into the new field; after removing one,
focus SHALL move to the next field or, when none remains, to the Add control.

#### Scenario: Reorder by keyboard
- **WHEN** the user tabs to a field's Move down control and presses Enter
- **THEN** the field moves down and focus stays on a Move control for that same field

#### Scenario: Controls carry field-specific accessible names
- **WHEN** an assistive technology reads the builder for a field labelled `Quantity`
- **THEN** its Remove, Move up, Move down, control chooser, and attribute inputs each expose a computed
  accessible name that includes `Quantity`

#### Scenario: Errors are associated and announced
- **WHEN** a field's error appears
- **THEN** the field's control is marked invalid and described by the error text, and the error is announced

#### Scenario: Focus after add and remove
- **WHEN** the user activates Add
- **THEN** focus lands on the new field's field chooser
- **WHEN** the user removes the last remaining field
- **THEN** focus lands on the Add control
