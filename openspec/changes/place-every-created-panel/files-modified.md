Base: `f09ba92f` (resolved live via `scripts/concertino/resolve-review-base.sh`); all changes are in the single HEL-1260 commit.

### Backend (production)
- `backend/src/main/scala/com/helio/services/panels/CreatePlacement.scala` — NEW: the one pure placer (`CreatePlacement.append`, `duplicateSizes`) plus `ItemSize`/`PlacementSizes` (content default 4/4/3/2 x 5, `scaledFromLg`)
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelLayoutPlacement.scala` — NEW: dashboard row `FOR UPDATE` lock, then the panel insert, then the layout/last_updated-only UPDATE, in the caller's transaction (lock-before-insert is load-bearing: insert-first deadlocked two concurrent creates, found by the concurrency test)
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelMutationRepository.scala` — `insertPlaced` (single create, `withUserContext(caller)`), `duplicate` now places (system tx), `insertBatchPlaced` replaces `insertBatch` (system tx)
- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — create/batchCreate/duplicate place every kind; `defaultSizesFor` replaces `placeDefaultLayout` (no more `dashboardRepo.update` stale read); return types now carry `PlacedLayouts`
- `backend/src/main/scala/com/helio/api/routes/panels/PanelRoutes.scala` — create, batch items and duplicate return `layout`/`layouts` via `placedResponse`
- `backend/src/main/scala/com/helio/api/protocols/panels/PanelProtocol.scala` — doc comments only
- `backend/src/main/scala/com/helio/services/proposals/ProposalLayoutSupport.scala` — `buildLayout` appends unauthored panels below the authored lg before reflow
- `backend/src/main/scala/com/helio/services/proposals/DashboardProposalService.scala` — carries each created panel's lg size into `buildLayout`
- `backend/src/main/scala/com/helio/services/dashboards/DashboardLayoutRepair.scala` — act on stored-bad OR incomplete; stored-bad precedence; append-only (first stored entry per live id) for incomplete-only
- `backend/src/main/scala/com/helio/services/panels/README.md`, `backend/src/main/scala/com/helio/infrastructure/persistence/panels/README.md` — mention the new files
- `schemas/panels/panel.schema.json` — `layout`/`layouts` descriptions: all create paths, not output-only

### Frontend (production)
- `frontend/src/features/dashboards/state/repairPatch.ts` — `hasRepairableBreakpoint(panels, layout)` (stored-bad OR incomplete); `buildRepairPatch` includes incomplete breakpoints; replaces `hasStoredBadBreakpoint`
- `frontend/src/features/panels/hooks/useStoredLayoutRepair.ts` — uses the widened predicate; owner/panels-loaded/once-per-mount guards unchanged
- `frontend/src/features/panels/state/panelPlacement.ts` — NEW: shared `adoptPlacedLayouts` (used by createPanel and duplicatePanel; runs before the panel refetch)
- `frontend/src/features/panels/state/panelThunks.ts` — createPanel uses the helper; duplicatePanel now adopts `layouts`
- `frontend/src/features/panels/hooks/useLayoutSave.ts` — header only: class 3 covers create or duplicate; class 4 repair paragraph rewritten
- `frontend/src/features/dashboards/README.md`, `frontend/src/features/layout/README.md` — wording

### Tests and fixtures
- `backend/src/test/scala/com/helio/api/routes/panels/PanelCreatePlacementSpec.scala` — NEW (route spec over the RLS pool): every kind, sizes, batch, rejected batch, duplicate (3 size rules), proposal, concurrency, RLS posture + editor/viewer/stranger, dashboard duplicate/import orphan then repair
- `backend/src/test/scala/com/helio/api/routes/panels/PanelCreateSeamSpec.scala` + `shared-test-fixtures/layout-create-seam.json` + `frontend/src/features/dashboards/state/layoutCreateSeam.test.ts` — NEW seam (C2): stored layout after every create path equals the fixture, re-sent through the real layout PATCH returns 200; client validity/stability/no-op patch; create under a pending local drag
- `backend/src/test/scala/com/helio/services/panels/CreatePlacementSpec.scala` — NEW unit spec of the placer
- `backend/src/test/scala/com/helio/services/panels/PanelServiceDefaultLayoutSpec.scala` — INVERTED: the old "return None for a non-Output panel and never write the dashboard layout" test encoded the bug (the PR should say so); now asserts the content default size per breakpoint. The suite is re-pointed at `insertPlaced` (the atomic repository write replaced `dashboardRepo.update`)
- `backend/src/test/scala/com/helio/services/panels/PanelServiceOutputControlsSpec.scala` — stub moved from `panelRepo.insert`/`dashboardRepo.update` to `insertPlaced`
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardLayoutRepairRoutesSpec.scala` — incomplete append, empty-bp fill, move rejected 400, stored-bad precedence, second call no-op, editor 403
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardLayoutRepairSeamSpec.scala` + `shared-test-fixtures/layout-repair-seam.json` — fixture gains an incomplete case; existing cases' `expectedRepair` now also carry md/sm that were merely empty (client output regenerated, server accepts all 6); spec asserts stored items survive for incomplete-only breakpoints
- `backend/src/test/scala/com/helio/api/routes/proposals/ApplyProposalSpecBase.scala` — `appPoolRlsPosture()` helper
- `backend/src/test/scala/com/helio/api/routes/panels/AutoLayoutRouteSpec.scala` — "400 for a panelId not on the dashboard, no persistence": precondition changed (create now stores p1's item), asserts unchanged instead of empty (3.6)
- `backend/src/test/scala/com/helio/api/routes/panels/FormPanelRoundTripSpec.scala` — "layout is null/absent for a form panel" encoded the bug; now asserts the 4x5 placement and `layouts` (3.6)
- `frontend/src/features/dashboards/state/repairPatch.test.ts` — NEW (0.6)
- `frontend/src/features/panels/state/panelThunks.duplicate.test.ts` — NEW: duplicate adopts `layouts`
- `frontend/src/features/panels/ui/grid/PanelGrid.storedLayoutRepair.test.tsx` — fixtures made complete (md/sm/xs) so only xs is repairable; new orphan class 3, stale-entry class 4, pending-edit cases (3.5a)
- `e2e/hel1023-breakpoint-layout-derivation.spec.ts` — `stubOwnerRepair` also applied to A_lg_only/B_partial (3.7); seeding still yields lg-only/partial (A/B re-PATCH to empty arrays; observed passing)
- `e2e/hel1260-orphan-owner-repair.spec.ts` — NEW (3.8/3.11): one repair POST for an orphaned text panel and stable position across reload, plus UI text-panel create stores four items, in light and dark
- `openspec/changes/place-every-created-panel/` — tasks.md ticked, red-evidence.md, files-modified.md
