# HEL-57: Poll bound data sources on panel refresh interval

## Context

`refreshInterval` (in seconds) is already configurable in the panel detail modal and stored in the database, but nothing acts on it. After the initial data load on mount, data is never re-fetched. This ticket wires up the polling behaviour.

Depends on panel data rendering being in place (the initial fetch must exist before polling can repeat it).

## What changes

* **Frontend**: After the initial data load, set up a `setInterval` using the panel's `refreshInterval` value to periodically re-fetch the source data
* Clear the interval on panel unmount or when the binding is removed
* Use `document.visibilityState` to pause polling when the tab is hidden and resume when it becomes visible again, preventing stacked intervals on background tabs
* If `refreshInterval` is null or unset, no polling is set up

## Out of scope

* Server-sent events or websockets
* Backend scheduling or push-based refresh
* Changing the refresh interval without remounting the panel

## Acceptance criteria

- [ ] A panel with `refreshInterval=30` automatically re-fetches its source data every 30 seconds
- [ ] Polling stops and the interval is cleared when the panel unmounts
- [ ] Polling stops when the binding (typeId) is removed from the panel
- [ ] No polling occurs when `refreshInterval` is null or unset
- [ ] Switching to another browser tab and back does not stack duplicate polling intervals
