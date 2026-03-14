## Context

The current frontend stores `selectedDashboardId` in Redux and already lazy-loads panels when the selection changes, but the dashboard list itself is not interactive and the default selection is just the first dashboard returned by the API. `HEL-8` adds a real selection experience and makes "most recent dashboard" an explicit contract by introducing shared resource metadata on both dashboards and panels.

## Goals / Non-Goals

**Goals:**
- Add a reusable `meta` shape shared by dashboard and panel resources.
- Expose `createdBy`, `createdAt`, and `lastUpdated` from the backend contract.
- Auto-select the dashboard with the newest `meta.lastUpdated`.
- Render a clickable dashboard list on the left side of the frontend layout.
- Keep selection state modular and compatible with the current Redux + service structure.
- Preserve lazy panel loading when the selected dashboard changes.

**Non-Goals:**
- Persistent storage or real user identity.
- Rich dashboard navigation styling beyond a simple left-side selection list.
- Sorting, filtering, or search across dashboards.
- Editing metadata from the frontend.

## Decisions

### Add a shared `meta` object to both dashboard and panel resources
Dashboards and panels will both expose a nested `meta` object containing `createdBy`, `createdAt`, and `lastUpdated`. This keeps cross-resource audit-style fields consistent and avoids duplicating flat timestamp fields across multiple entities.

Alternative considered:
- Adding only `lastUpdated` to dashboards was rejected because the user explicitly wants the shared metadata on both dashboards and panels, and a universal shape is more reusable.

### Choose the default dashboard by newest `meta.lastUpdated`
The dashboard slice will derive the default selection by choosing the dashboard with the newest `meta.lastUpdated` value instead of relying on backend response order. This keeps the selection rule explicit and stable even if API ordering changes later.

Alternative considered:
- Depending on backend list ordering was rejected because it hides the selection rule and makes the frontend fragile.

### Keep selection state in Redux and selection UI in a small component
`selectedDashboardId` remains in the dashboard slice, while the clickable list component dispatches the selection action. This keeps selection state reusable for future layout or detail components without pushing selection logic into `App`.

Alternative considered:
- Moving selection state into local component state was rejected because it would weaken reuse and break the current Redux-driven lazy panel flow.

### Use a simple two-column app shell
The app shell will render dashboards on the left and panels on the right using minimal layout structure. The goal is functional selection behavior, not final UI polish.

Alternative considered:
- Waiting for a richer navigation design was rejected because the ticket explicitly says not to overdesign the UI.

### Preserve lazy panel fetching with selection-aware guards
The existing panel thunk guard already avoids duplicate loads for the same dashboard. That behavior will stay in place so switching dashboards fetches panels lazily, while repeated selections of the already loaded dashboard do not trigger redundant requests.

Alternative considered:
- Eagerly loading panels for all dashboards was rejected because it works against the performance and modularity goals.

## Risks / Trade-offs

- [Timestamp parsing and comparison could become inconsistent] → Store timestamps as ISO-8601 strings and centralize "most recent dashboard" selection logic in the dashboard slice.
- [Backend metadata is synthetic for now] → Keep the metadata shape contract-stable even if initial values are generated in memory.
- [Layout work could drift into visual redesign] → Keep the selection UI intentionally simple and test behavior rather than styling depth.
