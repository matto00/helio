## Purpose

Node snapshots hold the latest materialized rows for a pipeline node, keyed by
node rather than by a standalone DataType, so Outputs on the same node share one
snapshot.

## ADDED Requirements

### Requirement: Node snapshots are replace-per-run, latest-only
The system SHALL persist the rows produced at a materialized node keyed by
`(pipeline_id, node_step_id NULL-able)`, overwriting the prior snapshot on each
run, with no run history retained.

#### Scenario: A materialized node's snapshot is overwritten on the next run
- **WHEN** a pipeline runs a second time
- **THEN** the node's prior snapshot rows are replaced by the new run's rows

### Requirement: Only materialized nodes persist a snapshot
The system SHALL persist a node snapshot only for nodes with at least one
Output attached; non-materialized frames are not persisted.

#### Scenario: Two Outputs on the same node share one snapshot
- **WHEN** two Outputs are attached to the same pipeline node
- **THEN** both resolve their rows from the same single node snapshot

### Requirement: Node snapshots inherit Outputs' sharing-aware ACL
The system SHALL authorize read access to a node snapshot using the same
sharing-aware access check as the Outputs attached to that node.

#### Scenario: Cross-tenant denial
- **WHEN** a user with no ownership or grant on the pipeline attempts to read a
  node snapshot
- **THEN** the request is denied
