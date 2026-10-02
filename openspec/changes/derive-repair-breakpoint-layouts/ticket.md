# HEL-1023: Dashboard panels overlap and displace when grid breakpoint disagrees with window width

## Description

At certain window widths panels render displaced or overlapping (a panel spans space it does not own, siblings pushed out of view, large dead regions). Widening the window to the next breakpoint re-flows everything correctly. Reproduced on prod ("News Overview"). `PanelGrid` uses React Grid Layout with four responsive breakpoints (lg/md/sm/xs) and `noCompactor`; layouts are persisted per breakpoint. When a breakpoint has no/incorrect layout, nothing repairs the placement. Related: `mobilePanelHeights.ts` constants never revisited.

## Acceptance criteria

* Panels never overlap or render outside their grid cell at any window width.
* A dashboard authored at one breakpoint renders sensibly at every other breakpoint.
* Behavior is defined and tested for the case where no layout exists for the active breakpoint.
* Verified across lg/md/sm/xs on a dashboard with mixed panel types (markdown, image, chart).

## Owner ruling (2026-10-01, binding)

* Missing layout for the active breakpoint: derive at render from the nearest authored breakpoint, scaled to that breakpoint's column count and compacted so nothing overlaps.
* Overlapping saved layout for the active breakpoint: same repair at render.
* A derived or repaired layout is persisted ONLY when the user edits at that breakpoint, never silently on view.
* An authored, non-overlapping layout renders exactly as saved, intentional gaps included (noCompactor semantics preserved).
* Rejected: always-on vertical compaction.
* Sibling HEL-1071 (later; not built here): server will reject overlapping layouts with 400. Keep overlap detection a small pure function with a clear contract a backend/MCP change could mirror. No backend validator here.

## Driver constraints (claims to verify)

* Below 768px container width PanelGrid renders MobilePanelStack, not RGL; determine what the stack uses for order/size and define ruling behaviour for it.
* HEL-1028 (#726) must not regress: e2e/hel1028-layout-undo-redo-visual-revert.spec.ts must stay green. A render-time derived layout must not count as a user edit, mark the dashboard dirty, or enter undo history.
* RGL Responsive re-syncs only when the `layouts` prop changes; derived layouts must be referentially stable (memoised) to avoid churn/loops.
* Deliverables: real-browser Playwright spec with mixed kinds (markdown, image, chart) across reachable breakpoints, red on main / green with fix; unit tests for the pure derive/repair function, mutation-failable; a test failing under always-on compaction.
