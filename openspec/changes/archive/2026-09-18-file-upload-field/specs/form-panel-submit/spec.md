## MODIFIED Requirements

### Requirement: Submit-time client validation blocks a request the declared schema would reject

On submit, every editable configured field SHALL be validated against the form's rules and the dataset's declared
schema — a required field left empty, or a non-empty value that is not a valid value of the declared type — before
any request is sent. A `file` field is editable: it is validated as required/optional exactly like any other field
(a chosen file counts as a supplied value; none counts as empty), plus the file's extension and size are checked
against the uploads backend's configured limits before any request is sent. When any field fails, no request SHALL be
sent, every failing editable field SHALL be marked invalid with its error as its computed accessible description,
focus SHALL move to the first such control, and the failure SHALL be announced to assistive technology. A field the
form renders non-editable (a field surfaced as inconsistent with the dataset or with its own configuration) SHALL
never be sent: when it is optional and holds no value it is skipped; when it is required, or when it holds a value
that therefore cannot be sent, the submit SHALL be blocked before any request with an announced form-level summary
naming the field and why, with no control marked invalid on its account; focus follows the editable-field rule above
and remains on the submit button when no editable field failed — a held value is never silently discarded. Client
validation is a convenience; the server enforces the same rules independently.

#### Scenario: Empty required field is caught before sending
- **WHEN** the user submits with a required field empty
- **THEN** no request is sent, that control is marked invalid with the error as its description, and it receives focus

#### Scenario: Text typed into a numeric field is caught before sending
- **WHEN** a `text` control bound to an integer field holds "abc" and the user submits
- **THEN** no request is sent and the control's description says a whole number is required

#### Scenario: A select value outside the configured options is caught, never dropped
- **WHEN** a `select` control holds a value that no longer matches any configured option and the user submits
- **THEN** no request is sent and the control's description says it must be one of the configured options

#### Scenario: A required file field left empty is caught before sending
- **WHEN** a required `file` field holds no chosen file and the user submits
- **THEN** no request is sent, the control is marked invalid with the error as its description, and it receives focus

#### Scenario: An oversized or disallowed file is caught before sending
- **WHEN** the user chooses a file exceeding the configured size limit, or with a disallowed extension
- **THEN** no request is sent and the control's description states the reason

#### Scenario: A required non-editable field blocks submit with an announced summary
- **WHEN** the form has a required field the dataset no longer declares and the user submits
- **THEN** no request is sent, no control is marked invalid, the assertive region names the field and why it cannot
  be entered, and the submit button remains the focused element

#### Scenario: An optional non-editable field holding no value is skipped
- **WHEN** the form has an optional field the dataset no longer declares, it holds no value, and every editable
  field is valid
- **THEN** the request is sent without that field and the row is appended

#### Scenario: A stale value in a select whose options became unusable blocks submit, never dropped
- **WHEN** the dataset's field type changed while the panel was open so the `select`'s configured options are no
  longer valid values, the control still holds the previously chosen value, and the user submits
- **THEN** no request is sent, the assertive region names the field and says its value cannot be sent, no control is
  marked invalid, and the submit button remains the focused element

### Requirement: The server enforces the form's rules and the declared schema, writing nothing on rejection

The submit API SHALL validate the submitted values, independently of any client, against both the form's own rules
and the dataset's declared schema. For a configured non-file field, an empty or whitespace-only string SHALL be
treated as not supplied, never stored. A configured, declared field that is required — by the form's `required:
true` or by the dataset's declaration — that is missing, null, blank, or (for a `file` field) has no file attached
SHALL be rejected with reason `required`, and SHALL NOT be satisfied by the dataset's declared default. A `select`
value that is not one of the field's configured options SHALL be rejected; when the field's `options` is not a
non-empty list, any supplied value for it SHALL be rejected rather than the check skipped. A configured field the
dataset no longer declares SHALL be rejected as undeclared when a value is supplied for it or the form marks it
`required: true`; when it is optional and no value is supplied it SHALL be ignored. A `file` field's attached file
SHALL be rejected when its extension is not in the uploads backend's allowed set or its size exceeds the configured
maximum, with reason `invalid`. A key that is not one of the form's fields, a value whose type does not match the
field's declared type, an unconfigured declared-required field that has no default, and the source's row-count bound
SHALL each be rejected. Any failure SHALL reject the whole submit with `400`, SHALL persist nothing — no row written
and no file stored — and SHALL report every field-level failure as `fieldErrors: [{"field", "reason"}]` alongside a
human-readable `message`.

#### Scenario: Form-tightened requirement is enforced without the client
- **WHEN** the dataset declares `note` optional, the form marks `note` `required: true`, and a request omits `note`
- **THEN** the response is `400` with a field error for `note` with reason `required`, and the row count is unchanged

#### Scenario: Blank string does not satisfy a form-tightened requirement
- **WHEN** the form marks `note` `required: true` and a request sends `"note": "   "` directly to the API
- **THEN** the response is `400` with a field error for `note` with reason `required`, and nothing is written

#### Scenario: Option membership is enforced without the client
- **WHEN** a `select` field's options are `["a", "b"]` and a request sends `"c"`
- **THEN** the response is `400` with a field error naming the field, and the row count is unchanged

#### Scenario: Unusable options reject every value rather than skipping the check
- **WHEN** a `select` field's persisted `options` is `[]` or not a list, and a request supplies any value for it
- **THEN** the response is `400` with a field error saying its options are not configured, and nothing is written

#### Scenario: Declared type is enforced without the client
- **WHEN** a request sends the string `"5"` for an integer-typed field
- **THEN** the response is `400` with a field error whose reason states the expected type, and nothing is written

#### Scenario: Unknown field key is rejected
- **WHEN** a request's `values` contains a key that is not one of the form's fields
- **THEN** the response is `400` with a field error whose reason says it is not part of this form

#### Scenario: An undeclared configured field is reported as undeclared, not as required
- **WHEN** a form field marked `required: true` names a column the dataset no longer declares and a request omits it
- **THEN** the response is `400` with a field error whose reason says it is not declared by the bound dataset

#### Scenario: An unsupplied optional undeclared field is ignored
- **WHEN** an optional form field names a column the dataset no longer declares and a request omits it
- **THEN** the row is appended and the response is `201`

#### Scenario: A blank optional configured field takes the declared default
- **WHEN** a configured optional field with a declared default is sent as an empty string
- **THEN** the appended row holds the declared default for that field

#### Scenario: A required file field with no attached file is rejected
- **WHEN** a `file` field is required and a submit request supplies no file for it
- **THEN** the response is `400` with a field error with reason `required`, and nothing is written

#### Scenario: A disallowed file extension is rejected without writing anything
- **WHEN** a submit attaches a file whose extension the uploads backend does not allow
- **THEN** the response is `400` with a field error with reason `invalid`, no file is written to the uploads
  backend, and the row count is unchanged

#### Scenario: An oversized file is rejected without writing anything
- **WHEN** a submit attaches a file larger than the uploads backend's configured maximum size
- **THEN** the response is `400` with a field error with reason `invalid`, no file is written to the uploads
  backend, and the row count is unchanged

## ADDED Requirements

### Requirement: An accepted file is stored through the configured uploads backend and referenced as a `binary-ref` cell

A submit that includes a valid `file` field value SHALL store the file's bytes through the deployment's configured
uploads backend (`HELIO_UPLOADS_BACKEND`: `local` or `gcs`), the same storage abstraction and root/bucket
configuration every other uploaded-file feature uses. The appended row's cell for that field SHALL hold a
`binary-ref`-typed value carrying enough metadata (a storage key, MIME type, original filename, size) to resolve the
stored file later. A stored file's storage key SHALL always resolve within the configured uploads root/bucket; no
submitted filename or path SHALL be able to make it resolve outside that root.

#### Scenario: Local backend
- **WHEN** `HELIO_UPLOADS_BACKEND=local` and a submit attaches a valid file
- **THEN** the file's bytes are written under the configured local uploads root and the appended row's cell is a
  `binary-ref` value resolvable to that file

#### Scenario: GCS backend
- **WHEN** `HELIO_UPLOADS_BACKEND=gcs` and a submit attaches a valid file
- **THEN** the file's bytes are written to the configured GCS bucket and the appended row's cell is a `binary-ref`
  value resolvable to that file

#### Scenario: A path-like filename cannot escape the uploads root
- **WHEN** a submitted file's original filename contains path-traversal segments (e.g. `../../etc/passwd`)
- **THEN** the stored file's storage key still resolves within the configured uploads root, and the original
  filename is preserved only as display metadata, never as the storage key itself

### Requirement: A rejected submit stores no file

When a submit that includes a `file` field is rejected for any reason — a field error on the file itself or on any
other field — no bytes SHALL be written to the uploads backend on that field's account, and no row SHALL be
appended. This holds even when the file itself is valid but another field in the same submit fails.

#### Scenario: A valid file is not stored when a sibling field fails
- **WHEN** a submit attaches a valid file and also fails a required check on a different field
- **THEN** the response is `400`, no row is appended, and no file bytes are written to the uploads backend
