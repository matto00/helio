## Evaluation Report — Cycle 2

### Phase 1: Spec Review — PASS
Issues: none.

- Cycle 1's four change requests are all addressed and traceable in `tasks.md` §5
  (5.1–5.4) with an honest, matching `files-modified.md` account:
  1. `table-layout: fixed` added, scoped to `.ui-data-grid--full .ui-data-grid__table`
     only (verified the DOM structure actually supports this descendant-combinator
     scoping — the root `<div>` carries `ui-data-grid--{variant}`, the `<table>` carries
     the plain `ui-data-grid__table` class as a descendant, so `--preview` consumers are
     structurally excluded, not just excluded by convention).
  2. `DEFAULT_COLUMN_WIDTH = 160` seeded as a fallback (`liveWidths[key] ?? columnWidths?.[key]
     ?? col.width ?? DEFAULT_COLUMN_WIDTH`) so every full-variant column gets an explicit
     width once fixed layout is active.
  3. Re-verification requirement — addressed and independently reproduced myself (Phase 3).
  4. A regression guard was added specifically targeting the class of bug that shipped in
     cycle 1: `TableRenderer.test.tsx`'s previously-inverted assertion (`not.toHaveAttribute("style")`)
     is now `toHaveStyle({ width: "160px" })`, plus a new static-source guard in `DataGrid.test.tsx`
     asserting the CSS rule text and that every rendered `<th>` carries an explicit width — correctly
     documented as a stand-in for a real-browser check, not a replacement for one.
- The non-blocking keyboard-operability suggestion from cycle 1 was also addressed (task 5.5,
  not required for a PASS but tracked honestly as "addressed").
- The other non-blocking suggestion (`liveWidths` reset-on-`panelId`-change) was left
  unaddressed at item 5.6, with an explicit, accurate rationale matching cycle 1's own
  assessment ("not currently reachable"). This is the correct call — leaving a non-blocking
  item unaddressed with a stated reason is not a regression.
- `workflow-state.md` and `tasks.md` accurately reflect cycle 2's state (CYCLE: 2,
  `LAST_EVAL_VERDICT: FAIL`, correct report pointer).
- No scope creep beyond the change-request-driven fix; no new AC introduced or reinterpreted.

### Phase 2: Code Review — PASS
Issues: none.

- Diffed `860cd87..6e81104` directly (8 files, +373/-12, all frontend + planning docs — no
  backend/schema changes this cycle, consistent with the fix being CSS/DataGrid-only).
- `DataGrid.css`: the `table-layout: fixed` rule carries an in-file comment explaining why it's
  scoped to `--full` and warning against hoisting it to the unscoped selector without auditing
  `--preview` call sites — directly satisfies cycle 1's request to guard against a silent future
  regression. The new `:focus-visible` rule (`outline: 2px solid var(--app-accent); outline-offset: 2px`)
  matches DESIGN.md's own mechanical global focus rule verbatim (`DESIGN.md:219`,
  `outline: 2px solid var(--app-accent)`), not a bespoke pattern.
- `DataGrid.tsx`: `DEFAULT_COLUMN_WIDTH`/`KEYBOARD_RESIZE_STEP` are named constants with
  doc comments explaining the "why" (no magic numbers). `handleResizeKeyDown` mirrors
  `handleResizeStart`'s existing clamp/callback/state-update pattern exactly (DRY — no new
  abstraction invented, reuses `MIN_COLUMN_WIDTH`, `setLiveWidths`, `onColumnResizeRef`).
  `e.preventDefault()`/`e.stopPropagation()` on keydown mirrors the mousedown handler's existing
  defense-in-depth rationale against ancestor (PanelGrid) event handlers.
- Tests: the fixed `TableRenderer.test.tsx` assertion and new `DataGrid.test.tsx` suites
  (keyboard-nudge behavior + static-source regression guard) are meaningful — the static guard
  specifically encodes *why* it exists (jsdom has no layout engine) and cites `evaluation-1.md`,
  which is good provenance for future maintainers who might be tempted to delete a
  regex-matching-CSS-text test as "weird."
- No dead code, no over-engineering (no colgroup/`<col>` alternative needlessly introduced when
  the simpler fixed-width fallback works), no type-safety regressions.
- Reran `check:schemas` and `check:scala-quality` fresh — both clean (schema check: in sync,
  10 checked across 17 protocol files; scala-quality: 41 pre-existing soft-budget warnings only,
  same set as cycle 1's `PanelRepository.scala` note — no new violations, since this cycle
  touched no backend files).

### Phase 3: UI Review — PASS
Issues: none.

Live-verified via Playwright MCP against the running dev servers (`localhost:5426`/`localhost:8333`,
already healthy and reused via `scripts/concertino/start-servers.sh`; `sbt test` confirms 53
migrations applied, including V53). Used the same "HEL-254 Scroll Verification" dashboard's
30-column Table panel fixture as cycle 1, independently reproducing the exact scenario cycle 1
found broken:

- **Happy path (drag-to-resize) — now PASSES.** Dispatched a real `mousedown` → `mousemove` →
  `mouseup` sequence on `col_11`'s resize handle (window-level listeners, matching the component's
  actual event-wiring). After allowing the React state update to flush, `getBoundingClientRect().width`
  for the dragged column **matched its inline style width exactly** (143px → 223px → 303px across
  two successive drags), which is precisely the rendering behavior cycle 1 found broken (previously
  the rect stayed pinned at ~63–67px regardless of the style attribute). Sibling columns (`col_12`,
  `col_10`) were confirmed unchanged at their own widths (146px / 160px) after the drag — no
  redistribution.
- **Unresized-column fallback — verified.** Untouched columns render at exactly 160px
  (`DEFAULT_COLUMN_WIDTH`) rather than collapsing, both in `style` and actual rendered rect —
  confirms fix #2 from cycle 1's change requests.
- **Non-interference with PanelGrid — re-confirmed.** Captured the `.react-grid-item`'s
  `getBoundingClientRect()` and `className` before/after the drag: byte-identical box, no
  `dragging`-state class change. Column-resize does not trigger panel-level drag/resize.
- **Persistence across a real page reload — now user-visible, not just DB-level.** Confirmed two
  `PATCH /api/panels/:id` → 200 requests fired (one per drag, via `browser_network_requests`).
  After a genuine `page.goto()` reload of the same URL (full navigation, not client-side routing),
  `col_11` rendered at 303px in **both** `style` and `getBoundingClientRect()` — the specific gap
  cycle 1 flagged ("stored data true, rendered width false") is closed.
- **Keyboard operability — live-verified, not just unit-tested.** Focused the resize handle for
  `col_15` (`tabIndex=0`, confirmed `document.activeElement`), pressed a real `ArrowRight` key via
  Playwright's keyboard API (not a synthetic dispatch), and confirmed the column grew exactly
  `KEYBOARD_RESIZE_STEP` (10px: 320px → 330px) in both style and rendered width. A screenshot
  additionally shows the `:focus-visible` ring rendering on the handle.
- **Accessible name / role** — `aria-label="Resize column <name>"` / `role="separator"` present,
  unchanged from cycle 1's already-passing check.
- **Console** — 0 errors across all navigations, drags, and the keyboard interaction (1 pre-existing
  unrelated warning, consistent with cycle 1).
- **Breakpoints** — resized to 1440 and 768; no new console errors or layout breakage introduced by
  the `table-layout: fixed` change (consistent with cycle 1's note that this canvas surface isn't a
  standard responsive page).
- Spot-checked a `--preview`-variant `DataGrid` consumer's containing page (pipeline detail) loads
  without console errors post-change; did not find a rendered preview table on the specific page
  visited within this review's time budget, so this is a lighter-weight check than the `--full`
  verification above — but the CSS/DOM-structure analysis in Phase 2 (descendant-combinator
  selector correctly scoped to `--full`'s ancestor class) is the stronger, structural guarantee here
  and was verified directly against the actual rendered class list.

### Overall: PASS

### Non-blocking Suggestions
- Same as cycle 1, still open and correctly tracked as such in `tasks.md` 5.6: `DataGrid`'s
  `liveWidths` local state has no reset-on-`panelId`-change guard. Not reachable today (every
  `DataGrid` consumer remounts per panel), so not a blocking issue — flagging again only so it
  isn't lost if that mounting assumption ever changes.
