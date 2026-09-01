# outputs-model Specification

## Purpose
Outputs are the panel-ready visualization attached to a pipeline node; this capability
owns their persistence, kinds, and sharing-aware authorization.

## Requirements

### Requirement: Outputs table persists pipeline-node visualizations
The system SHALL persist an `outputs` row with `id, pipeline_id (FK CASCADE),
node_step_id (FK CASCADE, NULL = pipeline root), owner_id, name, kind, config JSONB,
schema JSONB, position, tag, created_at, updated_at`.

#### Scenario: Output created at the pipeline root
- **WHEN** an Output is created with `node_step_id = NULL`
- **THEN** it is attached to the pipeline's root frame rather than any step

### Requirement: Output kind is one of the Phase-1 set
The system SHALL restrict `outputs.kind` to `metric | chart | table | collection |
timeline | markdown`.

#### Scenario: Unknown kind rejected
- **WHEN** an Output is created or updated with a kind outside the Phase-1 set
- **THEN** the write is rejected

### Requirement: Outputs inherit the owning pipeline's sharing-aware ACL
The system SHALL authorize read/write access to an Output using the same
sharing-aware access check used for its pipeline (owner + grantees), not the
owner-only policy used for pipeline steps.

#### Scenario: A pipeline grantee can read its Outputs
- **WHEN** a user who has been granted access to a pipeline (but does not own it)
  reads an Output attached to that pipeline
- **THEN** the read succeeds

#### Scenario: A non-owner, non-grantee is denied
- **WHEN** a user with no ownership or grant on the pipeline attempts to read or
  write one of its Outputs
- **THEN** the request is denied
