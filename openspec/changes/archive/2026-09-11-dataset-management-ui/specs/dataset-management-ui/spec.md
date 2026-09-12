## Purpose

Lets a user create a dataset (dataset-kind data source) and declare/edit its field schema
entirely from Sources, without a dashboard, with schema edits on non-empty datasets previewed and
confirmed safely rather than failing at write time later.

## ADDED Requirements

### Requirement: Create a dataset from Sources
The system SHALL provide a "Dataset" creation path from the Sources add-source flow that lets the
user name the dataset and declare its initial field schema (name, canonical type, required,
default) before creating it, calling the existing dataset-kind `POST /api/data-sources` route.

#### Scenario: Create a dataset with declared fields
- **WHEN** the user opens the dataset creation flow, enters a name, adds one or more fields each
  with a name and a canonical type, and submits
- **THEN** a new dataset-kind data source is created with exactly that declared schema, the source
  list is refreshed, and the new source becomes selected (matching every other source type's
  create behavior — no automatic navigation to a detail view occurs for any source type today,
  and this change does not add one)

#### Scenario: Canonical types only
- **WHEN** the user selects a field's type
- **THEN** only the canonical types (`string`, `integer`, `float`, `boolean`, `timestamp`,
  `string-body`, `binary-ref`) are offered — never a non-canonical alias such as `double`

### Requirement: Field declaration editor supports reorder and remove before create
The system SHALL let the user reorder and remove declared fields in the create flow before
submitting, with no request sent until the user confirms creation.

#### Scenario: Reorder fields before create
- **WHEN** the user has declared multiple fields and reorders them
- **THEN** the field list reflects the new order, and creating the dataset submits fields in that
  order

#### Scenario: Remove a field before create
- **WHEN** the user removes a declared field before submitting
- **THEN** that field is absent from the created dataset's schema

### Requirement: Schema edits knowable client-side are predicted and blocked/confirmed before any request is sent
The system SHALL, for the two rejection cases fully determined by data the UI already holds (the
dataset's own row count — see `dataset-management-ui` design.md Decision 3), predict the outcome
and either block submission or require explicit confirmation BEFORE `PATCH
/api/data-sources/:id/schema` is ever called — never merely react to the API's error after a
failed submit for these two cases.

#### Scenario: Add optional field
- **WHEN** the user adds a field with `required: false` and no default to an existing dataset
- **THEN** this is shown as an allowed, no-confirmation change and is submittable immediately

#### Scenario: Add required field with no default, non-empty dataset
- **WHEN** the user adds a `required: true` field with no default to a dataset with at least one
  existing row
- **THEN** the submit control is disabled with an inline reason, before any request is sent, until
  the user supplies a default

#### Scenario: Drop a field, dataset has existing rows
- **WHEN** the user removes a field from the declaration and the dataset has at least one existing
  row (regardless of whether that specific field's values are all null)
- **THEN** the system requires an explicit, clearly-labelled confirmation control (never a silent
  default) naming the field and the row count, before the request is sent with `confirmDrop: true`

#### Scenario: Drop a field, dataset has zero rows
- **WHEN** the user removes a field from the declaration and the dataset has zero existing rows
- **THEN** no confirmation is shown and the request is sent without a `confirmDrop` field

### Requirement: Schema edits requiring server-side validation surface the result inline, in the same editor, without losing the in-progress edit
The system SHALL, for the two rejection cases that cannot be determined client-side (a retype's
per-value compatibility, and tightening a kept field to `required` when null coverage is unknown
without fetching every page of rows), submit the edit and render the API's response inline in the
same schema-edit editor — a `200` applies the change; a `409`
(`SchemaUpdateConflictResponse`) keeps the editor open, pre-filled with the user's in-progress
edit, and shows each `rejectedFields[].reason` next to its field; a structural `400` (not
`SchemaUpdateConflictResponse`-shaped) shows a single non-field-specific inline error banner in
the same editor. This satisfies "make it visible rather than failing at write time later" because
the failure surfaces in the schema-edit flow itself, before the user ever leaves it to write a row.

#### Scenario: Retype with incompatible existing values
- **WHEN** the user changes a field's type, submits, and the dataset has at least one existing row
  whose value is incompatible with the new type
- **THEN** the API call returns `409`, the editor stays open with the user's edit intact, and the
  incompatible-row count from `rejectedFields` is shown next to that field

#### Scenario: Retype with every existing value compatible
- **WHEN** the user changes a field's type, submits, and every existing row's value for that field
  already satisfies the new type
- **THEN** the API call returns `200`, the editor closes, and the user is told the row count that
  was migrated (`rowsMigrated`)

#### Scenario: Tighten a kept field to required without full null coverage
- **WHEN** the user changes a kept field's `required` to `true` with no default, submits, and some
  existing rows are null/absent for it
- **THEN** the API call returns `409`, the editor stays open, and the rejection reason is shown
  next to that field, prompting the user to supply a default and resubmit

#### Scenario: Rename target collides with a field being dropped (structural 400)
- **WHEN** the user renames a field to a name that is also the name of a field being dropped in
  the same edit
- **THEN** the API call returns `400` (not a `SchemaUpdateConflictResponse`), and the editor shows
  a single non-field-specific inline error banner describing the collision, with the in-progress
  edit intact

### Requirement: A rejected multi-field edit applies nothing
The system SHALL never present a schema-edit request that the API rejected (`409` or `400`) as
partially applied. When any field's edit is rejected, the UI treats the ENTIRE edit as not applied,
matching the backend's all-or-nothing evaluation.

#### Scenario: One rejected field blocks the whole edit
- **WHEN** a single schema-edit submission both adds an allowed optional field and retypes a
  different field to a type incompatible with an existing row's value (the drop-without-
  confirmation case cannot occur through this UI — Decision 3a blocks it before submission)
- **THEN** the response is `409`, and the UI does not show the optional field as added — the
  entire declaration remains unchanged until the rejection is resolved and the edit resubmitted

### Requirement: Rename and reorder on an existing dataset need no client-side prediction or confirmation
The system SHALL allow renaming a declared field and reordering fields on a dataset with existing
rows, submitting directly with no client-side prediction step and no confirmation dialog — neither
can be rejected for a data-loss or type-compatibility reason. Either can still fail structurally
with a `400` (e.g. a rename target colliding with a field being dropped in the same request); that
failure is handled by the structural-`400` requirement above (non-field-specific inline error
banner), not by a prediction step.

#### Scenario: Rename a field on a non-empty dataset
- **WHEN** the user renames a declared field, with no other change, and submits
- **THEN** the request is sent directly (no preview/confirmation step), the API returns `200` with
  `rowsMigrated: 0`, and the user is told the rename succeeded with no rows affected

#### Scenario: Reorder fields on a non-empty dataset
- **WHEN** the user reorders fields on an existing dataset, with no other change, and submits
- **THEN** the request is sent directly, the API returns `200` with `rowsMigrated` equal to the
  row count, and the user is told existing rows were rewritten to the new column order

### Requirement: Whole flow is keyboard-operable with computed accessible names
The system SHALL make every control in the dataset create and schema-edit flows operable via
keyboard alone (tab/arrow/enter/escape as appropriate for each control type), and every such
control SHALL expose a computed accessibility name.

#### Scenario: Keyboard-only dataset creation
- **WHEN** a user completes the entire create-dataset flow (name, add fields, set types/required/
  default, reorder, remove, submit) using only the keyboard
- **THEN** the dataset is created exactly as if performed with a mouse

#### Scenario: Keyboard-only schema edit
- **WHEN** a user completes a schema edit, including a confirmed field drop, using only the
  keyboard
- **THEN** the edit is applied exactly as if performed with a mouse

#### Scenario: Every new control has a computed accessible name
- **WHEN** any control introduced by this change is inspected via the accessibility tree
- **THEN** it has a non-empty computed accessible name (verified by
  `e2e/focus-presence-guard.spec.ts`, HEL-520)

#### Scenario: Focus survives a reorder that disables the moved control
- **WHEN** the user moves a field to a position where its own "Move up" or "Move down" button
  becomes disabled (e.g. moving the top field further up)
- **THEN** focus lands on that field row's name input (never on the now-disabled button), and a
  live region announces the field's new position

#### Scenario: Focus survives a field removal
- **WHEN** the user removes a field from the declaration
- **THEN** focus lands on a real, enabled control (the next remaining field's name input, or the
  "Add field" control if none remain), and a live region announces the removal
