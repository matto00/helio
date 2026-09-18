## Purpose

Defines how a `form` panel's input becomes one appended dataset row: the panel-scoped submit API, the server-side
enforcement of the form's own rules and of the dataset's declared schema, the error shape a client can act on, and
the panel's submit-time behaviour — its states, preserved input on rejection, and assistive-technology announcements.

## ADDED Requirements

### Requirement: A configured form panel exposes a submit affordance

A `form` panel with at least one field SHALL render one submit button, labelled with the config's `submit.label` or
"Submit" when none is configured, reachable by keyboard after the last field. Pressing Enter inside a single-line
text-entry control SHALL submit the form; Enter inside a multi-line control SHALL insert a line break and SHALL NOT
submit. While a submit is in flight the button SHALL be disabled and SHALL indicate that state, so a second activation
cannot start a second write.

#### Scenario: Default label
- **WHEN** a form panel's config has no `submit.label`
- **THEN** the submit button's accessible name is "Submit"

#### Scenario: Enter in a single-line field submits
- **WHEN** the user presses Enter inside a `text` field of a valid form
- **THEN** one submit request is sent

#### Scenario: No double submit
- **WHEN** the submit button is activated twice while the first request is still pending
- **THEN** only one request is sent

### Requirement: Submit-time client validation blocks a request the declared schema would reject

On submit, every editable configured field SHALL be validated against the form's rules and the dataset's declared
schema — a required field left empty, or a non-empty value that is not a valid value of the declared type — before
any request is sent. When any field fails, no request SHALL be sent, every failing editable field SHALL be marked
invalid with its error as its computed accessible description, focus SHALL move to the first such control, and the
failure SHALL be announced to assistive technology. A field the form renders non-editable (a `file` field, or a field
surfaced as inconsistent with the dataset or with its own configuration) SHALL never be sent: when it is optional and
holds no value it is skipped; when it is required, or when it holds a value that therefore cannot be sent, the submit
SHALL be blocked before any request with an announced form-level summary naming the field and why, with no control
marked invalid on its account; focus follows the editable-field rule above and remains on the submit button when no
editable field failed — a held value is never silently discarded. Client validation is a convenience; the server
enforces the same rules independently.

#### Scenario: Empty required field is caught before sending
- **WHEN** the user submits with a required field empty
- **THEN** no request is sent, that control is marked invalid with the error as its description, and it receives focus

#### Scenario: Text typed into a numeric field is caught before sending
- **WHEN** a `text` control bound to an integer field holds "abc" and the user submits
- **THEN** no request is sent and the control's description says a whole number is required

#### Scenario: A select value outside the configured options is caught, never dropped
- **WHEN** a `select` control holds a value that no longer matches any configured option and the user submits
- **THEN** no request is sent and the control's description says it must be one of the configured options

#### Scenario: A required non-editable field blocks submit with an announced summary
- **WHEN** the form has a required `file` field (or a required field the dataset no longer declares) and the user
  submits
- **THEN** no request is sent, no control is marked invalid, the assertive region names the field and why it cannot
  be entered, and the submit button remains the focused element

#### Scenario: An optional non-editable field holding no value is skipped
- **WHEN** the form has an optional `file` field, or an optional field the dataset no longer declares, neither holds
  a value, and every editable field is valid
- **THEN** the request is sent without those fields and the row is appended

#### Scenario: A stale value in a select whose options became unusable blocks submit, never dropped
- **WHEN** the dataset's field type changed while the panel was open so the `select`'s configured options are no
  longer valid values, the control still holds the previously chosen value, and the user submits
- **THEN** no request is sent, the assertive region names the field and says its value cannot be sent, no control is
  marked invalid, and the submit button remains the focused element

### Requirement: A submit appends exactly one row to the panel's bound source through a panel-scoped API

The system SHALL expose `POST /api/panels/:id/submit` accepting `{"values": {"<sourceField>": <value>}}` for a
`form` panel. A successful submit SHALL append exactly one row to the source the panel is bound to and SHALL respond
`201 Created` with that row's identity (`id`, `seq`, `updatedAt`). The write target SHALL be the panel's persisted
binding only: the request SHALL NOT be able to name a source, and a request body carrying any key other than
`values` SHALL be rejected with `400`. Fields the form does not configure SHALL be written as absent, so the dataset's
declared default (or declared requirement) applies.

#### Scenario: One row lands on the bound source only
- **WHEN** a valid submit is made for a panel bound to source A while source B also exists
- **THEN** source A has exactly one more row and source B is unchanged

#### Scenario: A request cannot redirect the write
- **WHEN** the request body is `{"values": {...}, "dataSourceId": "<other source>"}`
- **THEN** the response is `400` and no source is modified

#### Scenario: Unconfigured declared field takes its default
- **WHEN** the dataset declares `status` with a default and the form has no `status` field
- **THEN** the appended row holds the declared default for `status`

### Requirement: The server enforces the form's rules and the declared schema, writing nothing on rejection

The submit API SHALL validate the submitted values, independently of any client, against both the form's own rules
and the dataset's declared schema. For a configured field, an empty or whitespace-only string SHALL be treated as
not supplied, never stored. A configured, declared field that is required — by the form's `required: true` or by the
dataset's declaration — that is missing, null, or blank SHALL be rejected with reason `required`, and SHALL NOT be
satisfied by the dataset's declared default. A `select` value that is not one of the field's configured options SHALL
be rejected;
when the field's `options` is not a non-empty list, any supplied value for it SHALL be rejected rather than the check
skipped. A configured field the dataset no longer declares SHALL be rejected as undeclared when a value is supplied
for it or the form marks it `required: true`; when it is optional and no value is supplied it SHALL be ignored. A key
that is not one of the form's fields, a value for a `file` field, a value whose type does not match the field's
declared type, an unconfigured declared-required field that has no default, and the source's row-count bound SHALL
each be rejected. Any failure SHALL reject the whole submit with `400`, SHALL persist nothing, and SHALL report
every field-level failure as `fieldErrors: [{"field", "reason"}]` alongside a human-readable `message`.

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

### Requirement: Only a caller who can see the panel and owns its source may submit

`POST /api/panels/:id/submit` SHALL respond `404` when the panel is not visible to the caller, `400` when the panel is
not a `form` panel, `403` when the panel is visible but the caller is not its owner, and `404` when the owner's bound
source no longer exists, is not the caller's, or the config carries no binding. No row SHALL be written in any of
these cases.

#### Scenario: Grantee cannot write the owner's source
- **WHEN** a user who has been granted access to the dashboard but does not own the panel submits
- **THEN** the response is `403` and the source is unchanged

#### Scenario: Deleted bound source is reported as not found
- **WHEN** the owner submits to a form panel whose bound source has since been deleted
- **THEN** the response is `404` and nothing is written

#### Scenario: Non-form panel is rejected
- **WHEN** the panel id names a `text` panel
- **THEN** the response is `400`

### Requirement: A rejected submit preserves the user's input

When a submit is rejected — by client-side validation, by a `400` with field errors, by any other error response, or
by a transport failure — every field SHALL keep the value the user entered. The form SHALL NOT be reset on any
rejection.

#### Scenario: Server field error keeps values
- **WHEN** the server rejects a submit with a field error for one field
- **THEN** every control, including the rejected one, still holds the value the user entered

#### Scenario: Network failure keeps values
- **WHEN** the submit request fails without a response
- **THEN** every control still holds the value the user entered

### Requirement: Every outcome is announced to assistive technology and errors are associated with their field

The form SHALL contain live regions that exist before any submit: an assertive region for failures and a polite
region for success. A rejection SHALL set the assertive region's text to a summary of what failed (or the transport
failure) and SHALL mark each rejected rendered editable control invalid with its error as its computed accessible
description. When at least one rendered editable control is rejected, focus SHALL move to the first such control;
when none is — every error names a field the form does not render or renders non-editably, or the failure is not
field-level — focus SHALL remain on the submit button and the summary SHALL name each such field. A success SHALL
set the polite region's text. Regions SHALL be emptied when the next attempt starts. These properties SHALL be
asserted by the regions' computed roles, their
text after the outcome, the control's computed ARIA state, and the focused element — never by the presence of an
alert node.

#### Scenario: Asynchronous server rejection is announced and associated
- **WHEN** the server rejects a submit with a field error for `quantity`
- **THEN** the assertive region's text names the failure, the `quantity` control is marked invalid with the error as
  its description, and it is the focused element

#### Scenario: Rejection of an unrendered field keeps focus on the submit button
- **WHEN** the only field error names a declared-required column the form does not render
- **THEN** the assertive region's text names that column, no control is marked invalid, and the submit button is the
  focused element

#### Scenario: Transport failure is announced
- **WHEN** the submit request fails without a response
- **THEN** the assertive region's text says the submit could not be completed and invites a retry

#### Scenario: Success is announced
- **WHEN** a submit succeeds
- **THEN** the polite region's text says the row was added and focus remains on the submit button

### Requirement: A successful submit resets the form unless configured not to

After a `201` response the form SHALL return every field to its initial state (prefill or empty) unless
`submit.resetOnSuccess` is `false`, in which case the entered values SHALL remain.

#### Scenario: Default resets
- **WHEN** `submit.resetOnSuccess` is absent and a submit succeeds
- **THEN** every field is back to its initial value

#### Scenario: Opt-out keeps values
- **WHEN** `submit.resetOnSuccess` is `false` and a submit succeeds
- **THEN** every field still holds the submitted value

### Requirement: A transport or non-field failure is surfaced as a retryable error state

When the submit request fails without a response, or the response is an error without field errors, the form SHALL
show the response's message when one is present and a generic could-not-submit message otherwise, in the assertive
region, and SHALL leave the submit button enabled so the user can retry.

#### Scenario: Row-count bound is surfaced
- **WHEN** the server rejects because the source is at its row-count bound
- **THEN** the assertive region shows the server's message and the submit button is enabled
