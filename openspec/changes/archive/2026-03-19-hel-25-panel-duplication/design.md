## Context

Panels have a title and appearance (background, color, transparency). The backend stores panels in PostgreSQL via Slick. A `POST /api/panels` endpoint already exists that creates a panel from scratch. The frontend holds panels in Redux and appends new items by refetching. The panel grid uses `resolveDashboardLayout` to assign layout positions for panels that have no stored entry.

## Goals / Non-Goals

**Goals:**
- One-click duplication of a panel within the same dashboard
- Copied panel has the same title and appearance as the source
- Duplicate appears in the grid immediately after creation

**Non-Goals:**
- Cross-dashboard panel duplication
- Copying panel content (panels have no content yet beyond appearance)
- Batch duplication

## Decisions

### Server-side duplicate endpoint vs. client-side two-step

**Decision**: Server-side `POST /api/panels/:id/duplicate`.

Alternatives considered:
- **Client-side**: dispatch `createPanel` then `updatePanelAppearance`. Two round trips, two DB writes, requires the client to hold source panel data and stitch results. Error-prone if the second call fails.
- **Server-side**: Single endpoint reads the source, writes the copy atomically, returns the new panel. Cleaner, fewer round trips, no partial-state risk.

### New ID and position

The duplicate gets a new UUID. Layout position is not copied — `resolveDashboardLayout` already handles panels with no layout entry by placing them at the next available position. No special placement logic needed.

### Title of duplicate

The duplicate title uses a `(copy)` suffix on the base title with an incrementing counter for subsequent copies:
- `CPU Usage` → `CPU Usage (copy)`
- `CPU Usage (copy)` duplicated → `CPU Usage (copy 2)`
- `CPU Usage (copy 2)` duplicated → `CPU Usage (copy 3)`

**Base title extraction**: strip any existing `(copy)` or `(copy N)` suffix from the source before computing the new title. This prevents suffix stacking.

**Next copy number**: fetch all sibling panel titles (same `dashboardId`) in the same composed DBIO action as the source fetch, filter to those matching `<base> (copy)` or `<base> (copy N)`, pick the lowest unused integer ≥ 1.

### Minimising DB transactions

All three SQL operations (fetch source, fetch sibling titles, insert) are composed into a single Slick `DBIO` with `.transactionally` and executed in one `db.run` call — one round trip, one transaction.

### Frontend append strategy

After a successful duplicate, dispatch `markDashboardPanelsStale` and `fetchPanels` (same pattern as `createPanel`) so the panel list stays consistent with backend order. This also causes the grid to pick up the new entry via `resolveDashboardLayout`.

## Risks / Trade-offs

- **Source panel deleted between button click and server processing** → server returns 404, frontend shows an error via the existing error state pattern. Acceptable race condition.
- **Refetch on duplicate vs. optimistic insert** → refetch is slightly slower but avoids stale state. Consistent with the existing `createPanel` approach.
