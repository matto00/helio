## Context

The frontend currently has a combined `/sources` route rendering `SourcesPage`, which contains both a Data Sources section (DataSourceList + AddSourceModal) and a Type Registry section (TypeRegistryBrowser + TypeDetailPanel). This structure is specified in `openspec/specs/frontend-data-sources-page/spec.md`.

The sidebar has a single "Sources" nav entry pointing to `/sources`. The router is configured in the main app entry (likely `App.tsx`). The sidebar nav uses `NavLink` components under `aria-label="Main navigation"`.

## Goals / Non-Goals

**Goals:**
- Add a `/data-sources` route rendered by a new `DataSourcesPage` component
- Move DataSourceList and AddSourceModal rendering from `SourcesPage` to `DataSourcesPage`
- Add a "Data Sources" sidebar nav entry pointing to `/data-sources`
- Retain the `/sources` route as Type Registry only

**Non-Goals:**
- Changing any data source API calls, Redux thunks, or state shape
- Redesigning DataSourceList or AddSourceModal internals
- Modifying the Type Registry section

## Decisions

**Decision: New `DataSourcesPage` component, not a prop-driven variant of `SourcesPage`**
Rationale: `SourcesPage` and `DataSourcesPage` serve distinct navigation destinations with different content. A shared base with a prop toggle would couple them; separate files are cleaner and match the existing page-per-route pattern (`SourcesPage.tsx`).

**Decision: `DataSourcesPage` mounts `fetchSources` and `fetchDataTypes` on mount**
Rationale: The data source list depends on `fetchSources`; it also dispatches `fetchDataTypes` so that type information is available (e.g. for source-backed type badges). This mirrors the current `SourcesPage` mount behavior for data sources, preserving functional parity.

**Decision: `SourcesPage` retains `fetchDataTypes` but drops `fetchSources` on mount**
Rationale: TypeRegistryBrowser only needs DataTypes. Removing the `fetchSources` call from `SourcesPage` after the split avoids an unnecessary API call when the user is on the Type Registry view.

**Decision: Sidebar nav order — Dashboards → Data Sources → Sources (Type Registry)**
Rationale: Data Sources are more frequently accessed during dashboard authoring (binding panels); placing them before Type Registry reflects usage priority.

## Risks / Trade-offs

- [Risk] Users bookmarking `/sources` expecting to see Data Sources will now see only Type Registry.
  → Mitigation: Both routes coexist; the sidebar makes the split obvious. No redirect needed — `/sources` continues to render a meaningful page.

- [Risk] If `SourcesPage` stops dispatching `fetchSources`, any component inside it that reads `dataSources` state could show stale data.
  → Mitigation: TypeRegistryBrowser does not render data sources; confirmed safe. DataSourcesPage owns all data source fetching.

## Planner Notes

Self-approved: pure frontend refactor, no API changes, no new external dependencies, no breaking changes to existing routes. Scope is fully contained within the proposal.
