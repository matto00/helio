## Standing Constraints

## 1. Investigation

- [x] 1.1 Establish live reachability of part 1 (design D5); write `reachability.md` in this change dir with file:line evidence

### Frontend

## 2. Layout patch

- [x] 2.1 `buildLayoutPatch` keeps `next[bp]` items of panels absent from `resolved[bp]` on substitution (D1), skipping blank-id and duplicate items like `liveEntries`; unit test passes
- [x] 2.2 No client-side validity check on `resolved + kept`; sent as is (D2); unit test passes

## 3. Rejection copy

- [x] 3.1 `updateDashboardLayout` non-conflict failures (initial + retry) reject with client copy per D3 (conflict copy only for 400 + re-sync ok + panels loaded for this dashboard with status !== failed + unloaded id present); slice test passes
- [x] 3.2 Update `toastListeners` / existing tests asserting the server message is shown; jest green

### Tests

## 4. Tests

- [x] 4.1 Unit test: substitution keeps an unloaded panel's item — fails on the pre-fix `layoutPatch.ts` (record the red)
- [x] 4.2 Delete-then-fill test: ghost item in authored layout + drag into its slot → PATCH body carries the ghost item as authored (jest); server acceptance is pinned by `DashboardLayoutGhostWriteSpec` L63
- [x] 4.3 Slice test: 400 with raw-UUID server message + unloaded panel in re-synced layout → conflict copy, no UUID in payload
- [x] 4.4 Slice tests: generic copy for no-unloaded-panel, stale list (loadedDashboardId null), fetchPanels failed (items empty, loadedDashboardId kept), re-sync failed; 500 with a ghost in re-synced layout → generic; retry-path failure → no server text
- [x] 4.5 D5: not reachable (reachability.md), so no hook test; I1 untouched (no persistedVersionRef/baseVersion edits)
- [x] 4.6 lint, typecheck, format:check, and affected jest shards green (3 workers, nice -n 19)
