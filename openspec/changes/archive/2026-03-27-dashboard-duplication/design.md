## Context

The dashboard actions menu has a disabled "Duplicate" item. The backend has no duplication endpoint. Panel duplication already exists (`POST /api/panels/:id/duplicate`, `PanelRepository.duplicate`) and provides a reference pattern.

Complication not present in panel duplication: the `Dashboard` domain model includes a `layout` field (`DashboardLayout`) that stores `PanelId` references. Duplicating a dashboard requires remapping those IDs to the new panel IDs so the copied dashboard's layout remains consistent.

## Goals / Non-Goals

**Goals:**
- `POST /api/dashboards/:id/duplicate` returns a new dashboard + its panels atomically
- Layout panel IDs are remapped to the new panel IDs in a single DB transaction
- Frontend enables the Duplicate menu item and selects the new dashboard on success
- Panels are populated into Redux state from the response (avoids a second fetch)

**Non-Goals:**
- Copy-of-copy deduplication (e.g., `(copy 2)`) — simple `"{name} (copy)"` suffix is sufficient per spec
- Preserving typeId / fieldMapping bindings on duplicated panels (copy them as-is)

## Decisions

### 1. Response shape: combined `DuplicateDashboardResponse`

The endpoint returns `{ dashboard, panels }` in a single response rather than just the dashboard. This lets the frontend populate the panel store immediately without a second GET.

**Alternative**: Return only the dashboard; frontend fetches panels lazily. Simpler backend, but adds a round-trip and a brief empty-panel flash when the new dashboard is selected.

### 2. Layout remapping in `DashboardRepository.duplicate`

The repository method receives the source `DashboardId`, fetches the source dashboard and all its panels, assigns new UUIDs to panels, builds an `oldId → newId` map, rewrites the layout, and inserts everything in a single `transactionally` block.

**Alternative**: Handle remapping in the route handler. Rejected — it mixes infrastructure concerns into the routing layer and makes the repository harder to test independently.

### 3. Frontend: cross-slice action handling

`duplicateDashboard` is a thunk in `dashboardsSlice`. Both `dashboardsSlice` and `panelsSlice` handle `duplicateDashboard.fulfilled` in their `extraReducers`:
- `dashboardsSlice`: prepends the new dashboard and sets it as selected
- `panelsSlice`: replaces `items` with the new dashboard's panels and updates `loadedDashboardId`

**Alternative**: Thunk dispatches `markDashboardPanelsStale` and lets PanelGrid trigger `fetchPanels` lazily. Simpler, but causes a visible loading flash and wastes the panels already in the response.

### 4. New JSON response type

Add `DuplicateDashboardResponse(dashboard: DashboardResponse, panels: Vector[PanelResponse])` to `JsonProtocols`. Simple case class with a derived format.

## Risks / Trade-offs

- **Multi-insert atomicity** → Mitigated: Slick `transactionally` wraps both dashboard insert and all panel inserts; failure rolls back entirely.
- **Large panel count** → Low risk in current in-memory-seeded state; acceptable for now.
- **Name collision** → Simple `(copy)` suffix may produce multiple dashboards with identical names. Acceptable per spec; no uniqueness constraint on dashboard names.

## Migration Plan

No DB schema changes required — duplication uses existing tables and columns. New Flyway migration is not needed.
