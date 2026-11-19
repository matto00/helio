# Files modified (HEL-1786)

## Backend

- `backend/src/main/scala/com/helio/api/routes/dashboards/DashboardPanelStatusRoutes.scala` — new `GET /api/dashboards/:id/panel-status` route; dashboard ACL via `authorizeResourceWithSharing`, no share token.
- `backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardPanelStatusProtocol.scala` — write-only wire types built field by field (explicit `null`s); registered in `JsonProtocols.scala`.
- `backend/src/main/scala/com/helio/services/dashboards/DashboardPanelStatusService.scala` — resolver: 1 panel page, 1 Output batch, 1 pipeline batch, 1 history batch, per-pipeline latest real run + assertions once, provenance `sourcesFor`.
- `backend/src/main/scala/com/helio/services/pipelines/AssertionStatusRule.scala` — the one data-invalid rule, shared by the Output route and the new route.
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — `assertionStatus` now calls `AssertionStatusRule` (behaviour unchanged; it uses `latestNonDryRunInternal`, a `LIMIT 1` of the same ordering the old `listByPipelineInternal(...).find(!= dry_run)` used, so it no longer loads every retained run).
- `backend/src/main/scala/com/helio/services/pipelines/ProvenanceService.scala` — `sourcesFor` (batched) added; `forOutput` and `sourcesFor` share one private derivation (`orderedSourceIds`) and one naming step (`namedSources`). Deviation from design D1 wording ("`forOutput` itself calls `sourcesFor`"): `forOutput` already holds the steps/roots it needs for `nodePath`/assertions, so calling the batched method would re-read them; sharing the private derivation keeps exactly one derivation and mutation m9 bites both paths.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputHistoryRepository.scala` — `latestCapturedAtInternal` (one LATERAL `LIMIT 1` per Output, privileged pool).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala` — `findByIdsInternal` (batch, ACL-bypassing, after the dashboard ACL).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala` — `findByIdsInternal` (batch).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wiring only (import, service construction after `provenanceServiceOpt`, one route line).
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardPanelStatusRoutesSpec.scala` — new spec (own file, not an extension of `DashboardGranteePanelRoutesSpec`), as `helio_app_test` (NOBYPASSRLS), `TwoUserRlsApiFixture` users A/B/C.

- `backend/src/test/scala/com/helio/api/http/ExistenceNotLeakedRoutesSpec.scala` — one new table row (`GET dashboard panel-status`, site `DashboardPanelStatusRoutes.scala`): the spec's completeness guard fails any route file that calls `authorizeResourceWithSharing` without a row; the row also runs the stranger/unknown-id/owner-control probes against the new route. Found by the first `testFull` (1 failure of 10022), fixed, spec re-run green.

## Schemas / docs

- `schemas/dashboards/dashboard-panel-status-response.schema.json`, `dashboard-panel-status-item.schema.json` — `additionalProperties: false`; the item title equals the Scala case class `DashboardPanelStatusItem` (the schema-drift check matches on it).
- `CLAUDE.md` — one Key-endpoints bullet.

## Frontend

- `frontend/src/features/panels/services/panelStatusService.ts` — `fetchDashboardPanelStatus`.
- `frontend/src/features/panels/state/panelStatusStore.ts` — module-scoped, ref-counted poller per dashboard id (`PANEL_STATUS_POLL_MS = 15000`, visible-only, one in flight, failed read keeps the last snapshot, baseline never fires, trigger is `dataUpdatedAt` only); dropped on `onFreshnessReset` (logout) via `resetOutputFreshness`; the snapshot is also dropped when the last consumer leaves.
- `frontend/src/features/panels/state/dashboardMeta.ts` — `deriveDashboardMetaFromStatus`.
- `frontend/src/features/panels/hooks/usePanelStatus.ts` — `useSharedDashboardMeta`, `usePanelStatus`, `usePanelStatusRefresh`.
- `frontend/src/app/dashboardMeta/DashboardMetaRow.tsx`, `DashboardRefreshLine.tsx` — non-owner reads `useSharedDashboardMeta`; owner path unchanged; the phone line's `!isOwner` early return removed (reserved-slot rule applies to grantees).
- `frontend/src/features/panels/ui/PanelCardBody.tsx` — `usePanelStatusRefresh` in panel scope; also invalidates the per-panel provenance cache (`invalidateProvenance(publicProvenanceKey)`) and refreshes the per-panel history cache (`refreshHistory(publicHistoryKey, fetchPublicOutputHistory)`, only when that panel already holds a history entry). `handleFanoutRefresh` re-reads rows through `usePanelData.refresh` -> `fetchPublicPanelRows` in panel scope (proved by `PanelCardBody.statusRefresh.test.tsx`: no `getOutputRows`, no added `getOutputById`); `usePanelRunRefresh`'s `fetchOutputMeta` is not used in panel scope.
- `frontend/src/features/panels/ui/PanelCard.tsx`, `frontend/src/features/panels/provenance/PanelProvenance.tsx` — panel-scope badge from the status item; `PanelProvenance` no longer forces the badge off. `useDataInvalid`/`invalidBadge` sites grepped: `PanelCard.tsx` (the only caller of `useDataInvalid`; the phone stack and the detail modal render `PanelProvenance` with no badge for any role, unchanged), `ProvenanceTrigger.tsx` (renders it), `PanelProvenance.tsx`.
- `frontend/src/features/panels/ui/grid/MobilePanelStack.tsx` — in panel scope the registered pull/"Refresh dashboard" refresh also calls `refreshPanelStatusNow` (one in-flight read however many panels ask). The pull/button make no Output or pipeline request (e2e phone test, invariant window).

## New tests

- `e2e/hel1786-shared-dashboard-freshness.spec.ts`, `frontend/src/features/panels/state/dashboardMeta.fromStatus.test.ts`, `panelStatusStore.test.ts`, `frontend/src/app/dashboardMeta/DashboardFreshness.shared.test.tsx`, `frontend/src/features/panels/ui/PanelCard.sharedBadge.test.tsx`, `PanelCardBody.statusRefresh.test.tsx`.

## Intended assertion changes in existing tests (listed with the reason)

- `frontend/src/app/dashboardMeta/DashboardRefreshLine.test.tsx` — the HEL-1773 describe asserted "renders nothing for a viewer/editor": the line is now fed by the status route. Now asserts the owner hook is still given no panels and that the owner hook's facts are never shown to a non-owner; the rendered fact is in `DashboardFreshness.shared.test.tsx`.
- `e2e/hel1773-viewer-grantee-dashboard.spec.ts` — the viewer meta row asserted `toHaveText("2 panels")` (facts hidden); now asserts the panel count plus the refreshed fact and source from the status route (the file's zero-Output/pipeline-request invariant is unchanged and still applies).
- `DashboardMetaRow.roles.test.tsx`, `DashboardMetaRow.scopeSwitch.test.tsx`, `PanelCardBody.roles.test.tsx`, `PanelCard.panelScopeRefresh.test.tsx`, `PanelCard.firstDashboardTelemetry.test.tsx`, `PanelDetailModal.panelSwitch.test.tsx`, `PanelGrid.test.tsx`, `PanelGrid.unmountFlush.test.tsx`, `DesktopPanelGrid.processedWidth.test.tsx`, `MobilePanelStack.test.tsx`, `MobilePanelStack.pullRefresh.test.tsx`, `rawElementGuardHel440.test.tsx` — only a `jest.mock` of `panelStatusService` (never resolves): a panel or meta row on a dashboard the store does not hold fails closed to `panel` scope and now polls the status route, which the network guard refuses in a unit test. No assertion changed. `DashboardMetaRow.scopeSwitch.test.tsx` also re-sets that mock after its `resetAllMocks`. `MobilePanelStack.detailOrigin.test.tsx` mocks `usePanelReadScope` (that test renders the stack with no store).

## Design-gate claims re-verified (file:line at HEAD of this change)

- History is written in the SAME transaction as the node snapshot replace: `services/pipelines/PipelineRunSucceededWrites.scala:128-155` builds `OutputHistoryInsert`s for EVERY output on the node (`nodeOutputs`, no kind filter) and passes `historyAction` to `nodeSnapshotRepo.overwriteRowsWith(...)`; `infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:122-130` runs `overwriteRowsAction(...).andThen(andThen)` in one `withSystemContext` (`DbContext.scala:63-64` `.transactionally`).
- `pipelines.last_run_at` is written concurrently with, not after, those writes: `PipelineRunSucceededWrites.scala:260-264` (`updateMeta` -> `writeLastRun`) is one of the `siblings` at `:323` awaited together with `materializedWrites`.
- The inferred Output schema (`updateSchemaInternal`) is written after the snapshot+history transaction (`:157-165`), as design risk 5 says; the e2e's run-finish step adds a row, not a column.
- History points are written for every Output kind that has a node on a real successful run (no kind filter in that code). Only a `table` Output was exercised on a live real run (the e2e); `metric`/`chart` share the same code path (the kind only feeds `OutputSummaryReducer`). An `insight` Output's panel is not refreshed by rows in panel scope (design non-goal). Blocked runs (error-severity assertion failure) write no snapshot and no history point (`PipelineRunExecutor.scala:403`), so a blocked run does not refresh and leaves `invalid` true.
- `dataAsOf` is not read by any frontend component, so there is no per-panel "as of" label that could go stale (design-gate note 1).
- `OutputService.assertionStatus` keeps the `pipelineRunRepo == null` short-circuit (`invalid = false`); the status service does the same for a null `runRepo` (design-gate note 2).

## Known limits

- `invalid` has no seeded "unknown stored run status" case in the spec: the `pipelines.last_run_status` CHECK constraint only admits the stored values, so the `succeeded`/`failed`-else-`null` mapping's else-branch cannot be exercised from a real row; it is a defensive filter.
- Mutation m6 (grantee meta fed real panels to `useDashboardMeta`) is red in jest (`DashboardFreshness.shared.test.tsx` asserts neither `getPipelineById` nor `fetchOutputMeta` is called) but NOT in the e2e: in panel scope the Output-meta cache is scoped to the per-panel route and the stub has no pipeline id, so the mutated hook makes no `/api/outputs/` or `/api/pipelines/` request in the browser. The e2e's invariant is still the guard for the routes this change adds. (An earlier variant of m6 that also dropped the status-fed meta was red in the e2e at the fact assertion; both transcripts are kept.)
- Which pipeline ran last in the e2e is not fixed: a dataset write arms an auto-run (HEL-1093) that a blocked manual run does not cancel (HEL-1739). The freshness assertions (desktop meta row and phone caption) therefore derive the expected text ("refreshed " or "last run failed ") at assertion time from the owner's own view of both pipelines (`GET /api/pipelines/:id` `lastRunAt`/`lastRunStatus`, the latest wins), inside `expect.poll`. A wrong latest-item pick or status-to-intent mapping on the grantee side fails it. The single-pipeline `hel1773` e2e still asserts exactly `/refreshed/`.

## Full-path declarations (orchestrator, for squash-branch.sh)

Files above named only by basename or only in prose, declared by full path:

- `backend/src/main/scala/com/helio/api/JsonProtocols.scala`
- `frontend/src/app/dashboardMeta/DashboardMetaRow.roles.test.tsx`
- `frontend/src/app/dashboardMeta/DashboardMetaRow.scopeSwitch.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.firstDashboardTelemetry.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.panelScopeRefresh.test.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.roles.test.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.panelSwitch.test.tsx`
- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.processedWidth.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.detailOrigin.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.pullRefresh.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.test.tsx`
- `frontend/src/features/panels/ui/grid/PanelGrid.test.tsx`
- `frontend/src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx`
- `frontend/src/test/rawElementGuardHel440.test.tsx`
