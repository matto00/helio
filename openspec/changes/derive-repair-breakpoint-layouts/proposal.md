## Why

Panels overlap, overflow, or open dead gaps when the RGL breakpoint the grid renders at has no usable saved layout
(HEL-1023, prod "News Overview"). Reproduction on main (see design.md Context) shows `resolveDashboardLayout` trusts any
saved layout that has enough entries, never checks `x + w <= cols`, and "repairs" overlaps by cascading panels downward.

## What Changes

- A pure layout module: overlap/bounds validity check, repair (compact) and derive-from-nearest-authored-breakpoint.
- `resolveDashboardLayout` uses it: a valid authored layout renders byte-identical (gaps kept); a missing, partial,
  out-of-bounds or overlapping one is derived/repaired at render, never silently persisted.
- Persistence writes only the breakpoint the user edited; derived breakpoints are never written on view or on an edit
  made at a different breakpoint.
- RGL breakpoint boundaries agree with `PanelGrid`'s `>=` boundaries (RGL's strict `>` put exactly 1440/1100/768px one
  breakpoint low).
- The phone stack orders by the derived `xs` layout, so reading order matches the source layout.
- Playwright + unit coverage for every reachable breakpoint including the no-layout case.

## Capabilities

### New Capabilities
- `breakpoint-layout-resolution`: how the per-breakpoint layout is derived/repaired at render and when it persists.

### Modified Capabilities
- `mobile-viewer-stack`: stack order follows the resolved (possibly derived) `xs` layout.

## Impact

Frontend only: `dashboards/state/dashboardLayout.ts` (+ new pure module), `panels/ui/grid/{DesktopPanelGrid,
panelGridConfig}.ts(x)`, `panels/hooks/useLayoutSave.ts`, tests, one e2e spec. No backend, no schema, no API change.

## Non-goals

- No backend/MCP overlap validator or 400 (HEL-1071; keep the overlap predicate pure and mirrorable).
- No always-on compaction (rejected by owner). No change to `mobilePanelHeights.ts` sizing.
- No rewrite of stored layouts on view; no data migration of already-bad saved layouts.
