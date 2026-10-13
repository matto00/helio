# Reachability of part 1 (design D5)

Question: can `buildLayoutPatch` receive a non-null `resolved` (panels counted as loaded) while the authored layout
holds an item for a LIVE panel absent from the panel list?

Paths in `frontend/src/features/panels/hooks/useLayoutSave.ts` unless noted.

- "Loaded" is `panelsStatus === "succeeded"` (`panels/ui/grid/DesktopPanelGrid.tsx:192`), read through `panelsRef`
  at save time (`useLayoutSave.ts` ~L257: `loaded ? resolveDashboardLayout(...) : null`).
- Outside the placement branch (see below), a layout naming unknown panels reaches the store through the layout effect's re-baseline branch
  (L226) or the post-save adoption (L293), both calling `refetchPanelsIfLayoutNamesUnknown` (L167-180). When loaded
  and an item names an unknown panel it dispatches `markDashboardPanelsStale` (L174), which in the same effect
  sets `status = "idle"` and `loadedDashboardId = null` (`panels/state/panelsSlice.ts` L174-177), then
  `fetchPanels` (`.pending` -> `"loading"`, L184). The stale/loading window is therefore never "loaded" for a
  save; `persistLayout` only runs from a timer/event/unmount flush, after the effect.
- Other writer's layout (409 rebase, `dashboardUpserted` at `dashboardsSlice.ts` L226/L410): arrives as a store
  layout change, so the same effect runs (L226) before any save.
- Placement/interaction/undo branches (L187-225) do not call the refetch. The placement branch
  (`detectPlacementExtension`) accepts ANY "previous layout plus appended ids" without refetching panels, so it can
  admit another writer's unseen item in a race: e.g. a save in flight, the user undoes back to the baseline, another
  writer has added panel P, the rebase fails and the re-sync appends P (evaluation-1, skeptic-final-1). This depends
  on timing, like the residual below; no deterministic live path was found, and the shipped `buildLayoutPatch` fix
  keeps P's item in that case too.
- Panel deleted here/elsewhere: `deletePanel.fulfilled` filters `items` only (`panelsSlice.ts` L227-228), so the
  authored layout keeps a GHOST item while `status` stays `"succeeded"`. That is reachable, but a ghost is a deleted
  panel's item, not a live unloaded one; the server drops it (design D2).
- Residual: a cross-writer request race (panel list read before another writer's panel commits, layout read after
  it) could yield a "succeeded" list lacking a live panel the layout names. This needs timing across two writers
  and requests; there is no deterministic repro and none was invented.

Finding: part 1 has no deterministic live path (consistent with the ticket). It is pinned by the
`buildLayoutPatch` unit tests (`layoutPatch.test.ts`), whose "keeps an unloaded panel's authored item" test fails on
the pre-fix file (`red-evidence.txt`). No hook-level test is added (D5: not reachable).
