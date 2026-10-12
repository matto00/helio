## ADDED Requirements

### Requirement: Duplicating a step applies the same step-configuration write rejection as create and update
`POST /api/pipeline-steps/:id/duplicate` SHALL apply to the configuration it would write the same strict write-path
step-configuration check that creating or updating a step applies, for every step kind. When that check rejects the
configuration, the request SHALL fail with the same `422` and message create/update return for that configuration, and
no step SHALL be created. A configuration that create and update accept — including an incomplete draft (a missing
required field, an empty casts map, an unset secondary-source id) — SHALL remain duplicable with `201 Created`.

#### Scenario: Duplicating a stored legacy-target cast is rejected
- **WHEN** a pipeline holds a stored `cast` step with `casts: {"doc": "binary-ref"}` and the owner duplicates it
- **THEN** the response is `422` naming `binary-ref` and the supported targets, and the pipeline's step count is unchanged

#### Scenario: Duplicating an incomplete draft still succeeds
- **WHEN** the owner duplicates a stored step whose configuration is an incomplete draft that create accepts
- **THEN** the response is `201 Created` and the clone carries the same configuration directly after the original
