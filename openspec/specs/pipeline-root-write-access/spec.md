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
