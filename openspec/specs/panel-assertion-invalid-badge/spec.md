# panel-assertion-invalid-badge Specification

## Purpose
Show an informational badge on any panel bound to a DataType whose latest run had an error-severity
assertion failure, so stale or invalid data is visible at a glance without opening Run History.
## Requirements
### Requirement: A per-DataType assertion-status read reports whether the latest run had an error-severity failure
The system SHALL expose `GET /api/types/:id/assertion-status`, returning `{ dataTypeId, invalid,
failedRuleCount }`, where `invalid` is `true` when the pipeline whose `output_data_type_id` matches the
given DataType has a latest NON-DRY run (regardless of terminal status) with at least one persisted
error-severity failed assertion — a dry run SHALL NEVER be considered for this determination, since a
dry run never writes the DataType's actual persisted data. Access SHALL be gated by the same DataType
ownership/sharing check `GET /api/types/:id/rows` already uses.

#### Scenario: A DataType whose latest run had an error-severity failure reports invalid
- **WHEN** `GET /api/types/:id/assertion-status` is called for a DataType whose owning pipeline's latest
  run has a persisted error-severity failed assertion
- **THEN** the response reports `invalid: true` with `failedRuleCount` equal to the number of such
  failures

#### Scenario: A DataType whose latest run passed all assertions reports valid
- **WHEN** `GET /api/types/:id/assertion-status` is called for a DataType whose owning pipeline's latest
  run has no error-severity failed assertions (including a run with only warn-severity failures, or none
  at all)
- **THEN** the response reports `invalid: false`

#### Scenario: A DataType with no runs yet reports valid
- **WHEN** `GET /api/types/:id/assertion-status` is called for a DataType whose owning pipeline has never
  completed a run
- **THEN** the response reports `invalid: false`, `failedRuleCount: 0`

#### Scenario: A dry run with a failing error-severity assertion does not affect the status
- **WHEN** a pipeline's latest real run passed all assertions, and a subsequent dry run of the same
  pipeline has a failing error-severity assertion
- **THEN** `GET /api/types/:id/assertion-status` still reports `invalid: false` — the dry run is never
  considered, since it never wrote the DataType's actual persisted data

#### Scenario: Caller without access to the DataType is denied
- **WHEN** `GET /api/types/:id/assertion-status` is called by a user who does not own and has no shared
  access to the DataType
- **THEN** the response matches `GET /api/types/:id/rows`'s existing denial behavior for the same caller

### Requirement: A panel bound to an invalid DataType shows an informational badge
A panel whose bound DataType (via the panel's `dataTypeId`) reports `invalid: true` SHALL show an
informational "invalid data" badge on its panel card, using the DESIGN.md `--app-error` intent token. The
badge SHALL be purely informational — it SHALL NOT block any panel interaction.

#### Scenario: Panel bound to an invalid DataType shows the badge
- **WHEN** a panel is bound to a DataType whose assertion-status read reports `invalid: true`
- **THEN** the panel's card shows the invalid-data badge

#### Scenario: Panel bound to a valid DataType shows no badge
- **WHEN** a panel is bound to a DataType whose assertion-status read reports `invalid: false`
- **THEN** the panel's card shows no invalid-data badge

#### Scenario: Multiple panels bound to the same DataType share one fetch
- **WHEN** a dashboard renders three panels all bound to the same DataType
- **THEN** only one `GET /api/types/:id/assertion-status` request is made for that DataType, and all
  three panels reflect its result

