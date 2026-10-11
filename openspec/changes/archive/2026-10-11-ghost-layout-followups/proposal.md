## Why

HEL-1456 made every dashboard layout write drop "ghost" items (items for panels no longer on the dashboard) and added
the V122 delete trigger. Its reviews left four loose ends: patch-set preview still shows ghost items that apply drops,
a suspected 40P01 deadlock between a dashboard delete and a concurrent delete of one of its panels, auto-layout
writing the stored layout back without the live-panel filter, and a needless type round-trip in the undo check.

## What Changes

- Patch-set preview of a dashboard update restricts the prior layout and the supplied breakpoints to the dashboard's
  live panels before resolving the layout, the same way `DashboardWrites.applyUpdate` does.
- The dashboard-delete / panel-delete deadlock is reproduced first. If real, dashboard delete takes its panel row locks
  before the dashboard row (one lock order, matching V122's "panel rows, then dashboards"), invisible to users. If not
  reproduced, the evidence is recorded and no delete code changes.
- Auto-layout restricts the stored layout it keeps to the dashboard's live panels before writing.
- `PatchSetUndoConflictCheck.checkDashboard` filters the live domain layout directly (refactor, same behaviour).

## Capabilities

### New Capabilities

### Modified Capabilities
- `patch-set-preview`: a dashboard-update preview drops ghost layout items like apply.
- `dashboard-auto-layout`: auto-layout never stores an item for a panel that is not on the dashboard.
- `dashboard-delete`: a dashboard delete racing a delete of one of its panels completes without a deadlock error
  (only if the deadlock reproduces; otherwise this delta is removed).

## Non-goals

- HEL-1457 (layout PATCH last-write-wins); the remaining unlocked stale-read window is unchanged and documented.
- Making preview sequential across edits of one patch set (preview projects each edit against the stored prior state;
  that is pre-existing for every field).
- Editing V122 or V123. Frontend changes.

## Impact

Backend only: `PatchSetPreviewProjection`, `AutoLayoutService`, `PatchSetUndoConflictCheck`, and (if the deadlock is
real) `DashboardRepository.delete`, plus specs. No API shape change. A migration (V124) only if the fix needs SQL.
