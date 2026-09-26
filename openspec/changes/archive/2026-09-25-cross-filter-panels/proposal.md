## Why

Drill-down (HEL-572) already lets a user click a chart element to select a category and open an
Inspect view for that one panel. HEL-588 completes the linked-view promise: an explicit action in
that Inspect view narrows every sibling panel sharing that column, purely client-side, so a
dashboard behaves as one connected view instead of a set of independent posters — without
changing what a plain chart click does.

## What Changes

- **Owner ruling ("Action in Inspect", 2026-09-25 — cite in the PR body):** a chart click keeps
  HEL-572's behavior exactly (opens Inspect only; never sets a cross-filter). `PanelInspectView`
  gains an explicit, keyboard-reachable "Filter dashboard by {dimension} = {value}" footer
  action; activating it sets a dashboard-scoped cross-filter from that panel's current selection
  and closes Inspect. The owner rejected "a click does both" (inspect and filter simultaneously)
  and a separate dashboard-level cross-filter mode toggle.
- Add dashboard-scoped cross-filter state (`SelectionDescriptor`-shaped: dimension/value/series
  plus origin panel id), set only via the Inspect-view action above. Re-activating the action for
  the identical selection is a no-op; a different selection replaces the active filter.
- Apply the filter once, in the shared `usePanelData` consumption layer (`PanelCard`), to every
  Output-kind panel whose field mapping references a column matching the filter's dimension by
  name (per output kind — table via its effective displayed-column set, every other kind via its
  `fieldMapping` values) — except the originating panel, which always renders unfiltered. Every
  downstream consumer (grid, fullscreen, inspect, mobile) sees the same filtered rows
  automatically (HEL-579 Decision 1's single call site). Matching is numeric-safe so a
  scatter-originated numeric selection still matches a differently-formatted sibling column.
- Add a dismissible, accessible (`role="status"`, live-region) dashboard-level indicator
  ("Filtered by {dimension} = {value}", mono value) with a clear-all control — the only way to
  clear an active filter besides panel deletion or dashboard switch.
- Reuse the existing `LoadedScopeDisclosure` truncation-honesty pattern (HEL-448/451) so a
  cross-filtered panel whose own rows are truncated says so, rather than implying completeness.
- Clear the filter on dashboard switch (same reset point HEL-572 already uses for its own
  selection state) and when the originating panel is deleted; never persisted to the backend
  layout.

## Capabilities

### New Capabilities
- `panel-cross-filtering`: dashboard-scoped, client-side cross-filtering of sibling Output panels
  triggered from an explicit Inspect-view action, its indicator, and its truncation-honesty
  behavior.

### Modified Capabilities
(none — `chart-drilldown-inspect`'s own requirements are unchanged; a chart click still only
opens Inspect, and the Inspect view still shows exactly the plotted rows for its selection. The
new footer action is an additional affordance layered onto a shared component, not a change to
any existing requirement's SHALL text.)

## Impact

- `frontend/src/features/panels/state/panelsSlice.ts`: new `crossFilter` state + two reducers,
  plus a `deletePanel.fulfilled` clear case.
- `frontend/src/features/panels/ui/PanelInspectView.tsx`: new footer action, wired to
  `setCrossFilter`/close-Inspect. The chart click handler (`PanelCard.tsx`/
  `useChartClickHandler.ts`) is UNCHANGED.
- New pure util (numeric-safe dimension/value row filter) and a per-output-kind
  filterable-panel check, applied once at `PanelCard`'s existing `usePanelData` call site.
- New `CrossFilterIndicator` component, mounted in `PanelList.tsx`.
- `frontend/src/features/panels/ui/renderers/*`: truncation-disclosure reuse where a panel is
  actively cross-filtered.
- No backend changes. No new dependencies.

## Non-goals

- Backend-driven/server-side filtering (HEL-1027).
- Dashboard variables / parameterized re-run (HEL-915) — this stays view-only, unpersisted.
- Fullscreen and per-panel refresh (their own shipped tickets).
- A chart-click-triggered or mode-toggle-triggered cross-filter (owner-rejected alternatives).
