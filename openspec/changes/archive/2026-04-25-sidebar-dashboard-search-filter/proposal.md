## Why

As dashboards accumulate, the sidebar list becomes unwieldy to scan. A real-time text filter lets users instantly locate any dashboard by name without scrolling, improving navigation speed for users with more than a handful of dashboards.

## What Changes

- Add a text filter input at the top of the dashboard list in the sidebar
- Filter narrows the displayed list client-side in real time as the user types (case-insensitive substring match on dashboard name)
- A clear button (✕) resets the filter and restores the full list
- If the active dashboard is filtered out by the search, it remains reachable and is visually distinguished (e.g., dimmed or labeled) so users know it exists outside the current filter

## Capabilities

### New Capabilities

- `sidebar-dashboard-filter`: Client-side text filtering of the dashboard list in the sidebar, including real-time narrowing, clear action, and active-dashboard persistence outside filter results

### Modified Capabilities

<!-- No existing spec-level requirements are changing -->

## Impact

- Frontend only — no backend or API changes
- `frontend/src/components/Sidebar` (or equivalent sidebar component) gains a filter input and filtered list rendering logic
- Redux state is not required; local component state (`useState`) is sufficient for the filter string
- No schema changes

## Non-goals

- Server-side search or API calls
- Fuzzy matching or advanced search syntax
- Filtering by anything other than dashboard name
