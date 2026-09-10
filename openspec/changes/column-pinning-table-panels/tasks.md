## 1. Types and persistence

- [x] 1.1 Add `pinnedColumns?: string[]` as a flat sibling field on `TableOutputConfig` in `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts`, next to `columnSort`/`columnFilters`/`columnFormats` (never nested).
- [x] 1.2 Add `persistPinnedColumns(outputId, pinned)` in `TableRenderer.tsx`, mirroring `persistColumnSort`/`persistColumnFilters` exactly: same `PERSIST_DEBOUNCE_MS` debounce, same deliberate-silent-swallow on `updateOutput` rejection, same `canWrite` pre-check. Clearing to empty MUST call it with `[]`, never skip the call (design.md Decision 6 — `mergeConfig` is a shallow merge).
- [x] 1.3 On reorder (`columnOrder` change), re-derive `pinnedColumns` in `TableRenderer` against the new order so it stays a leading, contiguous run keyed by position, and re-persist immediately (design.md Decision 1 / Risk). This derivation lives in `TableRenderer`, not `DataGrid` (design.md Decision 1 ownership split — `DataGrid` has no `columnOrder` prop).

## 2. DataGrid sticky-left rendering

- [x] 2.1 Add `pinnedColumns` prop to `DataGrid` (`full` variant only; ignored on `preview`), interpreted as a leading prefix of the `columns` array it is given (not `TableOutputConfig.columnOrder` directly).
- [x] 2.2 Implement offset computation reusing the existing `appliedWidth` fallback chain (`liveWidths ?? columnWidths[key] ?? col.width ?? DEFAULT_COLUMN_WIDTH`) as a pure, unit-testable function, density-agnostic (design.md Decision 7 — density is unreachable from the Table panel surface today).
- [x] 2.3 Apply `position: sticky; left: <offset>` to pinned columns' `<th>` (header row), `<th>` (filter row, when expanded), and `<td>` cells; recompute on resize/pin/order change.
- [x] 2.4 Add a background to pinned body cells matching the panel's own surface — `background: var(--panel-surface-override, var(--app-surface))`, the existing 5-site in-repo idiom (`PanelGrid.css`, `PanelContent.css`, `MarkdownPanel.css`, `CollectionRenderer.css`) — so scrolling content never bleeds through and a customized/translucent panel background is respected rather than overridden (design.md Decision 6, skeptic CR4 + round-2 CR1).
- [x] 2.5 Introduce the grid's first z-index scale (new work — `DataGrid.css` has none today) per design.md Decision 5: pinned header/filter corner cells `z-index: 3`, non-pinned sticky header/filter cells `z-index: 2`, pinned body cells `z-index: 1`.
- [x] 2.6 Add the pinned/scrolling boundary separator: a `::after` pseudo-element (`right: 0`, full height, 1px, `background` using the `color-mix(in srgb, var(--app-text) 35%, transparent)` token) on the last pinned column's cells, positioned against the cell's own `position: sticky` containing block (design.md Decision 8 — corrected three times: an inset shadow → a non-inset `box-shadow` that painted zero pixels under `border-collapse: collapse` → a `border-right` that painted only at rest and vanished under scroll, because a collapsed table's borders paint at the cell's static/unscrolled position, not its sticky on-screen position — the `::after` fix sidesteps the table border layer entirely).

## 3. Pin toggle affordance

- [x] 3.1 Add a keyboard-operable pin/unpin icon-button to each `full`-variant column header, alongside the existing resize handle (design.md Decision 3 — corrected a third time, skeptic-final-3: positioned via `position: absolute`, reusing the resize handle's own escape from inline flow, rather than inline flow content a truncating header could clip away).
- [x] 3.2 Accessible name reflects pin state (`aria-pressed`) and, when pinning a non-leading column, that ordered siblings ahead of it will also pin (design.md Decision 1 consequence).
- [x] 3.3 Wire toggle to compute the new leading-run pinned set (per Task Group 1) and call `persistPinnedColumns`.

## 4. Integration with sort/filter/format/density/order (AC6)

- [ ] 4.1 Verify pinned columns remain sortable and filterable (HEL-448/451) — sticky positioning must not block header/filter-row interaction, including through the new z-index scale.
- [ ] 4.2 Verify per-column formatting (HEL-469) renders correctly inside sticky cells.
- [ ] 4.3 Verify resize (HEL-253) of a pinned column updates its own and all subsequent pinned columns' offsets live, within the same session (design.md Decision 2 — widths are not persisted, so this is a same-session check).
- [ ] 4.4 Confirm density is not reachable on the Table panel surface (design.md Decision 7) — no density-variation test is executable against the panel; the offset function's density-agnosticism is covered at the unit level only (task 5.1).

## 5. Tests and verification

- [x] 5.1 Jest/RTL: offset-computation function (single column, multiple columns, custom widths) — AC6. Density is not parameterised (design.md Decision 7).
- [x] 5.2 Jest/RTL: `pinnedColumns` persistence — debounced PATCH via `persistPinnedColumns`, restore from `TableOutputConfig`, leading-run re-derivation on reorder, and an explicit assertion that clearing to empty writes `[]` rather than omitting the field (design.md Decision 6) — AC6.
- [ ] 5.3 Playwright (evaluator/skeptic, real running app, both themes): AC1 (freeze + horizontal scroll), AC2 (multi-pin cumulative offsets under real scroll, including a resize-then-scroll check within one session), AC4 (visual separator distinctness light + dark, doubly-sticky corner-cell z-index correctness) — jsdom cannot observe `position: sticky`/computed offsets/real scroll, per orchestrator brief and design.md Risks.
- [ ] 5.4 Playwright: pin state persists across panel-detail-modal open/close and full page reload (AC3); confirm a pre-reload custom width resets to default post-reload as the accepted Decision 2 consequence, not treated as a defect.
- [ ] 5.5 Manual/Playwright regression pass confirming no regression to resize, sort, filter, density, or column order (AC6) on the same table surface HEL-448/451/469 modified.
