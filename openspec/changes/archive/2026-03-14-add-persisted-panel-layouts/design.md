## Context

Helio now supports dashboard selection, a responsive panel grid, and persisted appearance settings, but panel placement resets to generated defaults on every load. Because the grid is a dashboard-level concern rather than a panel-level concern, persisted layout state should belong to the dashboard and be expressed in a shape that matches responsive grid breakpoints. `HEL-17` adds that contract and wires it through the backend and frontend so layout editing becomes durable product behavior.

## Goals / Non-Goals

**Goals:**
- Add a dashboard-owned layout object for responsive panel placement.
- Persist panel `x`, `y`, `w`, and `h` values by breakpoint.
- Load saved layouts when a dashboard is selected.
- Persist drag and resize updates from the frontend grid.
- Keep the implementation compatible with appearance customization and lazy panel loading.
- Keep the layout model modular enough for future additions like locking or per-panel constraints.

**Non-Goals:**
- Collaborative real-time editing.
- Per-user layout variants.
- Undo/redo history for layout changes.
- Advanced layout templates or design presets.
- Cross-dashboard shared layout definitions.

## Decisions

### Store layout on the dashboard
Responsive layout state will live on the dashboard resource instead of on each panel. A dashboard owns the arrangement of many panels, and `react-grid-layout` already models layout as a collection for a single grid context.

Alternative considered:
- Storing layout on each panel was rejected because the complete dashboard arrangement would be fragmented across many records and would be awkward to manage per breakpoint.

### Mirror `react-grid-layout` concepts in a typed backend-friendly contract
The stored layout object will be organized by breakpoint (`lg`, `md`, `sm`, `xs`) and contain entries keyed by panel identity with `x`, `y`, `w`, and `h`.

Alternative considered:
- Storing one flat non-responsive layout was rejected because the existing UI already depends on responsive breakpoints and would lose fidelity across screen sizes.

### Keep backend persistence dashboard-scoped and explicit
Frontend updates should submit the dashboard layout as backend-backed resource state rather than relying on local storage or client-only persistence.

Alternative considered:
- Local-only layout persistence was rejected because it would not satisfy the product expectation that dashboard state survives reloads consistently.

### Preserve safe defaults for missing panels and new dashboards
If a dashboard has no saved layout, the frontend will continue to generate a stable fallback layout. If saved layout entries refer to missing panels, they will be ignored. If new panels appear without saved layout entries, fallback positions will be generated and merged in.

Alternative considered:
- Failing hard on incomplete layout state was rejected because panel collections can evolve independently of saved layout data.

## Risks / Trade-offs

- [Saved layout data can drift from the current panel list] → Merge saved entries with generated fallbacks and ignore stale panel ids.
- [Frequent drag events can create noisy persistence updates] → Persist on completed layout changes rather than every transient move event.
- [Responsive layout contracts can become hard to reason about] → Keep the first version constrained to core grid fields and documented breakpoint keys.
