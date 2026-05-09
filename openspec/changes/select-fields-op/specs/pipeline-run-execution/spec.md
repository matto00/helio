## ADDED Requirements

### Requirement: Select step retains only specified columns during pipeline execution
The execution engine SHALL support the `select` op during pipeline runs. The step config SHALL
contain a `fields` array of column name strings. The engine SHALL retain only those columns in each
row and drop all others. Field names absent from a row SHALL be silently omitted.

#### Scenario: Select op applied during a pipeline run
- **WHEN** `POST /api/pipelines/:id/run` is called and the pipeline has a select step with `fields: ["id", "name"]`
- **THEN** the response rows contain only `id` and `name`; all other columns are absent

#### Scenario: Select with unknown field name does not error
- **WHEN** a select step references a field not present in any row and `POST /api/pipelines/:id/run` is called
- **THEN** the response is `200 OK` and the unknown field is silently absent from all result rows
