## Context

See proposal.md - Why. Current code (main @ 9a57f7aa):

- `app/CommandBar.tsx:117-131` `handleUndo`/`handleRedo` and `features/layout/hooks/useLayoutUndoRedo.ts` each read
  `selectUndoLayout`/`selectRedoLayout`, dispatch `undoLayout`/`redoLayout`, then `setDashboardLayoutLocally`.
- `features/panels/hooks/useLayoutSave.ts` classifies every store layout change in one effect: an interaction commit
  (`localCommitRef` equality) or a "history traversal" (`selectLayoutRevision` differs from the last seen value) keeps
  `persistedLayoutRef`; everything else re-baselines it. The revision test is a side channel: an effective undo whose
  target equals the current layout bumps the revision but writes no new store layout, so the effect does not run and
  the stale revision is consumed by the next unrelated change (a server layout is then not re-baselined).
- Persistence is deferred: `usePanelUpdatesFlush.ts` runs a 30s `AUTO_SAVE_INTERVAL_MS` tick and Save now through a
  registered layout-flush slot; `useLayoutSave` also flushes on unmount. There is no 250 ms debounce anywhere.
- `dashboardsSlice.ts:310` `updateDashboardLayout.fulfilled` replaces the dashboard wholesale and clears
  `hasPendingLayout`. If the user edited while the PATCH was in flight, the response overwrites the newer layout, the
  `useLayoutSave` effect re-baselines onto it, and the edit is lost visually and never saved.
- `panelThunks.ts:112-127` `createPanel` writes `store layout + server placements` via `setDashboardLayoutLocally`.
  The effect re-baselines onto it, so a pending drag is dropped from what will be saved (pinned as a "documented
  choice" by `DesktopPanelGrid.layoutCommit.test.tsx:250`).

Owner rulings that bound the design: HEL-1023 (reflow at render, persist only on user edit), HEL-1028 (RGL re-syncs
on layouts prop change; stop arms, `handleLayoutChange` commits; revision-aware save), HEL-1071 (invalid PATCH is
400; `buildLayoutPatch` substitutes a changed-and-invalid breakpoint with its render-time resolution).

## Goals / Non-Goals

**Goals:** one undo/redo implementation; an explicit, documented classification of every store layout write in
`useLayoutSave`; no loss on in-flight response or drag-then-create; correct docs. **Non-Goals:** see proposal.md.
Also out: removing the no-op history entry a zero-move drag pushes (classification is made robust to it instead).

## Decisions

**D1 - One entry point: plain thunks in the layout feature.** Add `features/layout/state/layoutHistoryThunks.ts`
exporting `applyLayoutUndo(dashboardId)` and `applyLayoutRedo(dashboardId)`: synchronous thunks that read the target
and the current store layout from `getState()` at call time, return `false` (and dispatch nothing) when either is
missing, otherwise dispatch `undoLayout`/`redoLayout` then `setDashboardLayoutLocally` and return `true`.
`useLayoutUndoRedo` calls them from its shortcuts (calling `preventDefault` only when they return `true`, preserving
today's behaviour); `CommandBar` calls them from the buttons and drops its `undoTarget`/`redoTarget` selectors and
`setDashboardLayoutLocally`/`undoLayout`/`redoLayout` imports (it keeps `selectCanUndo`/`selectCanRedo` for the
disabled state). Alternative rejected: a shared hook returning callbacks - both components would still subscribe to
targets and close over render-time values; a thunk reads live state and is trivially callable from anywhere.

**D2 - Traversals are recognised by what they applied, not only by a counter.** Each dashboard's history entry
gains `applied: DashboardLayout | null`, set by `undoLayout`/`redoLayout` to the layout the traversal restores (top
of `past` / head of `future`) whenever they are effective; exposed via `selectAppliedLayout(dashboardId)`.
`useLayoutSave` classifies a store layout write as a traversal only when the revision changed since last seen AND
the new layout deep-equals `applied`. A stale revision (no-op traversal) therefore cannot capture a later server
layout. `revision` stays (HEL-1028 relies on it to tell repeated traversals apart).

**D3 - Classification order in `useLayoutSave`'s effect, documented in the file header** (the contract HEL-1233
builds on): (1) interaction commit -> keep baseline; (2) traversal (D2) -> keep baseline; (3) placement extension
(D4) -> extend baseline; (4) anything else is server/external truth -> re-baseline. Cases 1-3 then set pending =
`layout !== baseline` (deep). The deferred flush is unchanged: nothing in 1-3 PATCHes by itself (spec: "An undo or
redo is persisted by the deferred layout flush"). Alternative rejected: PATCH immediately on undo/redo - a run of
Ctrl+Z presses would issue a PATCH each, and drags already use the deferred model; one model is easier to reason about.

**D4 - A placement-only change extends the baseline.** The effect keeps `prevLayoutRef` (the store layout it last
saw). A change is a placement extension when, for every breakpoint, the incoming array equals `prev[bp]` followed by
appended items whose `panelId`s appear in no breakpoint of `prev`. The new baseline is `persisted` with each
breakpoint extended by the same appended items (skipping ids already in `persisted[bp]`). With no pending edit
(`prev` equals `persisted`) this yields exactly the incoming layout, so the existing "Panel created: no PATCH, not
pending" scenario holds. With a pending drag, the baseline approximates the server's post-create layout (server
layout + placement), so the drag stays pending and the next flush PATCHes only the changed breakpoint(s) via the
unchanged `buildLayoutPatch`. Detection is structural so `createPanel` is untouched and a server upsert that also
moved existing items is never mistaken for a placement. Alternative rejected: tag the `createPanel` write with a
flag - it threads intent through the generic `setDashboardLayoutLocally` reducer and a missed tag fails silently.

**D5 - In-flight responses never overwrite a newer local layout.** `updateDashboardLayout`'s arg gains a required
`sentLayout: DashboardLayout` (the full authored layout the PATCH represents; never sent on the wire - the request
still takes only `layout`). In the fulfilled reducer: if the local layout deep-equals `meta.arg.sentLayout`, replace
the dashboard and clear `hasPendingLayout` (today's behaviour); otherwise update every other field from the payload
but keep the existing `layout` object by reference (so neither RGL nor the `useLayoutSave` effect re-runs) and leave
`hasPendingLayout` as is. `persistLayout`'s `.then` sets the baseline to the server layout and then recomputes pending
in BOTH directions: pending = `latestLayoutRef` differs from the new baseline, dispatching `setLayoutPending(false)`
when equal and keeping `layoutPendingDispatchedRef` in sync, so a response that already matches a newer local layout
(e.g. a create that landed server-side first) never leaves the indicator stuck dirty or blocks the next edit's
pending dispatch. Required (not optional) so no caller silently bypasses the guard.
Alternative rejected: request sequence numbers - comparing against the sent layout answers the actual question
("did the layout change since?") with no new state.

**D6 - Docs.** Spec deltas correct the 250 ms claims in `frontend-layout-persistence`, `panel-drag-perf` and
`write-path-audit` requirements. Two canonical spec passages are outside any requirement, so archive never touches
them and they are edited directly, deliberately, in this change: the `frontend-layout-persistence` Purpose line and
the `write-path-audit` "Write Path Reference" free text (table row 1, payload note 1, source-locations row). CLAUDE.md:105 states the real mechanism (staged on stop, persisted by the 30s auto-save, Save now, or
the desktop grid's unmount flush - `usePanelUpdatesFlush.ts`/`useLayoutSave.ts`). `features/layout/README.md` points
at the D3 classification. The direct canonical edits are retained at archive (archive only rewrites requirement blocks).

## Risks / Trade-offs

- [Server places the new panel against its pre-drag layout, overlapping the locally dragged panel] -> render reflows
  it (HEL-1023) and `buildLayoutPatch` substitutes the resolved valid breakpoint (HEL-1071); a unit test pins that the
  flushed PATCH for this case is valid (no overlaps), never a 400.
- [An in-flight PATCH's server-side substitution differs from `sentLayout`] -> comparison is against the local layout
  at response time, not the server layout, so a substituted response is still adopted when nothing changed locally.
- [A structural placement check misreads a reorder] -> it requires `prev[bp]` as an exact prefix; anything else
  falls to case 4 (today's behaviour), never to an extended baseline.
- [Existing tests pin the old behaviour] -> they flip deliberately: `DesktopPanelGrid.layoutCommit.test.tsx:250`
  (drag-then-create now PATCHes), `dashboardsSlice.test.ts:221,479` (thunk arg gains `sentLayout`),
  `useLayoutUndoRedo.test.ts`/`.regression.test.ts` (dispatch shape via the thunk). `e2e/hel1028-*` must stay green
  unchanged.

## Planner Notes

- Self-approved: deferred flush over immediate persist (the ticket offers both; it matches drag behaviour and needs
  no product call). No new dependency, no API change, no migration, frontend only; no sources/connectors file.
- Grepped `frontend/src` and `e2e/` for `updateDashboardLayout`, `hasPendingLayout`, `setDashboardLayoutLocally`,
  `undoLayout`, `redoLayout`, `Undo layout change`: only the files named above depend on the changed behaviour; no
  existing test covers the CommandBar buttons.
