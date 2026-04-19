# HEL-56 — Render bound DataType data in panels

## Context

Panels store a `typeId` and `fieldMapping` after binding (via HEL-49), but they never actually fetch or display the bound data at render time. This is the core missing piece of HEL-29 — the end-to-end flow from data source → panel display.

The backend already exposes preview/data endpoints:

* `GET /api/data-sources/:id/preview` (CSV sources)
* `GET /api/sources/:id/preview` (REST API sources)

## What changes

* **Frontend**: When a panel has a `typeId` set, fetch the data for that DataType's source on panel mount and whenever the binding changes
* Apply `fieldMapping` to route fetched row values to the correct panel display slots
* Show a loading state while data is in flight
* Show an error state if the fetch fails or the source is unreachable
* Panels with no `typeId` render exactly as before

## Out of scope

* Automatic polling/refresh (separate ticket: HEL-TBD)
* SQL connector
* Computed fields

## Acceptance criteria

- [ ] A panel bound to a REST API DataType displays live data fetched from that source on render
- [ ] A panel bound to a CSV DataType displays the uploaded CSV data on render
- [ ] `fieldMapping` correctly routes source fields to panel display slots
- [ ] A loading spinner is shown while data is being fetched
- [ ] A clear error state is shown if the source fetch fails or returns an error
- [ ] Panels with no `typeId` are unaffected — no regression in existing panel rendering
