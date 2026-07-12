## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed explicitly: drag handle on column-header right edge (backend + frontend
  wiring present), 60px minimum enforced (`MIN_COLUMN_WIDTH` in `DataGrid.tsx`), width changes
  debounced (400ms, `TableRenderer.tsx`) and persisted via the existing panel-config PATCH path
  (`updatePanelColumnWidths`), independent per-column resize (no redistribution) at the *data*
  level (see Phase 2/3 for a *rendering*-level violation of this same requirement).
- No AC silently reinterpreted.
- All `tasks.md` items are marked `[x]` and match what was implemented; task 4.5 is honestly
  flagged "PARTIAL" (live drag verification not performed by the executor) rather than falsely
  claimed complete — appropriate.
- No scope creep: the added `column_widths` JSONB column + `PanelRepository`/`PanelRowMapper`
  wiring + `V53__panel_column_widths.sql` migration, while not spelled out in `tasks.md`/`design.md`,
  is a necessary and correctly-scoped corollary of the ticket's own "widths persist across reload"
  DoD — a `TablePanelConfig` field cannot survive a real reload without a DB column. It mirrors the
  existing `aggregation` column precedent (`V43__panel_aggregation_column.sql`) exactly: same
  nullable-JSONB-column shape, same `configColumnsOf`/`configColumnValuesOf` tuple-threading
  pattern, same `jsObjectColumn`/`parseJsObject`-style mapper helpers. Verified: `V53` is the correct
  next migration number, applies cleanly, and all 1259 backend tests (including new `PanelSpec.scala`
  coverage of this column) pass. This is sound engineering judgment, not scope creep.
- No regressions found to existing panel-config behavior — `PanelSpec.scala` explicitly covers
  cross-field isolation (`columnWidths`-only patch leaves `dataTypeId`/`fieldMapping` untouched and
  vice versa) in both directions.
- API contracts updated together: `schemas/panel.schema.json`'s `TableConfig.columnWidths` added in
  the same change as the Scala codec; `check:schemas` (schema/JsonProtocols drift check) passes.
- Planning artifacts (design.md's "Scope boundary vs. HEL-255" section, `workflow-state.md`) reflect
  the final implemented behavior; the HEL-255 boundary decision is recorded as human-approved, not a
  self-approval.

### Phase 2: Code Review — FAIL
Issues:

1. **Critical: the resize interaction has no real effect in a rendered browser table.**
   `DataGrid.tsx` applies the live/persisted width via `style={{ width: appliedWidth }}` on each
   `<th>`, but `.ui-data-grid__table` (`DataGrid.css`) never sets `table-layout: fixed` (default is
   `auto`). Under CSS auto table layout with a `<table>` at `width: 100%` (`.ui-data-grid--full`),
   the browser's table-layout algorithm treats an inline `width` on a `<th>` as a non-binding hint,
   not an enforced pixel width, and effectively ignores it in favor of content-based auto-sizing —
   confirmed live (see Phase 3). This means the core, headline DoD item ("Drag-to-resize works on
   Table panels") does not actually work visually in a real browser, even though: (a) the drag
   gesture's math is correct (delta/clamp/live-callback all verified correct via the inline `style`
   attribute actually being set to the intended pixel value), (b) the persisted PATCH fires and
   round-trips through the DB correctly, and (c) every Jest/jsdom assertion for this behavior passes
   — because jsdom has no real CSS layout engine and `toHaveStyle({ width: "250px" })` only checks
   the inline style attribute, not actual rendered/computed width. This is precisely the kind of gap
   the ticket flagged needing live-browser verification for, and it is a genuine, reproducible defect,
   not a false-negative in the test suite.
   - `frontend/src/shared/ui/DataGrid.css` (missing `table-layout: fixed` on `.ui-data-grid__table`,
     or equivalent `<colgroup>`/`<col>` strategy)
   - `frontend/src/shared/ui/DataGrid.tsx:169-197` (per-`<th>` inline `style` width application)

2. **Non-blocking, but load-bearing for the fix above**: naively adding `table-layout: fixed` is not
   a safe one-line fix on its own — verified live that flipping it on causes *unresized* columns
   (which have no explicit `width`) to collapse toward near-zero width (observed 13px), because fixed
   layout allocates space using only the first row's declared widths and no longer measures content.
   The fix needs every column (not just resized ones) to carry an explicit width once any resize
   capability is active — e.g. seed a default width per column (from the current natural/derived
   width) into `columnWidths`/`liveWidths` state on mount, or apply `col.width`/a computed default as
   a `<colgroup>` and only override the touched column's `<col>` element on resize. This is squarely
   a design/implementation task for the executor to solve, not something the evaluator should
   prescribe as the only valid fix.

DRY/readable/modular/type-safety/error-handling/no-dead-code/no-over-engineering checks otherwise
pass cleanly — the backend `columnWidths` plumbing exactly mirrors the `fieldMapping`/`aggregation`
precedents, the frontend patch/service/state wiring is appropriately separated (`buildTableWidthsPatch`
kept independent of `buildBindingPatch`, matching the design rationale), and the debounce idiom
matches `ComputedFieldForm.tsx` as claimed. `check:scala-quality` is clean (no inline FQNs introduced;
pre-existing file-size soft-budget warnings on `PanelRepository.scala` (317 lines pre-change, 321 now)
are informational-only and not a new violation caused by this change — file grew by only 4 lines).

### Phase 3: UI Review — FAIL
Issues:

Live verification performed via Playwright MCP against the running dev servers
(`localhost:5426`/`localhost:8333`, backend already healthy/reused, migration V53 applied — 53
migrations confirmed via a fresh `sbt test` run beforehand). Used the pre-existing "HEL-254 Scroll
Verification" dashboard's 30-column Table panel (`col_0`..`col_29`) as a ready-made
enough-columns-for-horizontal-interaction fixture.

- **Happy path (drag-to-resize) — FAILS.** Dispatched a genuine `mousedown` → `mousemove` →
  `mouseup` drag sequence on `col_11`'s and `col_12`'s resize handles in the real browser (not
  jsdom). Confirmed via `th.style.width` that the component correctly computed and applied
  143.69px / 146.94px respectively (matching the drag-delta math exactly). Confirmed via
  `getBoundingClientRect().width` that the **actual rendered column width did not change** (stayed
  at ~63-67px, indistinguishable from never-touched sibling columns) — see Phase 2 issue #1 for root
  cause. A user dragging a column border in this app today sees **no visual change whatsoever**.
- **Non-interference with PanelGrid — PASSES.** During the same live drag, the panel card's
  `react-grid-item` bounding box (`top`/`left`/`width`/`height`) was captured before and after and
  was byte-identical; its class list never gained a dragging-state class. Column-resize mousedown
  does not trigger a panel-level drag or resize. This specific ticket risk (RGL interference) is
  correctly mitigated.
- **Persistence across a real page reload — PASSES at the storage layer, but the underlying bug
  above means it is not user-visible.** After the drag above, a `PATCH /api/panels/:id` fired
  (confirmed via `browser_network_requests`) and returned 200. After a full page reload
  (`browser_navigate` to the same URL), the resized column's `th.style.width` was still `167px`
  (from a separate `col_14` drag), confirming the DB round-trip persists correctly — but the
  *rendered* width was still ~67px for the same reason as above. So "widths persist across reload"
  is true of the stored data but false of what the user actually sees, which is the part of the DoD
  that matters.
- No console errors observed during any of the above (0 errors across all navigations/drags).
- Accessible name present on the resize handle (`aria-label="Resize column <name>"`,
  `role="separator"`) — DESIGN.md §8's mechanical "interactive elements have accessible names" rule
  is satisfied.
- Keyboard operability of the resize handle was not implemented (no keydown handler / no
  arrow-key-based resize) — DESIGN.md §8's "keyboard operable" line is not tagged `[mechanical]` in
  this doc, so this is recorded as a non-blocking suggestion for the skeptic's judgment call, not a
  Phase 3 mechanical failure.
- Breakpoint check: the dashboard canvas is a zoom/pan builder surface (bottom-right 100%/Reset
  control) rather than a standard responsive page, so the four standard breakpoints (1440/1100/768/0)
  are not very informative for this specific panel-canvas surface; no additional layout breakage was
  observed at 768px viewport width beyond the pre-existing (unrelated) canvas-zoom behavior.

### Overall: FAIL

### Change Requests
1. Add `table-layout: fixed` (or an equivalent `<colgroup>`/`<col>`-based width-enforcement
   strategy) to `.ui-data-grid__table` so that per-column pixel widths set via `columnWidths`/drag
   actually take effect in a real browser — currently the browser's default auto table-layout
   algorithm silently ignores the inline `width` style set on resized `<th>` elements.
   (`frontend/src/shared/ui/DataGrid.css`)
2. Handle the side effect of (1): once `table-layout: fixed` is active, every column — not just the
   one the user has dragged — needs an explicit width (seed a sensible default, e.g. the column's
   current natural/derived width, into state on mount, or manage per-column `<col>` elements),
   otherwise un-resized columns will collapse toward a near-zero width as soon as any column has an
   explicit width and fixed layout is engaged (verified live: an untouched column shrank to ~13px).
   (`frontend/src/shared/ui/DataGrid.tsx`)
3. After the fix, re-verify live in a real browser (Playwright or equivalent) that: (a) dragging a
   handle visibly resizes only that column, (b) other columns' widths are visually unchanged, (c) a
   resized width visibly persists after a real page reload — not just at the `style` attribute /
   DB-row level, but as actually rendered.
4. Add or extend a test that would have caught this class of bug — e.g. a Playwright/E2E-style test
   asserting actual computed layout, or at minimum a jsdom-layer safeguard is insufficient here by
   construction (jsdom has no table-layout engine), so this specific behavior needs a real-browser
   check as a standing regression guard (or an explicit code comment noting why `table-layout: fixed`
   is required, so a future refactor doesn't silently drop it).

### Non-blocking Suggestions
- Consider keyboard operability for the resize handle (e.g. arrow-key nudging while focused) — not
  a DESIGN.md `[mechanical]` requirement today, but worth a skeptic judgment call given the handle is
  a `role="separator"` with no keyboard path currently.
- `DataGrid.tsx`'s `liveWidths` local state is never reset if a `DataGrid` instance were ever reused
  across different `panelId`s without unmounting (unlikely today since `TableRenderer`/`PanelContent`
  appear to always be keyed per-panel, but worth a defensive reset-on-key-change if that assumption
  ever changes) — not currently reachable, so not a blocking issue.
