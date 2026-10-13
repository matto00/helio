## Why

Dashboard layout writes are read-modify-write with no precondition and no lock, and they rewrite name and appearance
too. A stale tab's autosave (or an auto-layout racing a panel create) silently drops another writer's placements, and a
layout save can revert a concurrent rename (HEL-1457). Agent (MCP) editing alongside the UI makes this a live hazard.

## What Changes

- Dashboards gain a server-maintained `layoutVersion`, bumped by the database whenever the stored layout changes,
  whoever writes it (PATCH, auto-layout, panel create/duplicate/delete, contents replace, repair, patch-set apply).
- Every dashboard response carries `layoutVersion`.
- `PATCH /api/dashboards/:id` (and `/update`) accept an optional `expectedLayoutVersion` alongside `layout`; on
  mismatch the request returns **409** and writes nothing (name/appearance in the same request included).
- `POST /api/dashboards/:id/auto-layout` accepts the same optional precondition and writes compare-and-set against
  the layout it read; a conflict returns 409.
- Callers that send no precondition keep working (bounded internal re-read and retry, then 409).
- Layout writes write only `layout` and `last_updated`; name and appearance are written only when supplied.
- The web client sends `expectedLayoutVersion` with every layout save; on 409 it refetches, reapplies the user's
  per-panel changes onto the fresh layout and retries once, else adopts the server layout and tells the user.

## Capabilities

### New Capabilities
- `dashboard-layout-concurrency`: layout version, the layout write precondition and 409 semantics, layout-only writes.

### Modified Capabilities
- (none — behaviour added as a new capability; client 409 handling is specified there too)

## Impact

- Backend: new Flyway migration (column + trigger), `DashboardRepository`, `DashboardWrites`, `AutoLayoutService`,
  `DashboardProtocol`, domain `Dashboard`.
- Frontend: `Dashboard` type, `dashboardService.ts`, `dashboardsSlice.updateDashboardLayout`, `useLayoutSave.ts`.
- Contract: `schemas/dashboards` (response field, request field). Additive; no field removed. **Client contract
  change** (409 handling, version field) — owner review.

## Non-goals

- Re-adding a live panel omitted from a supplied breakpoint by a caller that sends no precondition (follow-up).
- Panel-row lock ordering across panel writers (HEL-1498).
- helio-mcp sending the precondition (follow-up; it keeps working without it).
