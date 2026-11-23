## Why

The save-state indicator's "Last saved X ago" label reads a timestamp that only a panel batch save sets. A
layout-only save (drag, resize, Tidy, Undo, all through one `updateDashboardLayout` write) leaves the label blank or
stale, while the HEL-1584 check-mark beside it says a save just happened. The two cues contradict each other.

## What Changes

- A successful layout save records the same last-saved timestamp a successful panel batch save records, so the label
  reflects the most recent save of either kind.
- The timestamp keeps its existing reset points: cleared on a dashboard switch, and on sign-out (HEL-1634).
- The owner's one-time stored-layout repair POST (HEL-1233) still records no timestamp: it is not a user save and
  already shows no check-mark.

## Capabilities

### New Capabilities

### Modified Capabilities
- `panel-save-state-indicator`: the clean-state label's timestamp is the time of the most recent successful panel
  save OR layout save, not only of a panel save.

## Impact

- `frontend/src/features/panels/state/panelsSlice.ts` (one reducer case), `SaveStateIndicator` tests, a new e2e spec.
- No backend, schema, API or migration change.

## Non-goals

- Changing the check-mark (HEL-1584 D11a), the dirty-state logic, or the auto-save timer.
- Per-dashboard save timestamps, or showing which kind of save happened.
