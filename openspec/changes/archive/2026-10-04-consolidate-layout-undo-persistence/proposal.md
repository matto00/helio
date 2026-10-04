## Why

The layout undo/redo path has two copies of the same handler (CommandBar buttons and the keyboard hook), and its
persistence works only by side effect: `useLayoutSave` infers "this store write was an undo" from a revision
counter. Two real loss paths sit next to it: a layout PATCH response that lands after a newer local edit overwrites
that edit, and a drag followed by a panel create is silently re-baselined and never saved (HEL-1028 follow-up).
HEL-1233 builds on this save path next, so it should be correct and documented first.

## What Changes

- One undo and one redo entry point in the `layout` feature; the keyboard shortcuts and the CommandBar buttons both
  call it.
- Undo/redo is specified as a local edit persisted by the same deferred flush as a drag (auto-save tick, Save now,
  grid unmount). Its store write is recognised explicitly, not inferred from a counter.
- A layout PATCH response no longer replaces a local layout that changed while the request was in flight; the
  newer layout stays pending.
- A panel create that only adds placements extends the saved baseline instead of replacing it, so a pending
  drag/resize/undo survives the create and is flushed.
- CLAUDE.md and the canonical specs stop describing a 250 ms layout debounce that does not exist.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `layout-undo-redo`: one shared undo/redo entry for toolbar and keyboard; deferred-flush persistence specified;
  in-flight response and drag-then-create scenarios.
- `frontend-layout-persistence`: replace the 250 ms debounce requirements with the real auto-save/Save-now/unmount
  flush.
- `panel-drag-perf`, `write-path-audit`: same 250 ms debounce correction.

## Non-goals

- Immediate (per-keystroke) PATCH on undo/redo. Undo/redo persists exactly like a drag.
- Layout repair on open (HEL-1233), the HEL-1071 rejected-save re-read, panel-delete layout handling, and any
  backend, sources or connectors change. No migration.
- Changing the auto-save interval or the Save-now UI.

## Impact

Frontend only: `features/layout` (history slice, new undo/redo entry, keyboard hook), `app/CommandBar.tsx`,
`features/panels/hooks/useLayoutSave.ts`, `features/dashboards/state/dashboardsSlice.ts` (layout PATCH thunk arg and
fulfilled reducer), their unit tests, possibly the HEL-1028 e2e spec, CLAUDE.md, and four openspec specs.
