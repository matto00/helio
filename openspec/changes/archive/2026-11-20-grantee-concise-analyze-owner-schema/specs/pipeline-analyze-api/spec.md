## ADDED Requirements

### Requirement: Concise analyze judges a grantee's steps by the owner's schema

For every caller `GET /api/pipelines/:id/analyze?concise=true` admits, each node's `validationError` SHALL be computed
the same way the full analyze response computes a step's `validationError` for that caller: from the pipeline's root
schemas as the pipeline owner sees them, and, for a non-owner, carrying only the schema-independent config problem, an
error identical to the caller-view one, or the fixed neutral sentence. A step valid for the owner SHALL NOT carry a
`validationError` for a grantee. A node's `path`, `op` and `warnings` SHALL be computed exactly as before. The response
SHALL carry no row count and no column name or type a non-owner did not already receive, and its wire shape SHALL be
unchanged. A caller with no access SHALL still receive the same not-found result.

#### Scenario: Grantee on a valid pipeline whose root they do not own
- **WHEN** an editor or viewer grantee requests concise analyze for a pipeline whose compute step references a column
  of a root owned by the pipeline owner, and the step is valid for the owner
- **THEN** no node carries a `validationError`

#### Scenario: Grantee on a step invalid only against the owner's schema
- **WHEN** a grantee requests concise analyze for a pipeline whose step is invalid against the owner's root schema
- **THEN** that node carries a `validationError` naming no root column or type, while the owner's names the types

#### Scenario: Concise and full analyze agree for a grantee
- **WHEN** a grantee requests both modes for the same pipeline
- **THEN** each enabled step's concise `validationError` equals its full-mode `validationError`

#### Scenario: Stranger still gets not-found
- **WHEN** a signed-in user with no grant requests concise analyze for the pipeline
- **THEN** the result is the same not-found as before this change
