## ADDED Requirements

### Requirement: A `counter`-control field's submit request carries only a signed delta

A `form` field configured with the `counter` control SHALL accept only a numeric `delta` in the submit request's
`values` map for that field's `sourceField` — no raw `value`, `occurred_at`, or running-total is ever accepted from
the client for that field. `delta` SHALL be required and non-zero-checked-only-for-type (zero is a legal delta —
e.g. a no-op click is still an event). Any other shape supplied for a `counter` field SHALL be rejected with a
structured `fieldError` before any row is built, exactly like any other field-level validation failure in this
capability (`FormSubmission.buildRow`).

#### Scenario: A valid delta is accepted
- **WHEN** a `counter` field's configured `sourceField` receives `{"delta": 1}` (or an equivalent numeric literal)
- **THEN** the field passes submit validation and the row-build proceeds

#### Scenario: A non-numeric delta is rejected
- **WHEN** a `counter` field's value is a non-numeric JSON value
- **THEN** no request/row is built and a `fieldError` names the field and states a number is required

#### Scenario: A client-supplied `occurred_at` is ignored, never trusted
- **WHEN** a submit request includes an `occurred_at`-shaped value for a `counter` field
- **THEN** the server-assigned `occurred_at` is used regardless, and the client-supplied value has no effect on
  storage or ordering
