## MODIFIED Requirements

### Requirement: Pre-validation also authorizes resources referenced inside a patch, not only the top-level target
Pre-validation SHALL also authorize a SECOND, separately-owned resource referenced from inside an
edit's `patch`/`createPatch`, wherever its real create/update path also authorizes one — not defer
that check to forward-apply time. This covers: `panel` `create` (`dashboardId`), `pipeline`
`create` (`sourceDataSourceId`), `panel` `update`/`create` (`outputId`/`metricId`, when present
in the config patch), and `pipelineStep` `update` (a `JoinConfig`/`UnionConfig`/`LookupConfig`'s
`secondaryInput`, when it is `source`-kind and present).

For a `pipelineStep` `update`, "present" SHALL mean a `source`-kind `secondaryInput` with a non-empty `dataSourceId`, uniformly across all three config types. An empty `dataSourceId` is an incomplete draft rather than a reference to an inaccessible resource, and SHALL NOT trigger the ownership lookup or its `404` — matching the create/update route behavior these checks exist to mirror. A `lane`-kind `secondaryInput` references a node in the same pipeline and SHALL NOT trigger a data-source ownership lookup at all; it SHALL instead be validated for same-pipeline membership and acyclicity. The legacy flat fields SHALL NOT appear in this contract, and a patch set supplying one SHALL be rejected with a named error rather than coerced.

#### Scenario: A pipelineStep-update edit referencing a foreign-owned source-kind input is rejected
- **WHEN** a patch set includes a `pipelineStep` update edit whose `secondaryInput` is `source`-kind naming a data source the caller does not own
- **THEN** pre-validation rejects the whole patch set before any edit mutates anything

#### Scenario: A pipelineStep-update edit with an empty dataSourceId is not rejected
- **WHEN** a patch set includes a `pipelineStep` update edit whose `source`-kind `secondaryInput` has an empty `dataSourceId`
- **THEN** pre-validation performs no ownership lookup for that id and does not reject the patch set on its account

#### Scenario: A lane-kind secondary input performs no data-source lookup
- **WHEN** a patch set includes a `pipelineStep` update edit whose `secondaryInput` is `lane`-kind naming a step in the same pipeline
- **THEN** pre-validation performs no data-source ownership lookup and does not reject the patch set on that account

#### Scenario: A patch set carrying a legacy flat field is rejected
- **WHEN** a patch set supplies a `pipelineStep` edit whose config contains `rightDataSourceId`
- **THEN** apply fails with a named error identifying the invalid config shape, and no step is created or updated

#### Scenario: A panel-create edit referencing an inaccessible dashboard is rejected pre-apply
- **WHEN** a patch set includes a panel-create edit whose decoded `dashboardId` names a dashboard
  the caller has no ownership or sharing grant on
- **THEN** pre-validation rejects the whole patch set, and no other edit in the set is applied —
  including a preceding panel-delete edit that would otherwise have already succeeded

#### Scenario: A panel-update edit binding to an owned companion DataType is rejected pre-apply
- **WHEN** a patch set includes a panel-update edit whose config patch sets `outputId` to a
  DataType the caller OWNS but which is a companion (non-pipeline-output) type
- **THEN** pre-validation rejects the whole patch set before any edit mutates anything — mirroring
  `rejectCompanionBinding`'s real rule exactly: a foreign-owned or nonexistent `outputId` is NOT
  rejected by this specific check (it passes through unchanged, matching
  `PanelService.update`'s own documented behavior); only an OWNED companion-type binding is

#### Scenario: A panel-update edit referencing a foreign-owned metricId is rejected pre-apply
- **WHEN** a patch set includes a panel-update edit whose config patch sets `metricId` to a metric
  the caller does not own (or that doesn't resolve at all)
- **THEN** pre-validation rejects the whole patch set before any edit mutates anything — unlike
  `outputId`, `rejectUnresolvableMetric` DOES actively reject a foreign/nonexistent reference

#### Scenario: A pipelineStep-update edit referencing a foreign-owned join right-source is rejected
- **WHEN** a patch set includes a `pipelineStep` update edit whose `JoinConfig.secondaryInput` is source-kind
  naming a data source the caller does not own
- **THEN** pre-validation rejects the whole patch set before any edit mutates anything

#### Scenario: A pipelineStep-update edit with an empty second-source id is not rejected
- **WHEN** a patch set includes a `pipelineStep` update edit whose `JoinConfig`/`UnionConfig`/`LookupConfig`
  `secondaryInput` is source-kind with an empty `dataSourceId`
- **THEN** pre-validation performs no ownership lookup for that id and does not reject the patch
  set on its account
