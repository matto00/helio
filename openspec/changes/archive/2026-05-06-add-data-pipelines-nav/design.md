## Context

The app shell (`App.tsx`) renders a sidebar with a `<nav>` containing `NavLink` items and an
`<Outlet>` for the active route. Two protected routes exist today: `/` (Dashboards) and `/sources`
(Data Sources). The breadcrumb in the command bar uses `onDashboardView` (pathname === "/") to
switch between "Dashboards" and a fallback "Data Sources" label — this needs to be generalised
to handle a third page.

## Goals / Non-Goals

**Goals:**
- Add `/pipelines` as a protected route inside `AppShell`
- Add a "Data Pipelines" `NavLink` between "Data Sources" and any future "Type Registry" item
- Render a `PipelinesPage` placeholder at `/pipelines`
- Update breadcrumb so it correctly shows the active section name

**Non-Goals:**
- Any pipeline data model, API, or backend work
- Type Registry nav entry

## Decisions

**Breadcrumb generalisation:** Replace the binary `onDashboardView ? "Dashboards" : "Data Sources"` logic
with a map from pathname to label, e.g. `{ "/": "Dashboards", "/sources": "Data Sources", "/pipelines": "Data Pipelines" }`.
The dashboard name sub-crumb is still only shown on `/`. This is the minimal change that avoids
chained ternaries and is easy to extend for future nav items.

**PipelinesPage component:** A standalone file at `frontend/src/components/PipelinesPage.tsx`,
matching the pattern of `SourcesPage`. It renders a simple empty-state message. No Redux state or
API calls needed at this stage.

**Nav order:** The sidebar nav `<NavLink>` order becomes: Dashboards → Data Sources → Data Pipelines.
Type Registry will be inserted after Data Pipelines when that ticket is worked.

## Risks / Trade-offs

- The breadcrumb map approach hardcodes pathnames as strings. Risk is low — this is the existing
  pattern implicitly, just made explicit. → Acceptable for current scale.

## Planner Notes

Self-approved: pure frontend addition, no breaking changes, no new external dependencies, no API
contract changes. Scope is limited to 3 files (App.tsx modified, PipelinesPage.tsx new,
potentially App.test.tsx updated).
