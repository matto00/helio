## Context

Type Registry is currently a secondary section inside `SourcesPage` (route `/sources`). It renders `TypeRegistryBrowser` and dispatches `fetchDataTypes` on page mount alongside `fetchSources`. The sidebar has two `NavLink` entries: "Dashboards" (`/`) and "Data Sources" (`/sources`). The breadcrumb in `AppShell` currently distinguishes only `onDashboardView` (pathname `"/"`) vs. everything else (hardcoded "Data Sources").

## Goals / Non-Goals

**Goals:**
- `/registry` route renders `TypeRegistryPage` (thin wrapper around `TypeRegistryBrowser`)
- Sidebar gains a "Type Registry" nav link as a peer to "Dashboards" and "Data Sources"
- `SourcesPage` is simplified: removes `TypeRegistryBrowser`, removes `fetchDataTypes` dispatch
- Breadcrumb reflects the active section for all three top-level routes

**Non-Goals:**
- Redesigning `TypeRegistryBrowser` or `TypeDetailPanel` internals
- Changing any API endpoints or backend code
- Adding new Type Registry features

## Decisions

**New `TypeRegistryPage` component (not inline in `App.tsx`)**
Following the pattern of `SourcesPage`, the new page gets its own component file
(`frontend/src/components/TypeRegistryPage.tsx`). It dispatches `fetchDataTypes` on mount and
renders `TypeRegistryBrowser`. This keeps `App.tsx` as a pure routing shell.

**Route: `/registry`**
Short, unambiguous, and parallel to `/sources`. Alternatives considered: `/types` (too terse),
`/type-registry` (redundant with the concept name), `/data-types` (confuses with the API path).

**Breadcrumb extended with a three-way check**
`onDashboardView` already uses `location.pathname === "/"`. The breadcrumb label is extended to a
helper: `"/"` → "Dashboards", `"/sources"` → "Data Sources", else → "Type Registry". This avoids
adding new state and is consistent with the existing pattern.

**`SourcesPage` removes `fetchDataTypes` dispatch**
After this change `fetchDataTypes` is only needed on the Type Registry page. Leaving it in
`SourcesPage` would be a silent no-op fetch that could cause stale-data confusion. Removing it is
safe because panels and other consumers fetch types independently when needed.

## Risks / Trade-offs

- Users navigating directly to `/sources` will no longer see Type Registry inline. This is the
  intentional product change; no mitigation needed.
- The breadcrumb has a simple string-match fallback. If a future route is added that is not "/",
  "/sources", or "/registry", it will silently show "Type Registry". → Mitigation: extract to a
  `getPageTitle(pathname)` helper that explicitly maps known routes and returns a default.

## Planner Notes

Self-approved: purely frontend navigation refactor, no API changes, no new dependencies,
no architectural ambiguity.
