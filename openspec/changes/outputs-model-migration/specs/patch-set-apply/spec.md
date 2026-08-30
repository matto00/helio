## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: Pre-validation also authorizes resources referenced inside a patch, not only the top-level target
Pre-validation SHALL also authorize a SECOND, separately-owned resource referenced from inside an
edit's `patch`/`createPatch`, wherever its real create/update path also authorizes one — not defer
that check to forward-apply time. This covers: `panel` `create` (`dashboardId`), `pipeline`
`create` (`sourceDataSourceId`), `panel` `update`/`create` (`dataTypeId`/`the Output's config`, when present
in the config patch), and `pipelineStep` `update` (a `JoinConfig`/`UnionConfig`/`LookupConfig`'s
referenced `DataSource`, when present).

#### Scenario: A panel-create edit referencing an inaccessible dashboard is rejected pre-apply
- **WHEN** a patch set includes a panel-create edit whose decoded `dashboardId` names a dashboard
  the caller has no ownership or sharing grant on
- **THEN** pre-validation rejects the whole patch set, and no other edit in the set is applied —
  including a preceding panel-delete edit that would otherwise have already succeeded

#### Scenario: A panel-update edit binding to an owned companion DataType is rejected pre-apply
- **WHEN** a patch set includes a panel-update edit whose config patch sets `dataTypeId` to a
  Output/node the caller OWNS but which is a companion (non-pipeline-output) type
- **THEN** pre-validation rejects the whole patch set before any edit mutates anything — mirroring
  `rejectCompanionBinding`'s real rule exactly: a foreign-owned or nonexistent `dataTypeId` is NOT
  rejected by this specific check (it passes through unchanged, matching
  `PanelService.update`'s own documented behavior); only an OWNED companion-type binding is

#### Scenario: A panel-update edit referencing a foreign-owned metricId is rejected pre-apply
- **WHEN** a patch set includes a panel-update edit whose config patch sets `the Output's config` to a metric
  the caller does not own (or that doesn't resolve at all)
- **THEN** pre-validation rejects the whole patch set before any edit mutates anything — unlike
  `dataTypeId`, `rejectUnresolvableMetric` DOES actively reject a foreign/nonexistent reference

### Requirement: Prior-state capture is emitted in a shape a future undo path can consume
For every `update`/`delete` edit, `EditOutcome.priorState` SHALL carry the resource's full
pre-mutation state, serialized using that kind's EXISTING response shape (`PanelResponse`/
`DashboardResponse`/`DataSourceResponse`/`Output/nodeResponse`/`PipelineSummaryResponse`/
`PipelineStepResponse`) — never a new, undo-specific format. `create`-op edits carry
`priorState = None`. This SHALL be populated independent of the edit's final `status`, including
for an `unrecoverable` delete-rollback, so a future undo path has the raw material to work from
even where this ticket's own rollback cannot fully restore the resource itself.

#### Scenario: An update edit's prior state matches the resource's existing response shape
- **WHEN** a panel-update edit is applied
- **THEN** its `EditOutcome.priorState` equals the same `PanelResponse` JSON shape
  `GET`/`PATCH /api/panels/:id` already returns, populated with the panel's state before the update

#### Scenario: A create edit has no prior state
- **WHEN** a panel-create edit is applied
- **THEN** its `EditOutcome.priorState` is absent/`None` — nothing existed before a create

#### Scenario: An unrecoverable delete's prior state is still captured
- **WHEN** a dataType-delete edit's rollback is reported `unrecoverable`
- **THEN** its `EditOutcome.priorState` still carries the dataType's pre-delete `Output/nodeResponse`
  — prior-state capture does not depend on whether this ticket's own rollback can restore it

#### Scenario: A pipeline edit's prior state uses the joined summary shape
- **WHEN** a pipeline-update edit is applied
- **THEN** its `EditOutcome.priorState` equals the joined `PipelineSummaryResponse` shape
  (including `sourceDataSourceName`/`outputOutput/nodeName`), not merely the bare `Pipeline`
  id-only fields the ACL check alone would have read

### Requirement: A journaled panel edit SHALL also capture a raw, unmaterialized config snapshot, journal-only
The journal SHALL, for a `panel` `update` edit only, additionally capture the panel's raw
(unmaterialized) post-apply config — the same value a bare, non-metric-resolving read of that panel
would return — distinct from the materialized `resultingState` already captured for every kind. This
raw config SHALL exist only in the journal, never as a field on `EditOutcome` or anywhere in the
`POST /api/patch-sets/apply` response body.

#### Scenario: A metric-bound panel's journaled raw config differs from its materialized response
- **WHEN** a panel edit updates a `OutputPanel` bound to a `the Output's config`
- **THEN** the journal's raw config for that edit carries the panel's own stored field values, not
  the bound metric's currently-effective values that the same edit's materialized `resultingState`
  carries

#### Scenario: The raw config never appears on the apply response
- **WHEN** `POST /api/patch-sets/apply` successfully applies a panel update edit
- **THEN** the response's corresponding `EditOutcome` has exactly the same fields it had before this
  change — no raw-config field is present anywhere in the response body
