## Context

Both registry actors currently return items in `Vector` insertion order with no explicit sort. The frontend works around this with `getMostRecentDashboardId`, a client-side reduce over `lastUpdated`. This is an undocumented, implicit contract that will break down under a real persistence layer (which may return rows in any order). Defining sort as a backend responsibility now keeps the contract explicit and persistence-ready.

## Goals / Non-Goals

**Goals:**
- Backend sorts `GET /api/dashboards` and `GET /api/dashboards/:id/panels` by `lastUpdated desc` before responding
- Frontend auto-selection can rely on the first item being the most recently updated
- Backend route tests assert the sort order
- Frontend slice simplified to remove redundant client-side sort

**Non-Goals:**
- User-configurable sort order
- Pagination or cursor-based ordering
- Sort on any endpoint other than the two list endpoints

## Decisions

**Sort in the actor, not the route** — `DashboardRegistryActor.GetDashboards` and `PanelRegistryActor.GetPanels` return pre-sorted `Vector`s. This keeps the sort co-located with the data, makes it easy to swap for a database ORDER BY clause in HEL-14, and keeps `ApiRoutes` free of ordering logic.

**Sort field: `lastUpdated`** — Chosen by the product decision in HEL-13. `createdAt` would be stable but wouldn't reflect edits. `lastUpdated` surfaces the most recently active resource first, which matches the frontend auto-selection intent.

**Sort direction: descending** — Most recently updated first. The first item is the auto-select candidate, so descending is the natural direction.

**Frontend simplification** — `getMostRecentDashboardId` currently does a full reduce. With the sort contract in place, it can be simplified to `dashboards[0]?.id ?? null`. The existing test suite already describes this semantic ("selects the most recently updated dashboard by default") so no behavioral change occurs — only the implementation simplifies.

## Risks / Trade-offs

- [Sort stability on equal `lastUpdated`] → Ties are broken by insertion order in the Vector, which is deterministic but not meaningful. Acceptable for now; a secondary sort by `createdAt desc` can be added later if needed.
- [Frontend simplification] → If the backend sort contract is ever removed without updating the frontend, auto-selection would silently break. Mitigated by the spec and backend tests documenting the contract.
