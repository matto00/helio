## MODIFIED Requirements

### Requirement: Pre-validation also authorizes resources referenced inside a patch, not only the top-level target
Pre-validation SHALL also authorize a SECOND, separately-owned resource referenced from inside an
edit's `patch`/`createPatch`, wherever its real create/update path also authorizes one — not defer
that check to forward-apply time. This covers: `panel` `create` (`dashboardId`), `pipeline`
`create` (`sourceDataSourceId`), `panel` `update`/`create` (`outputId`/`metricId`, when present
in the config patch), and `pipelineStep` `update` (a `JoinConfig`/`UnionConfig`/`LookupConfig`'s
referenced `DataSource`, when present).

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

