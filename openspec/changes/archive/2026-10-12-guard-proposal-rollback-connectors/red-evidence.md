# HEL-1496 red-first and mutation evidence

All sbt runs: `SBT_OPTS=-J-Xmx3g nice -n 19 sbt "testOnly <specs>"`, backend/ of the worktree. Every run printed
`[info] [hel1468-guard] ScalaTest summary: failed=N aborted=0 unreadable=0`.

## Red-first attempt (before any main-code or comment edit)

Specs: `PipelineProposalRollbackConnectorSpec` (4 tests), `CombinedApplyProposalRollbackConnectorSpec` (1 test).

First run: 4 passed, 1 failed. The failure was a harness defect, NOT a leak: the route test sent `restConfig` where the
protocol key is `config` (`{"message":"roots[0].config is required for an inline source"}`, 400 before any write). Fixed the
request body; no main code touched.

Second run (unmutated main code):
```
[info] - should leave no Auto Connector, source or pipeline when the dashboard phase fails after a bare-url REST root applied
[info] - should remove the bare-url REST root's source, its Auto Connector and the credential row
[info] - should create no Connector and no source: the draft is rejected with a 400 before any write
[info] - should currently keep a user-explicit Connector on rollback while removing the source that references it
[info] - should never delete another user's unadopted Auto Connector, even when the deleting user's source references it
[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
[info] Tests: succeeded 5, failed 0, canceled 0, ignored 0, pending 0
```
No leak: the gap-1 test asserts apply returned `Right`, the Auto Connector (+1 connector, +1 credential, name `Auto: `)
existed after apply, and both are back to the pre-apply counts after the public `rollback`. The C3 STOP did not trigger.

## Mutation (a): disable the HEL-1497 cleanup in DataSourceService.delete

Edit (`backend/src/main/scala/com/helio/services/sources/DataSourceService.scala`, `removeUnadoptedConnector`):
`source match {` -> `if (true) Future.unit else source match {`

Command: `sbt "testOnly com.helio.services.pipelines.PipelineProposalRollbackConnectorSpec com.helio.api.routes.proposals.CombinedApplyProposalRollbackConnectorSpec"`

```
[info] - should leave no Auto Connector, source or pipeline when the dashboard phase fails after a bare-url REST root applied *** FAILED ***
[info]   List(("data_sources", 0), ("connectors", 1), ("connector_credentials", 1), ("pipelines", 0), ("dashboards", 0)) was not equal to List(("data_sources", 0), ("connectors", 0), ("connector_credentials", 0), ("pipelines", 0), ("dashboards", 0)) (CombinedApplyProposalRollbackConnectorSpec.scala:123)
[info] - should remove the bare-url REST root's source, its Auto Connector and the credential row *** FAILED ***
[info]   1 was not equal to 0 (PipelineProposalRollbackConnectorSpec.scala:134)
[info] [hel1468-guard] ScalaTest summary: failed=2 aborted=0 unreadable=0
```
Both the service-level (D2) and the route-level (D3) guards go red on their own. Reverted (`git checkout src/main`).

## Mutation (b): remove owner scoping, cumulatively

Command: `sbt "testOnly com.helio.services.pipelines.PipelineProposalRollbackConnectorSpec"` after each step.

1. Layer 1, `ImplicitConnectorCleanup.deleteIfUnadoptedImplicit` (InlineSourceCleanup.scala): `connectorRepo.findByIdOwned(connectorId, user)` -> `connectorRepo.findByIdInternal(connectorId)`.
   Result: cross-tenant test STILL GREEN (`Tests: succeeded 4, failed 0`), because layer 2 refuses.
2. Plus layer 2, `ConnectorRepository.delete` precheck (~:295): `findByIdOwned(id, user)` -> `findByIdInternal(id)`.
   Result: STILL GREEN (`Tests: succeeded 4, failed 0`), because layer 3 filters the delete.
3. Plus layer 3, the owner filter on the locked delete statement (~:303): `table.filter(r => r.id === connectorUuid && r.ownerId === ownerUuid)` -> `table.filter(r => r.id === connectorUuid)`.
   Result: RED:
```
[info] - should never delete another user's unadopted Auto Connector, even when the deleting user's source references it *** FAILED ***
[info]   0 was not equal to 1 (PipelineProposalRollbackConnectorSpec.scala:192)
[info] [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
```
Finding: the cross-tenant guard only goes red once ALL THREE owner-scoping layers are removed (defence in depth; each
alone is covered by the other two). Reverted (`git checkout src/main`), then the comment edit was applied afterwards.

## Final verification (after revert and comment edit)

`git diff` of main code shows only the comment edit in `PipelineProposalService.scala`.
Specs run: the two new ones plus `PipelineProposalImplicitConnectorCleanupSpec`, `DataSourceDeleteAutoConnectorSpec`,
`DataSourceDeleteAutoConnectorRoutesSpec`, `InlineSourceCleanupUnifiedRuleSpec`, `InlineSourceLeakPathsRoutesSpec`,
`CombinedApplyProposal*`, `services.firstrun.*`, `api.routes.firstrun.*`:
`[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Suites: completed 17`, `Tests: succeeded 111, failed 0`.
