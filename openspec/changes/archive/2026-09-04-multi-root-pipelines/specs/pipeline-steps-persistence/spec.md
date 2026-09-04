## MODIFIED Requirements

### Requirement: Pipeline steps table exists in the database
The `pipeline_steps` table SHALL carry a `root_id` column referencing `pipeline_roots(id)` with `ON DELETE CASCADE`. A step with no parent step SHALL have a non-null `root_id`; a step with a parent step SHALL derive its root from that parent and SHALL NOT rely on its own `root_id`.

#### Scenario: A root-level step records its root
- **WHEN** a step is appended with no parent step against a named root
- **THEN** the stored row carries that root's id in `root_id`

#### Scenario: Deleting a root cascades to its root-level steps
- **WHEN** a root with root-level steps is deleted
- **THEN** those steps are removed

#### Scenario: Pipeline steps table is created on migration

- **WHEN** the backend starts and Flyway runs pending migrations
- **THEN** the `pipeline_steps` table exists with the specified columns, FK, CHECK constraint (including `'chunkbytokencount'`), and index

#### Scenario: Enabled column defaults existing rows to true

- **WHEN** the enabled-column migration applies to a database with existing `pipeline_steps` rows
- **THEN** every existing row has `enabled = true` and the column is NOT NULL

#### Scenario: Deleting a pipeline cascades to its steps

- **WHEN** a pipeline is deleted from the `pipelines` table
- **THEN** all associated rows in `pipeline_steps` are automatically deleted via ON DELETE CASCADE

#### Scenario: POST with type "sort" is accepted

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "sort"` and a valid `config` object
- **THEN** the response is `201 Created` and the step is persisted with `op = 'sort'`

#### Scenario: POST with type "aggregate" is accepted

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "aggregate"` and a valid `config` object
- **THEN** the response is `201 Created` and the step is persisted with `op = 'aggregate'`

#### Scenario: POST with type "splittext" is accepted

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "splittext"` and a valid `config` object
- **THEN** the response is `201 Created` and the step is persisted with `op = 'splittext'`

#### Scenario: POST with type "extractheadings" is accepted

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "extractheadings"` and a valid `config` object
- **THEN** the response is `201 Created` and the step is persisted with `op = 'extractheadings'`

#### Scenario: POST with type "chunkbytokencount" is accepted

- **WHEN** `POST /api/pipelines/:id/steps` is called with `type: "chunkbytokencount"` and a valid `config` object
- **THEN** the response is `201 Created` and the step is persisted with `op = 'chunkbytokencount'`


## ADDED Requirements

### Requirement: POST /api/pipelines/:id/steps appends a step against a parent or a root
Appending a step SHALL require exactly one of `parentStepId` or `rootId`. Supplying neither, both, or a `rootId` naming a root of another pipeline SHALL fail with a named error. The database SHALL enforce that a step has a root id if and only if it has no parent step, so a step cannot be persisted in a state the walk would silently skip.

#### Scenario: Appending a root-level step names its root
- **WHEN** a step is appended with `rootId` naming a root of that pipeline and no `parentStepId`
- **THEN** the step is created with that root id and appears in that root's lane

#### Scenario: Appending with neither parent nor root is rejected
- **WHEN** a step is appended with neither `parentStepId` nor `rootId`
- **THEN** the request fails with a named error and no step is created

#### Scenario: Appending with a root of another pipeline is rejected
- **WHEN** a step is appended with a `rootId` belonging to a different pipeline
- **THEN** the request fails with a named error and no step is created

#### Scenario: A parentless step with no root cannot be persisted
- **WHEN** a write would persist a step with both a null parent step id and a null root id
- **THEN** the database rejects it
