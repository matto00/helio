## Context

See proposal.md - Why. Ground truth on main (e3eda3eda):

- `SaveStateIndicator.tsx:17` reads `state.panels.lastSavedAt`; label at line 37.
- `panelsSlice.ts:359` (`updatePanelsBatch.fulfilled`) is the only writer of a non-null `lastSavedAt`;
  `resetPanelSaveState` (`panelsSlice.ts:167`, dispatched on dashboard switch by `usePanelUpdatesFlush.ts:150`) nulls it.
- Every layout save goes through ONE dispatch site: `useLayoutSave.ts:266` -> `updateDashboardLayout` (drag, resize,
  Tidy, Undo/Redo, the HEL-1618 lift-when-free resize writes, and the grid unmount flush all reach it).
  `dashboardsSlice.ts:527` handles its `fulfilled`, bumping `layoutSaveSeq` (the HEL-1584 check-mark) but no timestamp.
- `repairDashboardLayout` (HEL-1233, `useStoredLayoutRepair.ts`) is a separate POST; `useLayoutSave.ts:38` documents
  it is not a user save, and it bumps no save counter.
- HEL-1634: the root reducer in `store.ts` resets every slice on `clearAuth` unless listed in
  `SELF_RESETTING_SLICES`, so a field in `panels` state is reset on sign-out for free (verify `panels` is not listed).
- `panelsSlice.ts:3` already imports from `dashboardsSlice` (`duplicateDashboard`, `importDashboard`), so handling a
  dashboards thunk in `panelsSlice`'s `extraReducers` adds no new import cycle.

## Goals / Non-Goals

**Goals:** one shared timestamp, written by both save paths, with the existing reset points unchanged.

**Non-Goals:** see proposal.md - Non-goals.

## Decisions

### D1. Write the existing `panels.lastSavedAt` from `updateDashboardLayout.fulfilled` (in `panelsSlice`)

Add `.addCase(updateDashboardLayout.fulfilled, (state) => { state.lastSavedAt = Date.now(); })` to
`panelsSlice.extraReducers`, with a short comment that the field is the shared last-saved time of either save path.

Alternatives considered:
- (a) A new `dashboards.lastLayoutSavedAt` and the indicator shows `max` of the two. Rejected: two timestamps need two
  reset points; `resetPanelSaveState` is a panels action, so the dashboards field would need its own reset on switch
  (another dispatch, or a cross-slice case), adding a second thing to keep in sync for no behavior gain.
- (b) Move `lastSavedAt` to a new shared slice. Rejected: a larger refactor touching every reader/test for a one-line
  bug; the panels slice already owns the save-state fields the indicator reads.

The field keeps its name; no reader changes. The timestamp is taken in the reducer (`Date.now()`), matching the
existing panel case.

### D2. Set it on every `fulfilled`, including a HEL-1230 "kept local layout" response

A fulfilled response means the server stored a layout, so a save did happen. If a newer local edit is still pending,
`hasPendingLayout` stays true and the label reads "Unsaved changes" anyway, so the timestamp is not shown until clean.
This mirrors `layoutSaveSeq`, which is also bumped on every `fulfilled`.

### D3. The stored-layout repair does not set it

Consistent with the check-mark (no `layoutSaveSeq` bump) and `useLayoutSave.ts:38`. A spec scenario and a unit test
pin it so a later refactor cannot silently start counting the repair.

### D4. Reset points stay as they are

Dashboard switch: `resetPanelSaveState` already nulls the shared field. Sign-out: root-reducer reset (HEL-1634). A
layout flush of dashboard A that settles after the switch to B sets the timestamp on B's indicator; this is the same
accepted behavior the panel batch save and the check-mark already have (`SaveStateIndicator.tsx` comment, D11a).

## Testing

- Unit (red first, committed before the fix): render `SaveStateIndicator` with a real store, dispatch
  `updateDashboardLayout.fulfilled` with no panel save -> label "Last saved just now". Also: reducer test that
  `repairDashboardLayout.fulfilled` leaves `lastSavedAt` null; `resetPanelSaveState` after a layout save nulls it;
  sign-out (`clearAuth`) after a layout save nulls it -- through the real root reducer (`store/store.ts`), never
  `panelsReducer` alone, since the sign-out reset lives in the root reducer. Mutation: remove the new case -> the
  layout test goes red.
- E2E (new spec, e.g. `e2e/hel1657-layout-save-last-saved.spec.ts`): at 1280px, open a dashboard with panels, drag a
  panel only (no panel edit), trigger the save (Save now, or the 30 s auto-save) and wait on the layout
  `PATCH /api/dashboards/:id` response, then assert the meta row's save-state label reads "Last saved just now" and
  that no `POST /api/panels/updateBatch` (the real panel batch save, `panelService.ts`) was sent. Red first against main.

## Risks / Trade-offs

- [The name `panels.lastSavedAt` now also covers layout saves] -> a comment at the field and the new case says so.
- [Flush of A landing on B's indicator] -> pre-existing, accepted (D4).

## Planner Notes

- Self-approved: D1 (reuse the existing field over a second timestamp), D3 (repair excluded). Frontend only.
