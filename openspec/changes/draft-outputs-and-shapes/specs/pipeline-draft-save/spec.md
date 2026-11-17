## ADDED Requirements

### Requirement: A draft Output edit is validated like an Output PATCH
`POST /api/pipelines/:id/draft/save` SHALL validate an edited Output's config as a change against its stored config, with the same tolerance rule as `PATCH /api/outputs/:id`: a key re-sent with the value already stored SHALL be accepted, including a stored legacy key, and only what the draft introduces or changes SHALL be judged. A restore of a journaled definition (undo) SHALL validate a restored or recreated Output's config with the restore policy patch-set rollback uses. A created Output in a public save SHALL be validated as today.

#### Scenario: Rename an Output carrying a legacy key
- **WHEN** a draft renames an Output whose stored config holds the legacy key `metricLabel`, and keeps its config
- **THEN** the save succeeds and the Output has the new name and its stored config

#### Scenario: A new unknown key is still refused
- **WHEN** a draft edit adds an unknown key to that Output's config
- **THEN** the response is 400 naming the key and nothing is written

#### Scenario: Undo recreates an Output carrying a legacy key
- **WHEN** a draft save removed an Output (with no bound panel or alert rule) whose stored config held a legacy key, and the user undoes it
- **THEN** the Output is recreated under its id with that config
