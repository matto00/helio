## ADDED Requirements

### Requirement: A root add for a pipeline deleted mid-request answers 404
`POST /api/pipelines/:id/roots` SHALL answer the same `404` an unknown pipeline id gets, and write nothing, when the
pipeline is deleted after the request's access check and before the root is written. It SHALL never answer `5xx` for
that race.

#### Scenario: Pipeline deleted between the access check and the root write
- **WHEN** the owner (or an `editor` grantee) adds a root to pipeline P and P is deleted after the access check
  passed but before the root is written
- **THEN** the response is `404` with the unknown-pipeline body
- **AND** no `pipeline_roots` row exists for P

#### Scenario: Pipeline deleted after the name read but before the pipeline-row lock
- **WHEN** P is deleted after the root add read P's name and before it locked P's row
- **THEN** the response is `404` with the unknown-pipeline body and no root row is written

### Requirement: An editor cannot attach a source they do not own as a root
`POST /api/pipelines/:id/roots` SHALL refuse, writing nothing, an `editor` grantee naming a data source owned by
another user, on a role that enforces row-level security.

#### Scenario: Editor names the owner's source
- **WHEN** user B, an `editor` of user A's pipeline P, adds a root with `sourceId` of a source A (or a third user) owns
- **THEN** the response is the data-source `404` and P's roots are unchanged

### Requirement: A root remove only removes a root of the addressed pipeline
`DELETE /api/pipelines/:id/roots/:rootId` SHALL refuse, writing nothing, a `rootId` that belongs to a different
pipeline, on a role that enforces row-level security.

#### Scenario: Editor names another pipeline's root
- **WHEN** user B, an `editor` of pipeline P, removes `rootId` R where R is a root of a different pipeline Q
- **THEN** the response is `404 Root not found`
- **AND** Q's roots, steps and snapshots and P's roots are unchanged
