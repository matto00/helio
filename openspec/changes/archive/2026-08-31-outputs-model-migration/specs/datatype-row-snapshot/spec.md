## REMOVED Requirements

### Requirement: DataType row snapshot is persisted after a successful non-dry run
**Reason**: data_type_rows is replaced by node_snapshots, keyed by (pipeline_id, node_step_id) rather than by DataType id (see node-snapshot-persistence).
**Migration**: Existing rows are copied 1:1 into node_snapshots under each pipeline's last trunk step before data_type_rows is dropped.

### Requirement: Stored snapshot rows are retrievable via GET /api/data-types/:id/rows
**Reason**: data_type_rows is replaced by node_snapshots, keyed by (pipeline_id, node_step_id) rather than by DataType id (see node-snapshot-persistence).
**Migration**: Existing rows are copied 1:1 into node_snapshots under each pipeline's last trunk step before data_type_rows is dropped.

