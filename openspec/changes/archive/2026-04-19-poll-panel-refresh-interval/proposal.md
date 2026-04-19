## Why

`refreshInterval` is already stored per-panel and configurable via the UI, but nothing acts on it — data is fetched once on mount and never again. This ticket wires the field to a real polling loop so live panels stay current without user intervention.

## What Changes

* A custom React hook (`usePanelPolling`) encapsulates all polling logic: `setInterval` driven by `refreshInterval`, tab-visibility pausing via `document.visibilityState` / `visibilitychange`, and cleanup on unmount.
* The hook is called from the component responsible for fetching panel source data (the panel card or its data-rendering child introduced in HEL-56).
* Polling is skipped entirely when `refreshInterval` is null or the panel has no `typeId` binding.
* The interval is cleared when `typeId` is removed from the panel.

## Capabilities

### New Capabilities

- `panel-polling`: Frontend polling hook that repeats the panel data fetch on a configurable interval, pauses on tab-hidden, and cleans up on unmount.

### Modified Capabilities

- `panel-datatype-binding`: `refreshInterval` behaviour changes from "stored but unused" to "drives polling". No new API fields; requirement addition only (polling semantics).

## Impact

* Frontend only — no backend, schema, or API changes.
* Affected files: new `usePanelPolling` hook; the panel component that dispatches the data-fetch thunk.
* No new dependencies.

## Non-goals

* Server-sent events or websockets
* Backend scheduling or push-based refresh
* Dynamically changing the refresh interval without remounting the panel
