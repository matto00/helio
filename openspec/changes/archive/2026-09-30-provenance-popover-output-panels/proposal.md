## Why

An exec opening a number on a dashboard must see where it came from before using it (HEL-916 trust half, leaf 2). HEL-1206 shipped the read (`GET /api/outputs/:id/provenance`, public `GET /api/dashboards/:dashboardId/panels/:panelId/provenance`); nothing in the UI consumes it.

## What Changes

- New provenance popover (own component, hosted via `usePortalPopover`, NOT `PanelInspectView`) on every output-bound panel, in every render path: desktop grid, mobile panel stack, fullscreen overlay, detail modal, public dashboard viewer.
- Content: source name(s) with kind, pipeline name, node path as human-readable step labels, last run (relative, absolute on hover/focus), row count, check summary, "Open pipeline" link (authenticated only).
- Degraded states: never run, running, last run failed, ran with zero rows, no assertions defined, multi-source (1..N), checks failed/warned.
- Lazy fetch on first open, cached per output (auth) / per dashboard+panel (public); second open served from cache. The "Invalid data" badge becomes a trigger that opens the popover at its checks section and stops fetching assertion-status uncached per panel where the provenance cache already holds the answer.
- One typed `onProvenanceOpened` hook point for HEL-1208 telemetry; no ad-hoc logging.

## Capabilities

### New Capabilities
- `panel-provenance-popover`: the provenance popover, its trigger placement, cache and degraded-state rendering.

### Modified Capabilities
None (spec-level; the Invalid data badge behavior is covered inside the new capability).

## Impact

Frontend only: new `features/panels/provenance/` files, small wiring edits in PanelCard/MobileStackPanelBody/fullscreen/detail modal/public viewer. No backend, no migration (V113 reserved for HEL-1208).
