## Why

`PanelCard` fetches data via `usePanelData` (a `refresh()` callback already exists) and
auto-refreshes on `panel.refreshInterval` via `usePanelPolling`. There is no way for a user to
force an immediate re-fetch of one panel's bound Output — they must wait for the interval. This
matters more now than when the ticket was filed: two more automatic refresh paths
(`usePanelPolling`, and HEL-1094/HEL-1174's `usePanelRunRefresh` SSE fan-out) already call the same
`refresh()`, with no in-flight guard anywhere in the chain — a real, pre-existing gap this ticket
closes as a side effect of adding a third caller.

## What Changes

- Add a keyboard-accessible "Refresh" `IconButton` to `PanelCard`'s header, for output-bound panels
  only (`getOutputId(panel) != null`) — no dead control on markdown/image/divider/form panels.
- Add a shared in-flight guard inside `usePanelData`: `refresh()` is a no-op while a fetch for the
  current key is already pending, regardless of which caller (poll, SSE fan-out, or the new manual
  button) invoked it. Expose `isRefreshing` (fetch pending on already-loaded data) distinctly from
  the existing `isLoading` (first-load / no-data-yet), so a manual/poll/fan-out refresh shows the
  accent border-`Spinner` on the button, never the full `PanelContent` skeleton.
- Manual click while a refresh is already in flight is ignored (button also `disabled`).
- No freshness ("updated N ago") label — see design.md Decision 4 for why this is deliberately
  dropped rather than silently built on the already-orphaned `dataAsOf` field.

## Capabilities

### New Capabilities

- `panel-manual-refresh`: a per-panel, keyboard-accessible Refresh control on output-bound panels
  that immediately re-fetches the panel's bound Output, with an in-flight guard shared across the
  manual, poll, and SSE fan-out refresh triggers so at most one fetch for a given panel is ever
  outstanding at a time.

### Modified Capabilities

(none — `panel-polling` and `panel-run-refresh`'s own documented behavior is unchanged; the shared
in-flight guard is new cross-cutting behavior owned by the new capability above, not a change to
either existing capability's requirements.)

## Impact

- `frontend/src/features/panels/hooks/usePanelData.ts` — in-flight guard, `isRefreshing`.
- `frontend/src/features/panels/ui/PanelCard.tsx` — new header `IconButton`, wiring, spinner swap.
- New/updated unit tests: `usePanelData.test.ts`, `PanelCard.test.tsx`.
- No backend, schema, or API changes — `GET /api/outputs/:id/rows` is already called by the
  existing fetch path.
