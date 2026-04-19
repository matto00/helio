## Why

Panels can already be bound to a DataType (HEL-49), but that binding is never used at render time — panels always display static placeholders. This change closes the end-to-end loop by fetching live data from the bound source and displaying it in the panel.

## What Changes

- When a panel has a `typeId`, the frontend fetches preview data from the DataType's source on mount and when the binding changes
- `fieldMapping` is applied to route fetched row values to the correct panel display slots
- A loading spinner replaces the placeholder while data is in flight
- A clear error state is shown if the fetch fails or the source is unreachable
- Panels without a `typeId` continue to render static placeholders — no regression

## Capabilities

### New Capabilities

- `panel-bound-data-fetch`: Frontend hook/service that fetches preview data for a bound panel's DataType source (CSV or REST API) and maps fields via `fieldMapping`. Includes loading and error states.

### Modified Capabilities

- `panel-type-rendering`: Panels now conditionally render live data (when bound) versus the existing placeholder (when unbound). Loading and error states are added.

## Non-goals

- Automatic polling/refresh (separate ticket)
- SQL connector support
- Computed fields

## Impact

- Frontend: new Redux thunk + service call for fetching panel data; panel body components updated to accept live data props
- No backend changes required — existing `/api/data-sources/:id/preview` and `/api/sources/:id/preview` endpoints are used as-is
- No schema changes
