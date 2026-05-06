## Why

The Type Registry is currently embedded as a secondary section within the Data Sources page (`/sources`), making it hard to discover and implying it is subordinate to Data Sources. Elevating it to a top-level sidebar entry and route gives it appropriate prominence as an independent resource-management surface.

## What Changes

- Add a "Type Registry" `NavLink` entry to the app sidebar navigation
- Register a `/registry` route in React Router that renders `TypeRegistryPage` (a thin wrapper around the existing `TypeRegistryBrowser` component)
- Remove the Type Registry section from `SourcesPage` (it will no longer render `TypeRegistryBrowser` or dispatch `fetchDataTypes`)
- `SourcesPage` no longer needs to fetch data types on mount
- The breadcrumb in `AppShell` is extended to show "Type Registry" when on the `/registry` route
- Update the `frontend-data-sources-page` spec to remove Type Registry requirements; those requirements move to a new `frontend-type-registry-page` spec

## Capabilities

### New Capabilities

- `frontend-type-registry-page`: Standalone `/registry` route rendered by a new `TypeRegistryPage` component that hosts `TypeRegistryBrowser` with full list, detail, and management functionality

### Modified Capabilities

- `frontend-data-sources-page`: Remove Type Registry section and its data-fetching from `SourcesPage`; the route and Data Sources functionality are otherwise unchanged

## Impact

- `frontend/src/app/App.tsx` — add `/registry` route, add sidebar nav link, extend breadcrumb logic
- `frontend/src/components/SourcesPage.tsx` — remove `TypeRegistryBrowser` section and `fetchDataTypes` dispatch
- `frontend/src/components/TypeRegistryPage.tsx` (new) — thin page wrapper
- No backend changes; no API contract changes

## Non-goals

- Redesigning or adding new functionality to the Type Registry (list, detail, delete, edit all remain as-is)
- Moving or restructuring `TypeRegistryBrowser` internals
- Changing the `/sources` route or any Data Sources behavior
