## ADDED Requirements

### Requirement: Preview resolves Output update and delete without error or writes
`POST /api/patch-sets/preview` SHALL return, for `output` `update` and `delete` edits, the same resolution outcomes as apply's pre-validation and SHALL NOT return 500 or write any row.

#### Scenario: Owned output update previews
- **WHEN** an owner previews an `update` edit renaming an Output they own
- **THEN** the response is 200 and the edit's diff has `before` = the prior Output (including config) and `after` = that Output with the name/config patch applied, and no row changes

#### Scenario: Owned output delete previews
- **WHEN** an owner previews a `delete` edit for an Output they own
- **THEN** the response is 200, `before` is the prior Output and `after` is null, and no row changes

#### Scenario: Foreign and absent output ids are indistinguishable
- **WHEN** a non-owner previews an output update/delete for an Output they cannot see, and another caller previews one for a nonexistent id
- **THEN** both responses are 404 with byte-identical bodies

### Requirement: Preview and apply agree on pipelineStep delete prior state
A previewed `pipelineStep` delete SHALL report `boundOutputs` in its prior state exactly as apply's does.

#### Scenario: Step delete with a bound Output
- **WHEN** a pipelineStep with a bound Output is previewed for delete
- **THEN** its prior state `boundOutputs` equals what apply captures

### Requirement: Preview context parity with apply
The `PatchSetApplyContext` built for preview SHALL have every collaborator non-null and supplied; a collaborator absent from the preview context SHALL fail a structural test.

#### Scenario: New context field
- **WHEN** a field is added to `PatchSetApplyContext` and preview does not wire it
- **THEN** the parity test fails
