## Why

The web layout save has two leftovers from HEL-1457. When it replaces a changed-but-invalid breakpoint with the
displayed resolution, it rebuilds that breakpoint from the loaded panels only, so the stored item of a panel this tab
has not loaded would be dropped from the PATCH (the server's ghost filter cannot restore it: the panel exists). And a
layout save the server rejects with `400` shows the server's developer-facing message, which quotes raw panel UUIDs.

## What Changes

- The invalid-breakpoint substitution keeps the authored items of panels the tab has not loaded, the same rule
  `DesktopPanelGrid` already applies on its rebuild path (HEL-1457). The server adjudicates those items: a deleted
  panel's ghost item is dropped, an overlap with a live panel is a `400`.
- A rejected (non-conflict) layout save shows existing client copy instead of the server's text: the "changed
  elsewhere" conflict copy for a `400` when the re-synced server layout holds panels this tab has not loaded, otherwise the
  generic "Failed to save dashboard layout." No raw ids reach the toast.
- The server's `400` message is unchanged (agents and MCP rely on its ids).

## Capabilities

### New Capabilities

### Modified Capabilities
- `dashboard-layout-validation`: the web-client requirement now keeps unloaded panels' items on substitution (server
  adjudicates them), and shows client copy (no raw ids) for a rejected save.

## Impact

- `frontend/src/features/dashboards/state/layoutPatch.ts` (+ test)
- `frontend/src/features/dashboards/state/dashboardsSlice.ts` (`updateDashboardLayout` rejection copy) (+ test)
- No backend, schema, or migration change.

## Non-goals

- Changing the server's `400` message or response shape.
- Making panel loading/refetch faster or changing when the panel list counts as loaded.
- Changing how `resolveDashboardLayout` places loaded panels.
