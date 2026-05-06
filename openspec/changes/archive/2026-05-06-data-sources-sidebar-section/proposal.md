## Why

The current `/sources` route combines Data Sources and Type Registry into a single `SourcesPage`, making navigation unwieldy as both sections grow. Separating Data Sources into its own top-level sidebar entry and route gives users a direct, discoverable path to manage their data connections without scrolling past the type registry.

## What Changes

- A new **Data Sources** sidebar nav item is added as a top-level entry alongside Dashboards and Sources
- A new `/data-sources` route renders a dedicated `DataSourcesPage` containing only the data source list, add-source modal, and delete/refresh actions
- The existing `/sources` route (`SourcesPage`) retains only the Type Registry browser and TypeDetailPanel; its Data Sources section is removed
- Sidebar navigation order: Dashboards → Data Sources → Sources (Type Registry)
- All existing data source functionality (list, detail, create, delete, refresh) moves to the new page unchanged

## Capabilities

### New Capabilities
- `frontend-data-sources-route`: Standalone `/data-sources` route and `DataSourcesPage` component with its own sidebar nav entry

### Modified Capabilities
- `frontend-data-sources-page`: `SourcesPage` no longer renders the Data Sources section; it becomes Type Registry only

## Impact

- `frontend/src/App.tsx` (or router config) — add `/data-sources` route
- `frontend/src/components/Sidebar` (or equivalent) — add Data Sources nav link
- `frontend/src/pages/SourcesPage.tsx` — remove DataSourceList and AddSourceModal; keep TypeRegistryBrowser
- New `frontend/src/pages/DataSourcesPage.tsx` — extract DataSourceList and AddSourceModal from SourcesPage
- No backend changes; no API contract changes
- No breaking changes to existing routes (both `/sources` and `/data-sources` coexist)

## Non-goals

- Redesigning the Data Sources UI or adding new data source functionality
- Moving Type Registry out of the `/sources` route
- Any backend or API changes
