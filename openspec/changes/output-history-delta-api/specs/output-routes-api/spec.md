## ADDED Requirements

### Requirement: Output config writes validate config.compare
Every write that persists an Output's `config` (Output create, Output update after its partial merge, single-call
pipeline creation, the grounding of a pipeline proposal's Outputs, and the patch-set preview of an Output update) SHALL accept `config.compare` only when it is absent,
`null`, or one of the strings `previous_run`, `1d`, `7d`, `30d`, or `custom:<d>`, where `<d>` is an ISO-8601 duration
in days, hours, minutes and seconds (`PnDTnHnMnS`) that is positive and at most 365 days. Any other value, including
a non-string, a week/month/year duration or a different letter case, SHALL be rejected with 400, and nothing SHALL be
persisted. Proposal grounding, which reports per-Output problems rather than failing the request, SHALL report an
invalid `compare` as that Output's `validationError`.

#### Scenario: Valid compare values are accepted
- **WHEN** an Output is created or updated with `compare` set to `previous_run`, `7d` or `custom:PT6H`
- **THEN** the write succeeds and the stored config carries that value

#### Scenario: Invalid compare is rejected
- **WHEN** an Output is created, updated, previewed in a patch set, or created in a single-call pipeline create with `compare` set to `2d`, `7D`, `custom:P1W`, `custom:-PT1H`,
  `custom:P400D`, `custom:P`, `custom:PT`, an overflowing duration or the number 7
- **THEN** the response is 400 and the stored config is unchanged

#### Scenario: Invalid compare in a pipeline proposal
- **WHEN** a pipeline proposal names an Output whose `compare` is invalid
- **THEN** that Output's grounding result carries a `validationError` naming `compare`

#### Scenario: Clearing compare
- **WHEN** an Output update sets `compare` to `null`
- **THEN** the write succeeds and the Output has no comparison
