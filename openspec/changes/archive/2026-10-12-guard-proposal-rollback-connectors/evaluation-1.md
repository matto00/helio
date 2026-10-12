## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `f676b236da14a0033d115784a42ef80d3a6c9502` against the live-resolved base `a369a9cb84a0966adb3c8c9d515838ebfbf6bb15` (origin/main).
I treated the executor's red-evidence.md as claims and re-ran them myself. Results are below.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (gap 1, service level, production-wired): `PipelineProposalRollbackConnectorSpec.scala:117-136`. `DataSourceService` and `SourceService` are built with the `ConnectorRepository` (`:65-66`). The spec uses a real `PipelineRunService` and stubs the fetch to return `Left`. It asserts that apply returned `Right` (`applied`, `:110-114`), that the Auto Connector and credential exist after apply (+1 each, name `Auto: `), and that the counts are back to their before values after the public `rollback`. The red-first attempt is recorded: the first failure was a harness defect (`restConfig` instead of `config`), not a leak, so the C3 STOP rule correctly did not trigger.
- AC2 (route level, real `ApiRoutes`): `CombinedApplyProposalRollbackConnectorSpec.scala:100-124`. The 422 comes from `applyDashboardPhase`'s sentinel resolution, which runs after `pipelineProposalService.apply` returns `Right` (I checked this in `CombinedProposalService`). The spec compares exact-owner counts for data_sources, connectors, credentials, pipelines and dashboards.
- AC3 (newConnector draft): `:140-151`. It expects `BadRequest`, and all four exact-owner counts stay at 0.
- AC4 (explicit Connector kept): `:155-172`. The test is written as a characterization of current behaviour, and a comment marks it as an open owner question.
- AC5 (cross-tenant): `:176-195`. User A deletes a forged-reference REST source through the production-wired `DataSourceService.delete`. B's Connector and credential survive, counted by B's exact owner id.
- AC6 (mutations): I reproduced them myself (see Phase 2).
- AC7 (comments): done. The scaladoc now says `response.sources`, not `response.source`, and both the scaladoc and the inline note credit HEL-1497's `DataSourceService.delete`.
- Tasks: all items are checked, and they match the diff. There is no scope creep: two new specs, a comment-only main edit and change artifacts.
- CONSTRAINTS C1-C6: all honoured (details in Phase 2).

### Phase 2: Code Review — PASS
Issues: none blocking.

**The main-code diff is comment-only.** `git diff a369a9cb8...HEAD -- backend/src/main` touches only `PipelineProposalService.scala:442-455`. The changes are scaladoc lines and one added `//` line. The executable line `Future.sequence(response.sources.map(... implicitConnector = false ...))` is byte-identical.

**Mutation D6(a), re-run by me.** I changed `DataSourceService.scala:742` from `source match {` to `if (true) Future.unit else source match {`. Then I ran `testOnly` on both new specs:
```
[info] - should leave no Auto Connector, source or pipeline when the dashboard phase fails after a bare-url REST root applied *** FAILED ***
[info]   List(("data_sources", 0), ("connectors", 1), ("connector_credentials", 1), ("pipelines", 0), ("dashboards", 0)) was not equal to List(("data_sources", 0), ("connectors", 0), ("connector_credentials", 0), ("pipelines", 0), ("dashboards", 0)) (CombinedApplyProposalRollbackConnectorSpec.scala:123)
[info] - should remove the bare-url REST root's source, its Auto Connector and the credential row *** FAILED ***
[info]   1 was not equal to 0 (PipelineProposalRollbackConnectorSpec.scala:134)
[info] [hel1468-guard] ScalaTest summary: failed=2 aborted=0 unreadable=0
```
Both the D2 and D3 guards go red independently, matching the executor's claim. I reverted the mutation with `git checkout`.

**Mutation D6(b), the three-layer finding, re-run by me.**
- Layers 1 and 2 removed:
  - Layer 1: `InlineSourceCleanup.scala:36`, `findByIdOwned(connectorId, user)` -> `findByIdInternal(connectorId)`.
  - Layer 2: `ConnectorRepository.scala:295`, the same swap.
  - Result: still GREEN, `Tests: succeeded 4, failed 0`. I confirmed that the 4 tests actually executed after a fresh compile; it was not a cached result.
- Layer 3 added: `ConnectorRepository.scala:303` drops `&& r.ownerId === ownerUuid`. The test went RED:
```
[info] - should never delete another user's unadopted Auto Connector, even when the deleting user's source references it *** FAILED ***
[info]   0 was not equal to 1 (PipelineProposalRollbackConnectorSpec.scala:192)
[info] [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
```
This confirms the executor's finding: the delete statement's owner filter alone is enough to keep the test green, so the guard goes red only when all three owner-scoping layers are removed (defence in depth). I did not test layers 1 or 2 alone with the others intact. Those runs were not needed for the verdict. All mutations were reverted, `git status` is clean, and HEAD is unchanged.

**Gates (fresh run, clean tree, `SBT_OPTS=-J-Xmx3g nice -n 19 sbt -J-Xmx3g testOnly ...`).** MemAvailable was about 51 GB.
- Specs run:
  - the two new specs
  - `PipelineProposalImplicitConnectorCleanupSpec`
  - `DataSourceDeleteAutoConnectorSpec` and `DataSourceDeleteAutoConnectorRoutesSpec`
  - `InlineSourceCleanupUnifiedRuleSpec`
  - `InlineSourceLeakPathsRoutesSpec`
  - all `CombinedApplyProposal*` (5 suites)
  - `services.firstrun.*` (4) and `api.routes.firstrun.*` (2)
- Result:
```
[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
[info] Suites: completed 18, aborted 0
[info] Tests: succeeded 118, failed 0, canceled 0, ignored 0, pending 0
```
(The executor reported 17 suites and 111 tests, probably because of a different glob. My run is the broader one.)
- Other checks: `npm run check:scala-quality` is clean (soft warnings are pre-existing and informational). `npm run check:openspec` is clean, and prettier is clean on the change dir. No frontend files changed, so the npm lint/test/build gates do not apply. No sbt server was left running (there is no `backend/project/target/active.json`).

**Standards / constraints**
- C1: both specs call `VerifiedEmbeddedPostgres.start` (`PipelineProposalRollbackConnectorSpec.scala:50`, `CombinedApplyProposalRollbackConnectorSpec.scala:65`), and `[hel1468-guard]` appears in every run.
- C2: counts use `WHERE owner_id = <exact id>`, and credentials use `WHERE user_id = <exact id>` (that table has no owner_id). Users are inserted with `hel1496-<uuid>@example.test`. matt@helio.dev is never used.
- C5: no inline FQNs (checked by grep and by `check:scala-quality`). There is no `println` and no logging in either spec. The `plain` credential value from `forLegacySource` (NoAuth) is passed to `connectorRepo.create` and never printed. Neither red-evidence.md nor this report contains a credential value.
- CONTRIBUTING import rule: `com.helio.domain.model._` is a cohesive-package wildcard, which the rule allows.
- Type safety, DRY, dead code, over-engineering: no issues. The spec harness follows existing route-spec patterns.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. I started no dev server.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `CombinedApplyProposalRollbackConnectorSpec.scala:116-123`: the route test never asserts on its own that an Auto Connector existed between apply and rollback. Its non-vacuity rests on mutation D6(a), which I reproduced. An intermediate assertion is not possible from outside a single POST, so this is acceptable as is.
- `PipelineProposalRollbackConnectorSpec.scala:146`: the AC3 test checks the error type (`BadRequest`) but not its message. Matching the specific "unresolved connector/url" message would pin the 400 to the draft-rejection path rather than to any validation failure.
- `PipelineProposalRollbackConnectorSpec.scala:72`: the "real" `PipelineRunService` is wired with `registry = null`. This is safe only because the fetch stub forces the blocked-run path. A one-line comment saying so would prevent a future NPE puzzle if someone changes the stub.
