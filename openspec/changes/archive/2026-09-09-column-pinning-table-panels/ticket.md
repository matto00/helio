# HEL-465: Column pinning (freeze leading columns) on table panels

## Description

### Context

Column resize already ships on `DataGrid` (`frontend/src/shared/ui/DataGrid.tsx`, HEL-253) and column order/visibility on table panels (HEL-255). What is missing from the drafted "column resize + pin" work is **pinning**: freezing one or more leading columns so they stay visible while the rest of a wide table scrolls horizontally. This ticket covers pin only (resize is done).

### Scope

* Add column pinning to the `full`-variant `DataGrid`: pinned columns stick to the left edge via `position: sticky` while the table scrolls horizontally inside its `overflow-x` container.
* Pin toggle affordance in the column header (menu or button), keyboard operable with an accessible name (DESIGN.md §8).
* Persist the pinned-column set on `panel.config` (extend `frontend/src/features/panels/types/panel.ts` and the persist path in `frontend/src/features/panels/state/panelsSlice.ts`, mirroring the `columnWidths`/`columnOrder` debounced-PATCH idiom).
* Sticky offset math must respect per-column widths (`columnWidths`) and density so multiple pinned columns stack correctly; add a subtle separator/shadow between the frozen region and the scrolling region using existing tokens (DESIGN.md §3).
* Interplay with column order: pinned columns render at the left regardless of their order position, or constrain pin to the leading ordered columns — pick one and document it.

## Acceptance Criteria

* Pinning a column freezes it to the left; the rest of the table scrolls horizontally beneath the pinned region.
* Multiple pinned columns stack with correct cumulative offsets across densities and custom widths.
* Pin state persists across modal open/close and reload.
* Frozen/scrolling boundary is visually distinct using theme tokens (light + dark).
* No regression to resize, sort, filter, density, or column order.
* Jest/RTL coverage for offset computation and persistence.

## Out of Scope

* Right-edge pinning.
* Column resize (already shipped, HEL-253).
* Pinning on the `preview` variant.

## Dependencies

* Builds on HEL-253 / HEL-255. Binding: DESIGN.md, CONTRIBUTING.md.

## Notes from premise validation (orchestrator, Setup)

* Ticket text's `panelsSlice.ts` path is stale — actual path is `frontend/src/features/panels/state/panelsSlice.ts`.
* HEL-448 (sort), HEL-451 (filter), HEL-469 (per-column formatting) have all landed on `main` since this ticket was filed and touch the same `DataGrid.tsx` column-header region. AC6 ("no regression to resize, sort, filter, density, or column order") must be validated against all three, not just HEL-253/255.
* The DataGrid header row already uses `position: sticky` for its own top-pin (vertical). Column pinning introduces a second, horizontal sticky axis in the same table — the corner cell (pinned column x sticky header row) needs explicit z-index/layering attention.

## Correction from the design-gate skeptic (round 1, REFUTE)

The premise-validation check above corrected the `panelsSlice.ts` **path** but never checked its
**contents**, and missed a materially bigger drift: HEL-909 retired the bound `TablePanelConfig`
(metric/chart/table) entirely. Table column state (`columnOrder`, `columnSort`, `columnFilters`,
`columnFormats`) lives on `TableOutputConfig` (the bound Output), persisted via `updateOutput`
from `TableRenderer.tsx` — not `panel.config` via `panelsSlice.ts` at all. `pinnedColumns` must
land there too, as a flat sibling field; `outputConfigTypes.ts`'s own doc comment on `columnSort`
already names this exact ticket. See `design.md` Context and `skeptic-design-1.md` for the full
correction. Recorded here as an instance of "validate the premise before building" reaching past
a single stale path into a load-bearing architectural fact.
