## Why

On the phone dashboard, the "refreshed …" line slot is reserved only once panels have loaded and are known to be
pipeline-fed (HEL-1583). While panels are still loading, the skeleton has no such signal, so its placeholder cards
paint ~27px higher than the real cards that replace them: a visible layout jump on every cold open of a pipeline-fed
dashboard on a phone.

## What Changes

- `GET /api/dashboards` list items carry a new boolean `hasPipelineFedPanels`: true when the dashboard has at least
  one output panel bound to a non-empty Output id (the server-side mirror of the client's `feedingOutputIds`).
  Computed in one batched query per page, never per dashboard.
- `dashboard.schema.json` and the frontend `Dashboard` type gain the field (optional on the wire: emitted by the
  list endpoint; other single-dashboard responses may omit it).
- The client keeps the flag across single-dashboard responses that omit it (rename/appearance/layout/repair
  replacements do not drop it) and refreshes it from loaded panels, so it does not go stale within a session.
- The phone refresh line reserves its empty slot during the panel skeleton when the selected dashboard's flag is
  true; once panels load, the loaded panels stay the source of truth exactly as today.
- Markdown-only (and form-only) dashboards: flag false, no slot, unchanged. Desktop: unchanged.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `mobile-dashboard-meta-line`: the refresh line's slot is reserved from first paint, including during the panel
  skeleton, for pipeline-fed dashboards (and the spec is brought in line with HEL-1583's reserved-slot behavior).
  The list-payload flag that feeds it is specified as a new requirement in the same capability, next to the
  behavior it exists for.

## Non-goals

- No change to desktop meta row, skeleton geometry, or panel-card layout.
- No change to `GET /api/dashboard-changes` or the Home summary payload.
- No feeding-output count (a boolean suffices for slot reservation).
- Public/shared-route viewer: unchanged (it never mounts the refresh line).

## Impact

- Backend: dashboard list query/repository, `DashboardResponse` protocol.
- Contract: `schemas/dashboards/dashboard.schema.json` (+ any OpenAPI/contract test that pins the dashboard shape).
- Frontend: `Dashboard` type, `dashboardsSlice` reducers, `DashboardRefreshLine`.
- Tests: backend route/repo test, jest unit tests, a new frame-sampling e2e at 375/430 in both themes.
