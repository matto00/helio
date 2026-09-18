## REMOVED Requirements

### Requirement: Inconsistent or not-yet-supported fields are surfaced, never dropped

**Reason**: `file` controls now render a real, fully-supported picker (see the new "A `file` field renders a
keyboard-operable picker..." requirement below) and are no longer part of the not-yet-supported set. Retiring
this combined requirement and re-adding a narrower one (below) avoids landing a confusing no-op scenario in
the archived spec.
**Migration**: The surviving orphaned-`sourceField` case is re-added below under "Inconsistent fields are
surfaced, never dropped". No client behavior changes for that case.

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

## ADDED Requirements

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
