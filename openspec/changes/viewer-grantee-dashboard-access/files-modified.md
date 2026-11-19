# HEL-1773 child 1 -- files modified

Base: 5f137cb5f (resolved live with `resolve-review-base.sh`). No migration (V147 unused).

## Backend

- `backend/.../infrastructure/persistence/dashboards/DashboardRepository.scala` -- `findAllVisiblePaged(userId, page)` replaces the dead `findAllVisible`: one left join on the caller's own named grant (no union), role computed in SQL/Scala (`owner` when `owner_id` is the caller, else the grant's role), public grants (null grantee) never match, count and slice over the same query.
- `backend/.../services/dashboards/DashboardService.scala` -- `findAllWithPipelineFedFlag(user, page, includeShared)` returns `DashboardListItem(dashboard, hasPipelineFedPanels, accessRole)`; `findAll` (assistant, search) stays owner-only.
- `backend/.../api/routes/dashboards/DashboardRoutes.scala` -- `GET /api/dashboards?include=shared` (opt-in; any other value `400`); create/duplicate/layout-repair responses carry `accessRole: "owner"`.
- `backend/.../api/protocols/dashboards/DashboardProtocol.scala` -- `DashboardResponse.accessRole: Option[String]` (+ `withRole`).
- `schemas/dashboards/dashboard.schema.json`, `helio-mcp/src/types.ts` -- optional `accessRole`.
- Tests: `DashboardSharedListRoutesSpec` (new: list roles, self-grant listed once, paging/count over the union, default unchanged, `400`, schema seam, RLS transcript as `helio_app_test`), `DashboardPanelAclSpec` (the `findAllVisible` cases moved to `findAllVisiblePaged`).

## Frontend

Role core: `features/dashboards/state/dashboardAccess.ts` (role rule, selectors, `isKnownNonOwnedDashboard`), `dashboardAccessContext.tsx` (role provided by `PanelList` to every panel component), `types/dashboard.ts` (`accessRole`), `dashboardsSlice.ts` (preserve helper `withKnownFlag` carries `accessRole`; landing is the newest OWNED dashboard), `dashboardService.ts` (`include=shared`; `includeShared:false` for the dev patch-set demo, `PatchSetReviewPage.tsx`).

## Decisions where the design let me choose

1. **Rows path: branch, not reuse.** `fetchPanelPage` (panelThunks.ts) branches to `fetchPublicPanelRows(dashboardId, panelId, undefined, ...)` for a panel on a known-non-owned dashboard, mapped to the same page shape, so the whole existing pagination/`usePanelData`/detail-modal row sharing is unchanged (no third rows path, no new hook). `materialized` is reported `true` (the route carries no flag), so a grantee never gets a "Run pipeline" CTA. No sort/filter/cross-filter is sent.
2. **`useOutputMeta` gate point: ONE seam in `outputMetaCache.fetchOutputMeta`** (not at each of the mount sites). `fetchPanels` registers each Output of a non-owned dashboard to a `(dashboardId, panelId)` scope (`scopeOutputToPanel`) and clears it for an owned dashboard (`unscopeOutput`); `fetchOutputMeta` then reads `.../panels/:p/output-meta` and rebuilds an `Output` with `ownerId: ""` and `pipelineId: ""` (so `TableRenderer.canWrite` is false and nothing registers a pipeline). `usePanelCardInspect`, `PanelCardBody`, `OutputPanelContent`, `usePanelRunRefresh`, `useDashboardMeta`, the modal and `OutputControlsEditor` all go through it. **m8b reverts exactly this seam.** Limitation: an Output bound on both an owned and a shared dashboard is read through whichever dashboard's panels loaded last.
3. **Public `output-meta` NOT widened**: the editor's binding is a generic read-only "Bound to an Output" line.
4. **`dashboard-changes` coverage for shared ids**: not changed. The route reads under the caller's RLS, so a shared dashboard's `contentUpdatedAt` is returned (dashboards/panels are grant-visible) while its Output `dataUpdatedAt` is not (outputs are not): the open-tab dot and Home "changed" count can see edits, never new data, on a shared dashboard. Not exercised by the e2e (`useChangedDashboardIds` request returned 200 in the invariant window). Child 6 per the plan.
5. **Onboarding**: the checklist's "make a dashboard" step counts OWNED dashboards, but auto-activation (and `PanelList`'s zero-dashboards empty state) still key on an EMPTY list: for a user whose only dashboards are shared, the checklist/drop zone would otherwise cover (and fetch sources and pipelines under) the shared dashboard they just opened. Deviation from the literal D0 text, deliberate.
6. **Fail-closed rule exception**: an item with NEITHER `accessRole` NOR `ownerId` (a hand-built fixture; the server always sends `ownerId`) reads as `owner`; with a different `ownerId`, or not in the store, it is a viewer. Without it ~40 existing component suites that build dashboards by hand lose every control.
7. `PatchSetReviewPage` (dev-only demo) keeps the owner-only list (`includeShared: false`).

## Affordance and gate list (D5/D6; every gate reads `dashboardAccess` selectors or the `PanelList` context)

| Affordance / consumer | File | Viewer | Editor | Owner |
|---|---|---|---|---|
| Edit layout toggle, Undo/Redo/Tidy | `app/dashboardMeta/DashboardMetaRow.tsx`; `DesktopPanelGrid.tsx` (`isEditingLayout = canEdit && state`) | hidden | shown | shown |
| Add panel (meta row, CommandBar kebab, empty state, palette via `useCreatePanelAction`) | `DashboardMetaRow.tsx`, `CommandBar.tsx`, `PanelList.tsx`, `useCreatePanelAction.tsx` | hidden/disabled | shown | shown |
| Refine with AI (kebab) | `DashboardMetaRow.tsx`, `CommandBar.tsx` | hidden | shown | shown |
| Dashboard appearance editor | `DashboardMetaRow.tsx`, `CommandBar.tsx` | hidden | shown | shown |
| Share (meta row, kebab, sidebar, phone sheet) | `DashboardMetaRow.tsx`, `DashboardList.tsx`, `app/MobileShell.tsx` | hidden | hidden | shown |
| "Ask about this dashboard" (button, kebab) | `DashboardMetaRow.tsx`, `CommandBar.tsx` | hidden | hidden | shown (child 3 enables) |
| Dashboard kebab itself | same | hidden when empty | shown | shown |
| Sidebar row menu | `DashboardList.tsx` | none | Rename, Export | all (Duplicate, Share, Move to..., Delete owner-only) |
| Layout repair | `useStoredLayoutRepair.ts` (already owner-gated by `ownerId`) | never | never | yes |
| Panel card menu | `PanelCardHeader.tsx` | View details, Inspect | Rename, Customize, Duplicate, Delete | same as editor |
| Panel move handle | `PanelCardHeader.tsx` | hidden | shown | shown |
| Detail modal: Edit button, `E` key, `initialMode="edit"` | `PanelDetailModal.tsx`, `usePanelDetailEditState.ts` | no edit mode | edit | edit |
| Detail modal binding section | `PanelDetailModal.tsx` | n/a | read-only "Bound to an Output" | `OutputPanelSection` |
| `OutputControlsEditor` (skeptic note 2; save tolerates the missing ref: `activeEditorRef()?.current?.reset()`) | `PanelDetailModal.tsx` | n/a | hidden | shown |
| Form panel submit | `FormRenderer.tsx` ("Only the owner can submit this form") | note | note | form |
| Provenance trigger (card, stack, modal header, fullscreen) | `PanelCard.tsx`, `MobilePanelStack.tsx`, `PanelDetailModal.tsx`, `PanelFullscreenOverlay.tsx` | hidden | hidden | shown |
| Data-invalid badge (`useDataInvalid`) | `PanelCard.tsx` | not mounted | not mounted | shown |
| Run-event refresh (`usePanelRunRefresh`) | `PanelCardBody.tsx` (passes `null`) | off | off | on |
| Freshness line / facts (`useDashboardMeta`, meta row and phone refresh line) | `DashboardMetaRow.tsx`, `DashboardRefreshLine.tsx` (given no panels; line hidden) | off (panel count kept) | off | on |
| Viewer controls bar, distinct values, server sort/filter hand-off, filter capabilities, cross-filter | `PanelCardBody.tsx`, `usePanelDetailData.ts`, `PanelFullscreenOverlay.tsx`, `useCrossFilterServerOps.ts` | off (table sorts loaded rows on the client) | off | on |
| History / compare (`useOutputHistory`) | `history/useOutputHistory.ts` (public source unaffected) | off | off | on |
| Insight body (`usePipelineOwnership` unmounted with it) | `insight/InsightPanelBody.tsx` ("Not available on shared dashboards yet") | neutral | neutral | body |
| Table column persist (`canWrite`) | `outputMetaCache.ts` rebuilds `ownerId: ""` | false | false | owner only |
| Warm tab cache capture/restore | `warm/warmCapture.ts`, `warm/showDashboardPanels.ts` | skipped | skipped | on |
| Folder move | `DashboardList.tsx` | hidden | hidden | shown |

List surfaces (D7), "Shared" marker, accessible name `"<name> (Shared)"` on the sidebar row and phone chip: `DashboardList.tsx`, `DashboardChipRow.tsx`, Home shelf (`DashboardShelf.tsx` via `HomePage.tsx`; counted in "All N"), phone sheet (`usePickerSelection.ts` subtitle "Shared"), palette (`useResourceSearchActions`, `useRecentPaletteActions`, `useOpenTabActions`: subtitle "Shared"). Owned-only: default landing (`dashboardsSlice` `getMostRecentDashboardId`), onboarding step counts. The tab bar needs no marker.

Not changed on purpose: `PatchSetReviewPage` demo list (owner-only), the palette's Output indexing (`GET /api/outputs`, only when the palette opens), the editor's "Add panel" Output picker (an explicit action outside the measured window).

## e2e

`e2e/hel1773-viewer-grantee-dashboard.spec.ts` -- seven tests: landing (own dashboard, not a newer shared one), viewer (opens, Output panel rows first, then the widened invariant with sidebar "Shared", no editing control, panel menu, detail view with `E`), Home shelf marker, viewer on a phone, editor (rename + Customize save persist, binding read-only, sidebar menu, same invariant), owner unchanged, stranger not found. Related specs re-run green (C15): hel1003, hel1583-mobile-dashboard, hel1746-ask-ui, hel1260, hel1575-dashboard-tabs (68 passed); greps in `.concertino/scratch/HEL-1773/c15-e2e-grep.txt` (no existing spec reads any new name; the only altered shared selector is `.dashboard-chip` display, covered by the re-run).

## Cycle 2 (evaluation-1 CR1): panel-scoped Output metadata never reaches an owned dashboard

- `frontend/src/features/panels/state/outputMetaCache.ts` -- every cache entry records the route it came from (`scoped`). An entry is served, shared or reused only while `entry.scoped === panelScopes.has(outputId)`, so `scopeOutputToPanel` / `unscopeOutput` can never let an owned dashboard render a per-panel stub (nor a shared one an owner's copy); a scope change makes the next `fetchOutputMeta` refetch through the right route. `peekOutputMeta` (the warm capture's read) returns nothing for a scoped entry, so a stub is never persisted; `seedOutputMeta` marks restored copies unscoped.
- `frontend/src/features/dashboards/tabs/warm/showDashboardPanels.ts` -- `restoreFromMemory` clears the scope of every restored panel's Output (a restore never reaches `fetchPanels`, where the owner path does it).
- `frontend/src/features/panels/state/outputMetaCache.scope.test.ts` -- (a) x2 cache, (b) warm restore, (c) capture; all four red on 3f8202cf2 (`cr1-red.txt`), green after (`cr1-green.txt`).

## Cycle 3 (evaluation-2 CR1): no Output metadata kept from a previous dashboard's read scope

- `frontend/src/app/dashboardMeta/DashboardMetaRow.tsx` -- (c): the meta row feeds `useDashboardMeta` only panels that BELONG to the selected dashboard (`panelsSettledFor`), not `loadedDashboardId` alone. `fetchPanels.pending` marks the new dashboard loaded while `items` still hold the previous dashboard's panels; feeding them let the hook keep the previous scope's stub in local state (`outputKey` never changed, so it never re-read).
- `frontend/src/features/panels/state/outputMetaCache.ts` -- a request whose cache entry was superseded (`cache.get(outputId) !== entry`) no longer writes `entry.value`.
- Tests: `DashboardMetaRow.scopeSwitch.test.tsx` (the evaluator's scenario; red on b097d0b95 at `getPipelineById("P")`: `cr2-red.txt`, green `cr2-green.txt`); e2e `editor: switching from a shared dashboard to an owned one binding the same Output shows its facts` (red on b097d0b95 with "1 panel": `cr2-e2e-red.txt`; green `cr2-e2e-green.txt`).
- Audit of every other holder of Output meta in local state across a dashboard switch:
  - `DashboardRefreshLine` -- already selects panels with `panelsKnownFor` (items must belong to the selected dashboard), so it never sees the previous dashboard's panels: ruled out.
  - `useOutputMeta` (used by `usePanelCardInspect`, `PanelCardBody`, `OutputPanelContent`, `usePanelRunRefresh`, `OutputPanelSection`, `OutputControlsEditor`) -- initial state is read from the route-aware cache at mount and every consumer is a per-panel component keyed by panel id, so a dashboard switch unmounts the old cards and mounts new ones after `fetchPanels` has set the scope: ruled out.
  - `useCrossFilterServerOps` / `usePanelSortFilter` -- derive from the `output` their card holds (above): ruled out.
  - Only `useDashboardMeta` held meta in hook state across a switch, with panels passed in by a host that could pass a previous dashboard's: fixed at the host.

## Declared paths

- `backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardProtocol.scala`
- `backend/src/main/scala/com/helio/api/routes/dashboards/DashboardRoutes.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/dashboards/DashboardRepository.scala`
- `backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardPanelAclSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardSharedListRoutesSpec.scala`
- `e2e/hel1773-viewer-grantee-dashboard.spec.ts`
- `frontend/src/app/CommandBar.test.tsx`
- `frontend/src/app/CommandBar.tsx`
- `frontend/src/app/MobileShell.shared.test.tsx`
- `frontend/src/app/MobileShell.tsx`
- `frontend/src/app/dashboardMeta/DashboardMetaRow.roles.test.tsx`
- `frontend/src/app/dashboardMeta/DashboardMetaRow.scopeSwitch.test.tsx`
- `frontend/src/app/dashboardMeta/DashboardMetaRow.tsx`
- `frontend/src/app/dashboardMeta/DashboardRefreshLine.test.tsx`
- `frontend/src/app/dashboardMeta/DashboardRefreshLine.tsx`
- `frontend/src/features/commandPalette/sharedDashboardPalette.test.tsx`
- `frontend/src/features/commandPalette/useOpenTabActions.ts`
- `frontend/src/features/commandPalette/useRecentPaletteActions.ts`
- `frontend/src/features/commandPalette/useResourceSearchActions.ts`
- `frontend/src/features/dashboards/services/dashboardService.shared.test.ts`
- `frontend/src/features/dashboards/services/dashboardService.ts`
- `frontend/src/features/dashboards/services/publicDashboardService.ts`
- `frontend/src/features/dashboards/state/dashboardAccess.test.ts`
- `frontend/src/features/dashboards/state/dashboardAccess.ts`
- `frontend/src/features/dashboards/state/dashboardAccessContext.tsx`
- `frontend/src/features/dashboards/state/dashboardsSlice.accessRole.test.ts`
- `frontend/src/features/dashboards/state/dashboardsSlice.ts`
- `frontend/src/features/dashboards/tabs/warm/showDashboardPanels.ts`
- `frontend/src/features/dashboards/tabs/warm/warmCapture.ts`
- `frontend/src/features/dashboards/tabs/warm/warmNonOwner.test.ts`
- `frontend/src/features/dashboards/types/dashboard.ts`
- `frontend/src/features/dashboards/ui/DashboardChipRow.css`
- `frontend/src/features/dashboards/ui/DashboardChipRow.shared.test.tsx`
- `frontend/src/features/dashboards/ui/DashboardChipRow.tsx`
- `frontend/src/features/dashboards/ui/DashboardList.css`
- `frontend/src/features/dashboards/ui/DashboardList.sharedRole.test.tsx`
- `frontend/src/features/dashboards/ui/DashboardList.tsx`
- `frontend/src/features/home/ui/DashboardShelf.test.tsx`
- `frontend/src/features/home/ui/DashboardShelf.tsx`
- `frontend/src/features/home/ui/HomePage.css`
- `frontend/src/features/home/ui/HomePage.tsx`
- `frontend/src/features/onboarding/hooks/useOnboardingHost.ts`
- `frontend/src/features/onboarding/ui/OnboardingChecklist.test.tsx`
- `frontend/src/features/onboarding/ui/OnboardingChecklist.tsx`
- `frontend/src/features/panels/history/useOutputHistory.roles.test.tsx`
- `frontend/src/features/panels/history/useOutputHistory.ts`
- `frontend/src/features/panels/hooks/useCreatePanelAction.test.tsx`
- `frontend/src/features/panels/hooks/useCreatePanelAction.tsx`
- `frontend/src/features/panels/hooks/useCrossFilterServerOps.ts`
- `frontend/src/features/panels/insight/InsightPanelBody.roles.test.tsx`
- `frontend/src/features/panels/insight/InsightPanelBody.tsx`
- `frontend/src/features/panels/state/outputMetaCache.scope.test.ts`
- `frontend/src/features/panels/state/outputMetaCache.ts`
- `frontend/src/features/panels/state/panelThunks.nonOwner.test.ts`
- `frontend/src/features/panels/state/panelThunks.ts`
- `frontend/src/features/panels/ui/PanelCard.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.roles.test.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.tsx`
- `frontend/src/features/panels/ui/PanelCardHeader.roles.test.tsx`
- `frontend/src/features/panels/ui/PanelCardHeader.tsx`
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx`
- `frontend/src/features/panels/ui/PanelList.test.tsx`
- `frontend/src/features/panels/ui/PanelList.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.binding.css`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.roles.test.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx`
- `frontend/src/features/panels/ui/detailModal/usePanelDetailData.ts`
- `frontend/src/features/panels/ui/detailModal/usePanelDetailEditState.ts`
- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx`
- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.viewerRole.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.tsx`
- `frontend/src/features/panels/ui/renderers/FormRenderer.roles.test.tsx`
- `frontend/src/features/panels/ui/renderers/FormRenderer.tsx`
- `frontend/src/features/panels/ui/renderers/TableRenderer.scopedOutput.test.tsx`
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx`
- `frontend/src/shared/chrome/usePickerSelection.ts`
- `frontend/src/test/renderWithStore.tsx`
- `helio-mcp/src/types.ts`
- `schemas/dashboards/dashboard.schema.json`
