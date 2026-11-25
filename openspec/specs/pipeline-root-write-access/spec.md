# pipeline-root-write-access Specification

## Purpose
Defines who may add or remove a pipeline's roots and the response each caller role receives, so the service
authorization and the database row-level security never disagree.

## Requirements

### Requirement: Owners and editor grantees may add a root
`POST /api/pipelines/:id/roots` SHALL succeed for the pipeline's owner and for a user holding an `editor` grant on
it, persisting the new root, when the database enforces row-level security for the application role. It SHALL never
answer 5xx because of a row-level-security policy.

#### Scenario: Editor adds a root on a row-level-security-enforcing role
- **WHEN** user B, holding an `editor` grant on user A's pipeline P, adds a root with a data source B owns
- **THEN** the response is a success carrying the new root
- **AND** P's root list read back afterwards contains that root

#### Scenario: Viewer and stranger cannot add a root
- **WHEN** a `viewer` grantee of P adds a root
- **THEN** the response is `403` and P's roots are unchanged
- **WHEN** a user with no grant on P adds a root
- **THEN** the response is the same `404` an unknown pipeline id gets and P's roots are unchanged

### Requirement: Owners and editor grantees may remove a root, and success means removed
`DELETE /api/pipelines/:id/roots/:rootId` SHALL succeed for the owner and for an `editor` grantee, deleting the root,
its steps and their snapshots, when row-level security is enforced. A success response SHALL only be returned when
the root was actually deleted; a removal that deletes nothing SHALL NOT answer 2xx.

#### Scenario: Editor removes a root on a row-level-security-enforcing role
- **WHEN** user B, an `editor` grantee of user A's two-root pipeline P, removes one root
- **THEN** the response is a success
- **AND** P read back afterwards has one root and none of the removed root's steps

#### Scenario: Viewer and stranger cannot remove a root
- **WHEN** a `viewer` grantee of P removes a root
- **THEN** the response is `403` and P's roots are unchanged
- **WHEN** a user with no grant on P removes a root
- **THEN** the response is the same `404` an unknown pipeline id gets and P's roots are unchanged

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
