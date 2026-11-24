## Why

A panel detail modal save stages title/appearance edits in `pendingPanelUpdates` (flushed by the 30 s batch) and, in
the same save, awaits a typed subtype PATCH (e.g. output controls). That PATCH's `fulfilled` reducer replaces the
local panel with the server copy, which does not yet carry the staged edits, so the UI shows the old title/appearance
until the flush lands (HEL-1615 follow-up).

## What Changes

- Every `panelsSlice` reducer that replaces a whole local panel with a server copy (the six typed subtype saves, the
  legacy title/appearance PATCH thunks, and the batch save) applies the server copy and then re-applies that panel's
  still-pending staged update with the same shallow appearance merge `accumulatePanelUpdate` uses.
- The merge is factored into one shared helper so staging and re-application cannot drift.
- `pendingPanelUpdates` itself is not changed by these reducers, so the batch flush sends each staged field exactly
  once; the subtype PATCH never carries staged title/appearance.
- The whole-panel-replacer inventory is committed as evidence.

## Capabilities

### New Capabilities

### Modified Capabilities
- `panel-write-accumulator`: adds a requirement that a server panel response never hides a still-pending staged edit.

## Impact

- `frontend/src/features/panels/state/panelsSlice.ts` (reducers + helper) and new jest tests. No backend, schema,
  migration or API change.

## Non-goals

- `fetchPanels.fulfilled`, `duplicateDashboard`/`importDashboard` (list loads, not single-panel saves) are unchanged.
- No change to when or how the batch flush fires, nor to `clearSentPendingPanelUpdates`.
- No server-side `null`/`chart` merge replication (HEL-1615's documented shallow mirror stays as is).
