## REMOVED Requirements

### Requirement: Dev DB repair script exists and is idempotent
**Reason**: This dev-only repair script targets `data_types` rows and `typeId` panel bindings, both retired by the outputs-model migration (decision 11) — the categories of drift it corrected (NULL-owner rows, wrong-owner rows, empty step config) are either migrated away or, for any future recurrence, would need a new script scoped to `outputs`/`pipeline_steps`.
**Migration**: No replacement script is added by this ticket — the outputs-model migration itself is idempotent/guarded (see `node-snapshot-persistence`/`pipeline-step-tree` deltas) and does not depend on this repair script having been run first. If a new drift class specific to Outputs/node_snapshots is discovered post-merge, it gets a fresh dev-db-repair script scoped to the new tables — filed as its own follow-up, not a revival of this one.

### Requirement: ProfitAgg pipeline runs without 422 after repair
**Reason**: This dev-only repair script targets `data_types` rows and `typeId` panel bindings, both retired by the outputs-model migration (decision 11) — the categories of drift it corrected (NULL-owner rows, wrong-owner rows, empty step config) are either migrated away or, for any future recurrence, would need a new script scoped to `outputs`/`pipeline_steps`.
**Migration**: No replacement script is added by this ticket — the outputs-model migration itself is idempotent/guarded (see `node-snapshot-persistence`/`pipeline-step-tree` deltas) and does not depend on this repair script having been run first. If a new drift class specific to Outputs/node_snapshots is discovered post-merge, it gets a fresh dev-db-repair script scoped to the new tables — filed as its own follow-up, not a revival of this one.

### Requirement: Panel binding to ProfitAgg output DataType persists after repair
**Reason**: This dev-only repair script targets `data_types` rows and `typeId` panel bindings, both retired by the outputs-model migration (decision 11) — the categories of drift it corrected (NULL-owner rows, wrong-owner rows, empty step config) are either migrated away or, for any future recurrence, would need a new script scoped to `outputs`/`pipeline_steps`.
**Migration**: No replacement script is added by this ticket — the outputs-model migration itself is idempotent/guarded (see `node-snapshot-persistence`/`pipeline-step-tree` deltas) and does not depend on this repair script having been run first. If a new drift class specific to Outputs/node_snapshots is discovered post-merge, it gets a fresh dev-db-repair script scoped to the new tables — filed as its own follow-up, not a revival of this one.

### Requirement: Dev DB repair procedure is documented
**Reason**: This dev-only repair script targets `data_types` rows and `typeId` panel bindings, both retired by the outputs-model migration (decision 11) — the categories of drift it corrected (NULL-owner rows, wrong-owner rows, empty step config) are either migrated away or, for any future recurrence, would need a new script scoped to `outputs`/`pipeline_steps`.
**Migration**: No replacement script is added by this ticket — the outputs-model migration itself is idempotent/guarded (see `node-snapshot-persistence`/`pipeline-step-tree` deltas) and does not depend on this repair script having been run first. If a new drift class specific to Outputs/node_snapshots is discovered post-merge, it gets a fresh dev-db-repair script scoped to the new tables — filed as its own follow-up, not a revival of this one.

