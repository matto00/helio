## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD a369a9cb84a0966adb3c8c9d515838ebfbf6bb15 (branch task/guard-proposal-rollback-connectors/HEL-1496; change dir untracked). The restated scope (guard tests only, comment fix, explicit Connector kept and raised as an owner question) is the driver's call and is not re-argued here.

### What I verified (with evidence)

**Premise 1: gap 1 is covered by the HEL-1497 seam. CONFIRMED.**
- `PipelineProposalService.rollback` (PipelineProposalService.scala:447-450) deletes the pipeline, then calls `cleanupSource(id, implicitConnector = false, user)` for each `response.sources` entry. `cleanupSource` (:77-78) goes to `InlineSourceCleanup.deleteCallCreated` (InlineSourceCleanup.scala:97-112). With the flag false, `captureImplicitConnector` returns None, but the call still runs `dataSourceService.delete(id, user)`.
- `DataSourceService.delete` (:695-706) goes to `deleteAfterPrecheck` (:709-736). On `Right`, line 733 calls `removeUnadoptedConnector`, which (:741-754) calls `ImplicitConnectorCleanup.deleteIfUnadoptedImplicit` for every `RestSource` when `connectorCleanup != null`. `connectorCleanup` is null only when `connectorRepo` is null (:77).
- Production wiring: in ApiRoutes.scala, `connectorRepo` is declared at :366, before `dataSourceService` at :375, which receives `connectorRepo` as its last argument. That same `dataSourceService` goes into `PipelineProposalService` (:503-504), which goes into `CombinedProposalService` (:511) and `FirstRunDashboardService` (:515-516).
- The existing `PipelineProposalImplicitConnectorCleanupSpec` builds `new DataSourceService(dataSourceRepo, new LocalFileSystem(...))` with no connectorRepo. So the design is right that it cannot see the seam.

**Premise 2: a `newConnector` draft never creates a Connector server-side. CONFIRMED (one inventory gap, see notes).**
- `ProposalRestApiConfig.toRestApiConfigPayload` (PipelineProposalProtocol.scala:90-101) maps no `newConnector` field. `SourceService.createRest` rejects `(None, None)` with a 400 at :124-125, before `dataSourceRepo.insert` (:255).
- Every backend Connector creation site: `SourceService.scala:165` (the implicit Auto Connector, url path), `ConnectorEntityService.scala:83` (explicit create) and `ConnectorCompletionService.createPending` (:66, HEL-955 `create_connector` pending handoff). The last two are reached only from connector routes. No proposal, assistant or apply code path calls them (grep for `connectorEntityService.` / `createOrRemintPending` / `connectorCompletionService.` outside the connector routes: zero hits).
- helio-mcp: `newConnector` does not appear in `write.ts`, `types.ts` or `helioApi.ts`. MCP `create_connector` is a separate tool that creates an explicit (non-implicit) Connector over `/api/connectors`. It does not convert a draft.

**Premise 3: D3's post-apply combined failure is reachable. CONFIRMED.**
- `CombinedProposalService.applyDashboardPhase` (:115-117): if a panel carries the `$pipelineOutput` sentinel and the pipeline created a number of Outputs other than one, `resolveSentinelOutputId` (:155-168) returns 422. That runs after `pipelineProposalService.apply` succeeds and calls the public `rollback`.
- The pre-apply checks (`validateOutputRefPositions`, `validateDashboardStructure`, `validateSourceBindings`) do not look at the Output count. So a sentinel panel plus a zero-Output pipeline proposal reaches line 117 without fault injection.
- The ApiRoutes harness accepts a stub `RestApiConnectorDriver` (DataSourceDeleteAutoConnectorRoutesSpec.scala:83 passes `Some(_ => Future.successful(Left("no HTTP")))`). A Left fetch takes `finishPipeline`'s fetchError branch, which calls `recordUnrunnable` and returns Right. No network is needed.

**Premise 4: the D5/D6 guards are not vacuous. CONFIRMED, with a caveat.**
- The embedded DB uses `DbContext(db, db)` on the `postgres` superuser (existing spec :50-53). `connectors` is `FORCE ROW LEVEL SECURITY` (V93:32), but a superuser bypasses even forced RLS, so the application owner filters are the only guard in tests.
- `data_sources` has no FK to `connectors` (the reference is `config->>'connectorId'`), so A's forged reference can be inserted. `countRestSourcesReferencing` (DataSourceRepository.scala:285-293) is unscoped and returns 0 once A's source is gone. So with the owner checks removed, X really would be deleted, and D5 can go red.
- Caveat: owner scoping is applied in three places, not one. They are `deleteIfUnadoptedImplicit` via `connectorRepo.findByIdOwned` (InlineSourceCleanup.scala), `ConnectorRepository.delete`'s own `findByIdOwned` (:295), and its `owned` filter on the locked delete (:303). Removing only the first leaves D5 green (`delete` returns `Right(false)`). D6(b) says "and, if needed, the repository delete's owner check". See note 2.
- D2's "Auto Connector exists after apply" assertion plus D6(a) make the gap-1 guards able to fail. `ConnectorRepository.delete` removes the credential via `credentialRepo.deleteAction` (:311), so the credential count can be observed. Note that `connector_credentials`' owner column is `user_id`, not `owner_id` (V92:17).

**Structure:**
- Every restated AC is covered by a task: AC1 is D2/1.1, AC2 is D3/1.2, AC3 is D4a/1.3, AC4 is D4b/1.3, AC5 is D5/1.4, AC6 is D6/2.x, AC7 is D7/3.1.
- No API or schema change, so no contract delta is needed (`skip_specs` is consistent).
- No TODO/TBD placeholders.

### Verdict: REFUTE

Two ambiguities could lead the executor to a false red, or to a "guard" that never reaches the path it claims to prove. Under D1's STOP-on-red rule, either one costs a full escalation cycle. Both are cheap to fix in design.md.

### Change Requests

1. **D2 does not reach the public `rollback` as written.** D2 says to mirror `PipelineProposalImplicitConnectorCleanupSpec`'s setup with a "stubbed fetch, as the existing spec does". That spec passes `null` for `pipelineRunService` (:60) and stubs a successful fetch (`Right(JsArray(...))`, :55). Its test only works because apply fails before `finishPipeline`. A successful apply always dereferences `pipelineRunService`: either `recordUnrunnable` (fetchError branch, PipelineProposalService.scala ~505) or `submit` (:528). With null, the test fails on an NPE, and a careless reading of D1 could take that for a leak. With a success stub plus a real run service, the run really executes. If it fails or blocks, apply's internal `rollbackAll` runs instead (:528-541), so the public `rollback` is never exercised. Revise D2 to state:
   - the fetch stub returns `Left(...)`, so the source is created with `fetchError` and `finishPipeline` takes the `recordUnrunnable` branch, giving a Right response with a blocked run;
   - a real `PipelineRunService` is wired (see FirstRunDashboardServiceRollbackSpec.scala:62 or the `PipelineRunRoutesSpec` constructions);
   - the test asserts apply returned `Right` before it calls the public `rollback`.

   Also state in D1 or C3 that a red result caused by a harness exception (NPE or failed future) is not "a real leak" and does not trigger the STOP.

2. **D3 contradicts D6(a).** D3 says that if the mid-flight Connector is not observable, "rely on D2 for non-vacuity". D6(a) requires D3 itself to go red when `removeUnadoptedConnector` is a no-op. The second is the right bar: only a red D3 under mutation (a) proves the route test actually created an Auto Connector through the production-wired `DataSourceService`, and that production wiring is the reason D3 exists. Remove the "otherwise rely on D2" fallback. State that D3's non-vacuity proof is its own red under mutation (a), and that D3 also asserts the combined response is the post-apply 422 (sentinel / zero Outputs), not a pre-apply 400.

### Non-blocking notes

1. The premise validation says "The only creator is the frontend `InlineConnectorSetup`". That is incomplete. An agent can also create an explicit Connector through MCP `create_connector` (`POST /api/connectors` or the HEL-955 pending flow via `ConnectorCompletionService.createOrRemintPending`) and then propose with that `connectorId`. These Connectors are also `implicit=false` and are kept on rollback, so the outcome is unchanged. Phrase the owner question in the PR as "a Connector created explicitly (by the user in the UI or by an agent via `create_connector`) for a proposal", not only the UI case.
2. D6(b): name the three owner-scoping layers explicitly (cleanup `findByIdOwned`, repo `delete`'s `findByIdOwned` at :295, the `owned` filter at :303). Record in red-evidence.md which ones had to be stripped before D5 went red. That the guard is layered is a finding worth stating, not hiding behind "if needed".
3. D2 and AC1: count credentials by `connector_credentials.user_id` (V92:17); the table has no `owner_id` column.
4. D7: the current scaladoc also mentions `response.source` (singular). The field is `response.sources`, so correct that too.
5. D5's "through a proposal `rollback` if constructible": apply with B's `connectorId` is rejected by `checkConnectorKind` (owner-scoped), so it is only constructible with a hand-built `PipelineProposalApplyResponse`. Say so, or drop it. The `DataSourceService.delete` variant is enough.
