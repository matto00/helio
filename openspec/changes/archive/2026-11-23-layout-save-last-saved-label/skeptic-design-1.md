## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD e3eda3eda28683075c616a0ebd9935ad4c89b9f9 (planning artifacts untracked in the change dir).

### What I verified (with evidence)
- Spawn guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/layout-save-last-saved-label/HEL-1657`.
- `SaveStateIndicator.tsx:17` reads `state.panels.lastSavedAt`; label at `:37`; dirty = pending panel updates OR
  `dashboards.hasPendingLayout` (`:20`). Confirmed.
- `panelsSlice.ts:359` (`updatePanelsBatch.fulfilled`) is the only non-null writer of `lastSavedAt` (grep over
  non-test `frontend/src`: writers at `:103` init, `:169` reset, `:359`). Confirmed; this is the root cause, and the
  red-first indicator test is the probe.
- `resetPanelSaveState` at `panelsSlice.ts:167`, dispatched on dashboard switch at `usePanelUpdatesFlush.ts:150`. Confirmed.
- Only dispatch site of `updateDashboardLayout` is `useLayoutSave.ts:266` (grep). `dashboardsSlice.ts:527` handles
  `fulfilled`, bumps `layoutSaveSeq` (`:534`), no timestamp. Confirmed.
- `repairDashboardLayout.fulfilled` (`dashboardsSlice.ts:544`) bumps no counter; `useLayoutSave.ts:38` documents the
  repair as not a user save. Confirmed.
- `store/store.ts:60` `SELF_RESETTING_SLICES` lists only `auth` and `sourceSamples`; `panels` is reset by the root
  reducer on `clearAuth`. Confirmed (path is `store/store.ts`, not `app/store.ts`; design names only `store.ts`).
- `panelsSlice.ts:3` already imports `duplicateDashboard`/`importDashboard` from `dashboardsSlice`; adding
  `updateDashboardLayout` to that import introduces no new module edge. Confirmed.
- Spec delta: MODIFIED requirement header matches `openspec/specs/panel-save-state-indicator/spec.md` exactly, keeps
  all three existing scenarios, adds layout-save, repair-exclusion and reset scenarios. Sound.
- AC coverage: AC1 (red-first unit) -> tasks 1.1/3.1; AC2 (e2e meta row after drag-only save) -> tasks 1.3/3.2.
  No scope drift; no API/schema change, so no contract delta needed.
- D2 (set on every fulfilled incl. HEL-1230 kept-local) is consistent: label is suppressed while `hasPendingLayout`
  is true, and it mirrors `layoutSaveSeq`.

### Verdict: CONFIRM

### Non-blocking notes
- E2E negative assertion: the design says "no `PATCH /api/panels/batch`-style panel save". The real panel batch save
  is `POST /api/panels/updateBatch` (`panelService.ts:86-92`). Assert against that exact method+path; a request
  matcher on a nonexistent path passes vacuously.
- The `clearAuth` test must go through the real root reducer (`store/store.ts`'s exported `store`, or the same
  `rootReducer` shape), not `panelsReducer` alone; the reset lives in the root reducer, so a slice-only test would
  be wrong in either direction.
- The e2e must actually trigger the layout save (Save now, which `flushAll`s, or the 30 s auto-save) and wait on the
  layout `PATCH /api/dashboards/:id` response before asserting; record its red run against unfixed code as planned.
- Pre-existing spec drift (not introduced here): the requirement text keys "Unsaved changes" only on
  `pendingPanelUpdates`, while code also uses `hasPendingLayout`. Optional to fix while touching this requirement.
