## Context

The `dashboardLayout.ts` module owns all layout computation for the panel grid. `createBaseLayout` currently assigns positions using a sequential index formula (`x = (index % itemsPerRow) * itemWidth`, `y = Math.floor(index / itemsPerRow) * defaultItemHeight`). This works for a full re-generation (e.g. creating a fresh fallback for all panels at once) but produces incorrect results when a new panel is appended to an existing saved layout — the new panel gets index-based coordinates that ignore the real occupied cells, causing overlaps or vertical stacking at `x=0, y=0`.

The only consumer of position generation for newly-added panels is `createFallbackDashboardLayout` → `createBaseLayout`, which is called by `resolveDashboardLayout` to supply fallback entries for panels that have no saved position. This is the exact code path that fires when a panel is created and the panel list is re-fetched.

No backend changes are required. The layout is a client-side concern until the user triggers a persist.

## Goals / Non-Goals

**Goals:**
- New panels placed beside existing ones, filling horizontal space first
- Wrap to a new row only when no slot wide enough exists in the current rows
- Correct at all four breakpoints (lg, md, sm, xs)
- Keep `createFallbackDashboardLayout` as the single generation entry point (no new public API surface)
- Pure function — no side effects, deterministic given inputs

**Non-Goals:**
- Packing / bin-packing optimisation (no gap-filling in interior holes left by deleted panels)
- Changing the default panel dimensions (4w × 5h at lg/md, 3w × 5h at sm, 2w × 5h at xs — as already established in `createBaseLayout`)
- Moving or re-ordering existing panels
- Backend-side position assignment

## Decisions

### Decision 1: Position algorithm — row-scan slot finder

**Chosen**: Scan row by row from y=0, and within each row scan x=0..colCount-itemWidth. For each candidate (x, y) check whether any existing item overlaps the rectangle `[x, y, x+w, y+h]`. Return the first non-overlapping candidate. If the grid is fully occupied, append at `y = maxOccupiedBottom`.

**Alternatives considered**:
- *Column-height array (Tetris-style)*: Track the lowest free y per column. Simpler O(cols) but harder to reason about rectangular fit with variable-width items.
- *Regenerate all positions every time*: Re-run `createBaseLayout` over the full panel list. Simpler but discards any manual arrangement the user made for existing panels — unacceptable.

**Rationale**: The row-scan approach is straightforward to test, handles arbitrary existing layouts (including gaps left by deletions), and is O(rows × cols) which is negligible for dashboard-scale grids (≤100 panels on a ≤12-col grid).

### Decision 2: Integration point — inside `createBaseLayout`, not a new export

**Chosen**: Replace the index formula in `createBaseLayout` with incremental slot-finder calls. Each panel in the `panels` list that needs a fallback position calls `findNextAvailablePosition(alreadyPlaced, colCount, itemWidth, itemHeight)` and appends to `alreadyPlaced` before moving to the next panel.

**Rationale**: `createBaseLayout` is the single authoritative source for generated positions. Keeping the change local avoids scatter and does not change any public API. The function already receives `colCount`; `itemWidth` and `itemHeight` are local constants — no signature change needed.

### Decision 3: Self-approved scope decisions

- Default item height remains `5` (consistent with `defaultItemHeight` constant and `panelGridConfig.itemHeights.default`).
- Item widths per breakpoint remain as-is: `lg/md → 4`, `sm → 3`, `xs → 2`.
- The new helper `findNextAvailablePosition` is a module-private function (not exported), keeping the public API surface unchanged.
- Tests are added to `dashboardLayout.test.ts` alongside the existing suite.

## Risks / Trade-offs

- **Overlap with saved items**: `resolveDashboardLayout` replaces any generated position with the saved one if present, so a collision between the generated fallback and a saved item cannot appear in the resolved output. The generation only runs for panels missing from the saved layout. → No mitigation needed; the architecture already handles this correctly.
- **Large saved layouts with gaps**: The row-scan always picks the topmost-leftmost available slot, which may not always feel "natural" if the user has deliberately left gaps. However, because existing panels are never moved, the worst case is a new panel appearing in a gap the user left — which is acceptable and arguably desirable. → Accept.
- **xs breakpoint with colCount=2 and itemWidth=2**: Only one item per row. The algorithm degenerates to appending rows — functionally identical to the current behaviour. → Accept; no regression.

## Migration Plan

No data migration required. The change is purely additive client-side logic. Existing saved layouts are unaffected. On next panel creation the smart position is computed and persisted as part of the normal layout-persist cycle.

## Planner Notes

Self-approved decisions (no escalation required):
- Pure frontend change — no API surface changes, no new external dependencies
- New helper kept private to `dashboardLayout.ts` — no public API change
- Default panel dimensions unchanged from current `createBaseLayout` constants
- Test strategy: extend existing `dashboardLayout.test.ts` with new describe block for `findNextAvailablePosition` behaviour via `createFallbackDashboardLayout`
