# Files modified — HEL-548

## Section 1 — `staleDashboardId` discriminator (D1)

- `frontend/src/features/panels/state/panelsSlice.ts` — adds `staleDashboardId` and `panelCreationModalOpen` to `PanelsState`; `markDashboardPanelsStale` records the invalidated dashboard id, `fetchPanels.pending` clears it; adds the `setPanelCreationModalOpen` action.
- `frontend/src/features/panels/state/panelsSlice.test.ts` — locks D1's reducer behavior and D2's `fetchPanels` `condition` premise (task 1.5/1.6); threads the two new fields through one pre-existing raw-state test literal (task 1.4a).
- `frontend/src/test/renderWithStore.tsx` — threads `staleDashboardId`/`panelCreationModalOpen` through the shared test-store builder (task 1.4).
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx` — threads the two new fields through its own raw-state literal (task 1.4a).

## Section 2 — panel area's terminal blank + pre-dispatch frame (D2)

- `frontend/src/features/panels/ui/PanelList.tsx` — widens `showPanelGridSkeleton` to admit the pre-dispatch `idle` frame (gated by `staleDashboardId`), and widens the "No panels yet" gate to admit the post-delete terminal state.
- `frontend/src/features/panels/ui/PanelList.test.tsx` — inverts HEL-528's D11 locking test (D2a, commented), adds the pre-dispatch-frame skeleton test.

## Section 3 — HEL-770 absorbed: real message, two conforming surfaces, then the toast (D6, D6a)

- `frontend/src/features/dashboards/state/dashboardsSlice.ts` — `createDashboard`'s `catch` now calls `extractErrorMessage` instead of a fixed string.
- `frontend/src/features/dashboards/hooks/useCreateDashboardAction.tsx` (new) — the create-action seam; owns `isPending`/`error`, moved from `PanelList`'s old `handleCreateDashboard`.
- `frontend/src/features/dashboards/hooks/useCreateDashboardAction.test.tsx` (new).
- `frontend/src/features/panels/ui/PanelList.tsx` — dashboards-empty branch renders conditionally: `intent="error"` (TriangleAlert, "Couldn't create dashboard", the hook's message) when `error !== null`, else the unchanged neutral hero.
- `frontend/src/features/panels/ui/PanelList.test.tsx` — failed-create (error empty state) and neutral-stays-neutral tests.
- `frontend/src/features/dashboards/ui/DashboardList.tsx` — create-catch binds the thunk's payload; `<InlineError variant="banner">` (role="alert" + icon) instead of the bare-text default.
- `frontend/src/features/dashboards/ui/DashboardList.test.tsx` — failed-create banner test, plus the new filter-empty tests (section 6).
- `frontend/src/features/toasts/state/toastListeners.ts` — removes the `createDashboard.rejected` `ERROR_TOASTS` entry (commented).
- `frontend/src/features/toasts/state/toastListeners.test.ts` — removes that one regression-guard assertion (commented, HEL-535/HEL-548 ownership noted) and adds a dedicated "no longer toasts" test.

## Section 4 — the create-action seam (D5, D5a, D5b)

- `frontend/src/shared/ui/EmptyState.tsx` — exports `EmptyStateCta` (type-only; the primitive's rendering/props are otherwise untouched).
- `frontend/src/features/panels/state/panelsSlice.ts` — `panelCreationModalOpen` field + `setPanelCreationModalOpen` action (D5a lift), see Section 1.
- `frontend/src/features/panels/ui/PanelList.tsx` — modal open state moves from local `useState` to the Redux flag; unmount cleanup effect resets it (D5a); header "Add panel" and the "No panels yet" CTA both consume `useCreatePanelAction()`.
- `frontend/src/features/panels/ui/PanelList.test.tsx` — unmount/remount-does-not-reopen-the-modal test (D5a, reproduced against the unfixed effect first).
- `frontend/src/features/panels/hooks/useCreatePanelAction.tsx` (new), `.test.tsx` (new).
- `frontend/src/features/sources/hooks/useAddSourceAction.tsx` (new), `.test.tsx` (new).
- `frontend/src/features/pipelines/hooks/useCreatePipelineAction.tsx` (new), `.test.tsx` (new).
- `frontend/src/features/sources/ui/SourcesPage.tsx` — consumes `useAddSourceAction()` for the empty-state CTA.
- `frontend/src/features/pipelines/ui/PipelinesPage.tsx` — consumes `useCreatePipelineAction()` for `PipelineEmptyState`'s CTA.
- `frontend/src/features/pipelines/ui/PipelineEmptyState.tsx` — icon converted to lucide `GitBranch`/`Plus` (D8), `cta` unchanged in shape.

## Section 5 — Type Registry CTAs (D4, D4a)

- `frontend/src/features/dataTypes/ui/TypeRegistryBrowser.tsx` — main-content empty state gains `cta` from `useCreatePipelineAction()`; icon converted to lucide `Layers`.
- `frontend/src/features/dataTypes/ui/TypeRegistryPage.test.tsx` — CTA + no-create-type-path test.
- `frontend/src/shared/chrome/SidebarItemList.tsx` — adds `emptyCta` prop (consumed only by the no-data branch), widens `emptyIcon` to `IconDefinition | ReactNode`.
- `frontend/src/shared/chrome/SidebarItemList.test.tsx` — `emptyCta`-wins-over-`onAdd` and fallback-to-`onAdd` tests.
- `frontend/src/shared/chrome/SidebarBody.tsx` — wires `emptyCta={createPipelineAction.cta}` on the Data Types section only; converts Sources/Pipelines/Data Types `emptyIcon`s to lucide (D8), leaves Metrics/Assistant on FontAwesome (D8 fence).
- `frontend/src/shared/chrome/SidebarBody.test.tsx` — registry empty-state CTA + no-header-"+" tests.

## Section 6 — filter-empty as a distinct state (D3)

- `frontend/src/features/dashboards/ui/DashboardList.tsx` — filter-to-zero branch renders `EmptyState variant="sidebar"` (SearchX, "No matches", query-quoting description, "Clear filter" cta) instead of the bare `<p>`.
- `frontend/src/features/dashboards/ui/DashboardList.tsx` / `.css` — filter-clear icon converted to lucide `X` (+ sizing rule).
- `frontend/src/shared/chrome/SidebarItemList.tsx` — same treatment in `renderEmpty()`'s filtered branch (shared by all five sidebar sections); filter-clear icon converted to lucide `X`.
- `frontend/src/shared/chrome/SidebarItemList.test.tsx` — filtered-state + clear-restores tests.
- `frontend/src/features/panels/ui/creationSteps/DataTypeSelectStep.tsx` — filtered branch becomes `EmptyState variant="sidebar"`, keeping its existing query-quoting copy; no-data hero icon converted to lucide `Layers`; filter-clear icon converted to lucide `X`.
- `frontend/src/features/panels/ui/creationSteps/DataTypeSelectStep.test.tsx` — filtered-state, clear-restores, and no-data-still-shows-pipeline-guidance tests.
- `frontend/src/features/panels/ui/PanelCreationModal.css` — sizing rule for the converted filter-clear icon; removes the now-dead `.panel-creation-modal__datatype-no-match` rule.

## Section 7 — icons and tokens (D8, D7)

- Covered by the files above (lucide conversions on the five sections' empty-state ladders + the four named sibling controls: `PanelList.tsx`'s header add-panel, and the three filter-clear buttons). No new CSS added to `EmptyState.css` (untouched). `.dashboard-list__filter-clear svg` / `.panel-list__add svg` / `.panel-creation-modal__datatype-filter-clear-icon` sizing rules added (`width/height: 1em`, matching `InlineError.css`'s established pattern for a bare, non-self-sizing lucide `<svg>`).

## Section 9 — gates / openspec

- `openspec/changes/empty-state-ctas-primary-sections/tasks.md` — all 67 tasks marked complete.
- `openspec/changes/empty-state-ctas-primary-sections/files-modified.md` (this file).

## Cycle 2 — skeptic final-gate round 1 CR1 (glyph parity on `SidebarItemList`'s `onAdd` fallback)

- `frontend/src/shared/chrome/SidebarItemList.tsx` — `renderEmpty()`'s `onAdd` fallback CTA descriptor now carries `icon: <Plus />`, matching the explicit `emptyCta` path (Data Types) and `DashboardList`'s own `EmptyState`. Fixes the "same action, two glyphs, one screen" defect on `/pipelines` and `/sources` (sidebar CTA bare, main CTA glyphed). Lands on all five sidebar sections that reuse this fallback; touches no `emptyIcon`, so D8's Metrics/Assistant hero exclusion is unaffected.
- `frontend/src/shared/chrome/SidebarItemList.test.tsx` — new test asserting the fallback CTA (`onAdd` path) renders a leading `<svg>` icon, locking the glyph parity in place.
