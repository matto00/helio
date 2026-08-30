## REMOVED Requirements

### Requirement: Metric panel supports a viz-level aggregation spec
**Reason**: HEL-292 panel-level aggregation is retired (decision 2) — aggregation lives only in pipeline steps; Outputs are render-only.
**Migration**: A migrated panel's aggregation becomes an aggregate/groupBy tail step (see metric-crud-api migration note); no panel-level aggregation config exists after this ticket.

### Requirement: Chart panel supports a viz-level groupBy aggregation spec
**Reason**: HEL-292 panel-level aggregation is retired (decision 2) — aggregation lives only in pipeline steps; Outputs are render-only.
**Migration**: A migrated panel's aggregation becomes an aggregate/groupBy tail step (see metric-crud-api migration note); no panel-level aggregation config exists after this ticket.

### Requirement: Aggregation semantics match the pipeline aggregate step
**Reason**: HEL-292 panel-level aggregation is retired (decision 2) — aggregation lives only in pipeline steps; Outputs are render-only.
**Migration**: A migrated panel's aggregation becomes an aggregate/groupBy tail step (see metric-crud-api migration note); no panel-level aggregation config exists after this ticket.

### Requirement: Proposal and apply-proposal accept panel-level aggregation
**Reason**: HEL-292 panel-level aggregation is retired (decision 2) — aggregation lives only in pipeline steps; Outputs are render-only.
**Migration**: A migrated panel's aggregation becomes an aggregate/groupBy tail step (see metric-crud-api migration note); no panel-level aggregation config exists after this ticket.

### Requirement: Metric aggregate value is formatted for display
**Reason**: HEL-292 panel-level aggregation is retired (decision 2) — aggregation lives only in pipeline steps; Outputs are render-only.
**Migration**: A migrated panel's aggregation becomes an aggregate/groupBy tail step (see metric-crud-api migration note); no panel-level aggregation config exists after this ticket.

### Requirement: Scatter charts reject an aggregation spec
**Reason**: HEL-292 panel-level aggregation is retired (decision 2) — aggregation lives only in pipeline steps; Outputs are render-only.
**Migration**: A migrated panel's aggregation becomes an aggregate/groupBy tail step (see metric-crud-api migration note); no panel-level aggregation config exists after this ticket.

