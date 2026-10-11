## Why

Deleting a panel leaves its `{panelId,x,y,w,h}` item in every breakpoint of `dashboards.layout`. Those ghost items push
new panels below empty space (create placement, auto-layout) and can make a valid move be rejected as an overlap. Every
panel-removal path is affected, including DB cascades from Output/step/pipeline/data-source deletes, and prod already
holds such entries.

## What Changes

- A Postgres trigger on `panels` (statement-level, AFTER DELETE, transition table) removes every deleted panel's items
  from all four breakpoints of its dashboard, in the same transaction as the row delete, locking each affected dashboard
  row in id order. It is the single mechanism, so every path (REST, MCP, patch-set apply/rollback/undo, bulk
  delete-by-Output, FK cascades) is covered without enumerating callers.
- A one-off data repair (V123, owner-approved) strips ghost items already stored.
- Every dashboard layout update (PATCH and patch-set restore) drops items for panels not on the dashboard, so no
  client, stale tab or undo can write a ghost back (owner ruling `server-filter`).

## Capabilities

### New Capabilities

### Modified Capabilities

- `dashboard-layout-validation`: adds "deleting a panel removes its items from every breakpoint" and "stored layouts
  hold no items for deleted panels".
  Also adds "layout writes never store items for panels not on the dashboard" and "patch-set undo ignores ghost items".

## Impact

- `backend/src/main/resources/db/migration/V122__*.sql` (trigger, re-owned to `helio_privileged` per V40/V100), and
  `V123__*.sql` for the data repair.
- `DashboardWrites` (layout filter); `PatchSetUndoConflictCheck.checkDashboard` (ghost-insensitive layout compare, a few
  lines). No frontend change.
- No API shape change. The only patch-set file touched is the conflict check above (re-sync with HEL-1482 before PR).

## Non-goals

- Layout last-write-wins for concurrent PATCHes (HEL-1457).
- Repointing a recreated panel's (new id) layout during patch-set undo (documented D3a v1 limit).
