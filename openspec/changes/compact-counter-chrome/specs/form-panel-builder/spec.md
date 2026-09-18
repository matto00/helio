## MODIFIED Requirements

### Requirement: A form that does not match the bound dataset's schema is surfaced at author time

The builder SHALL check the form's fields against the bound dataset's live declared schema when the sheet opens,
when the bound dataset is switched, and on every field edit, and SHALL surface each mismatch as an error
associated with the offending field: a field naming an undeclared dataset field, a control that does not fit the
declared type, a `select` whose options are missing, empty, or not valid values of the declared type, an initial
value that is not a valid value of the declared type, a `step` on a control that is neither `number` nor
`counter`, and a duplicate field. While any such error exists the builder SHALL NOT save, and SHALL say why.
Fixing every error SHALL re-enable saving. If the write API rejects the save (for example because the dataset's
schema changed after it was read), the rejection SHALL be shown inline and the schema re-read; the user's edits
SHALL be preserved.

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
value, `step` (shown for the `number` control and the `counter` control), and options (shown only for the
`select` control, one typed value per option). Required SHALL be tighten-only: a field the dataset declares
required SHALL be shown as required and not un-checkable, and its config SHALL omit `required` rather than write
`false`; a field the dataset does not declare required SHALL persist `required: true` when checked and no
`required` key when unchecked. Changing a field's control SHALL visibly drop an attribute the new control does not
accept rather than persist it. Saving SHALL persist the whole form config; discarding SHALL restore the last saved
state.

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

#### Scenario: Step is authorable for a counter field
- **WHEN** the user sets a field's control to `counter` and enters a step of `5`
- **THEN** the step input is shown, and the saved config carries `step: 5` for that field

#### Scenario: Options are authored as typed values
- **WHEN** the user sets a `select` control on an integer field and enters options
- **THEN** each option is entered through a numeric input and the saved config's options are integers

#### Scenario: Discard restores the saved state
- **WHEN** the user edits fields and then discards
- **THEN** the builder shows the last saved fields and the sheet reports no unsaved changes

#### Scenario: A single-counter-field form is saved with `resetOnSuccess` forced off
- **WHEN** the user saves a form whose only field is `control: "counter"`
- **THEN** the saved config carries `submit.resetOnSuccess: false`, regardless of any other setting, so the
  compact layout's counter value is never wiped by the form's own submit-reset behavior
