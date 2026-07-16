## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

Evidence:
- All ticket ACs addressed: density dropdown (Condensed/Normal/Spacious), column visibility +
  up/down order controls, column widths persisted via existing HEL-253 path (unchanged), vestigial
  `columns` fieldMapping slot removed from `PANEL_SLOTS` (`frontend/src/features/panels/state/panelSlots.ts:18`).
  Verified live: density persists (`Condensed` survives modal reopen + full page reload), columnOrder
  persists (hide + reorder survives modal reopen + full page reload), unbound Table panel hides the
  Columns control (verified via "Clear selected data type" on a live panel) while still showing density.
- Storage scope matches the binding escalation resolution exactly: two nullable columns
  (`table_density`, `column_order`) added by one Flyway migration (`V55__panel_table_display_config.sql`),
  no other panel kinds touched, no generalized display-config abstraction introduced.
- `configColumnsOf`/`configColumnValuesOf` tuple pair extended 12 → 14 as required
  (`PanelRepository.scala:251-272`); persistence verified through a real repository/endpoint round-trip
  test (`ApiRoutesSpec.scala`), not just an in-memory `PanelRowMapper` round-trip, per design D3.
- Wire-omission (spray-json `Option=None` drop) explicitly tested with fields ABSENT (not just null)
  in `PanelSpec.scala` ("default to None when the fields are ABSENT" / "omit absent density/columnOrder
  from the wire").
- Pre-existing Table panels (created before this migration) verified live to render with normal
  density (35px row height vs. 24px condensed) and natural column order — migration-clean per DoD.
- Tasks.md: all 22 items marked done match the diff; no scope creep found outside the listed impacted
  files in `files-modified.md`.
- Planning artifacts (design.md/proposal.md/specs) match the implemented behavior; no reinterpreted ACs.

### Phase 2: Code Review — FAIL
Issues:

1. **Literal NUL byte embedded in a TS source file** —
   `frontend/src/features/panels/ui/editors/useTableDisplayState.ts:98`:
   ```
   const buildKey = `${resetNonce}|${selectedTypeId ?? ""}|${fieldKeys.join("\x00")}`;
   ```
   The join separator is a literal `\x00` control character (confirmed via `xxd`/hex dump of the file
   on disk — the `Read` tool silently renders it as a space, which is why it doesn't show up in a
   normal review). This makes `git diff`/`git show` treat the entire file as **binary** (`Bin 0 ->
   6512 bytes` in `git diff main...HEAD --stat`), meaning this file's actual content changes are
   invisible to a human reviewer in a PR review UI (GitHub renders "Binary file not shown" for NUL-
   containing files) — a direct contradiction of "diff first" review practice this repo relies on.
   It is otherwise harmless today (only used to build a re-seed key, never persisted or rendered),
   but it is fragile (any real field key that itself contained `\x00` — unlikely but not impossible
   coming from arbitrary CSV/pipeline data — would silently corrupt the key) and non-obvious. Replace
   with a safe, printable separator that keeps the file as text, e.g. `JSON.stringify(fieldKeys)` (also
   more robust against a key containing whatever separator is chosen) instead of `fieldKeys.join("\x00")`.

Otherwise clean: `sbt test` (1339/1339), `npm test` (1039/1039, 96 suites), `npm run lint` (zero
warnings), `npm run format:check`, `npm run check:schemas`, and `npm run check:scala-quality` (42
pre-existing soft-budget warnings, none new/blocking) all pass. Imports/qualifiers rule honored (no
inline FQNs added). DESIGN.md tokens used throughout the new CSS (`--space-*`, `--app-*`, `--control-*`,
`--text-*` — no literal px/hardcoded colors found in the new `PanelDetailModal.css` block). Shared
`Select` component reused for density; new `TableDisplayFields`/`useTableDisplayState` split keeps
`BindingEditor.tsx` at 400 lines (was 370; soft-budget informational only, not a hard violation).
Backend `TablePanel.scala`/`RequestValidation.scala`/`PanelRowMapper.scala`/`PanelRepository.scala`
changes mirror the cited `columnWidths`/`imageFit` precedents exactly, with clear doc comments citing
the precedent and the 22-tuple Scala limit workaround (HList) is explained inline. No dead code, no
TODO/FIXME left behind, no over-engineering — the hook/component split is proportionate.

### Phase 3: UI Review — FAIL
Issues:

2. **"Reset column widths" is incorrectly disabled immediately after an in-session column resize
   (before any page reload)**, because the debounced resize PATCH bypasses Redux entirely:
   - `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:112`: `void
     updatePanelColumnWidths(panelId, next);` — a fire-and-forget axios call; the resolved `Panel`
     response is discarded, so the Redux-stored panel's `config.columnWidths` is never updated.
   - `frontend/src/features/panels/ui/editors/useTableDisplayState.ts:82`: `const storedWidths =
     isTable ? panel.config.columnWidths : undefined;` — `hasStoredWidths` (used to enable/disable the
     Reset button) is derived from this same stale Redux-stored `panel` prop.
   - **Reproduced live**: resized a column via the grid's keyboard resize handle (network tab
     confirmed three `200 OK` PATCHes to `/api/panels/:id`), waited >1s for the debounce to settle,
     then reopened the panel's edit pane in the same session — "Reset column widths" rendered
     **disabled**. Reloading the page (fresh fetch) and reopening the same edit pane rendered it
     correctly **enabled**.
   - This directly contradicts the ticket's own required verification scenario ("Resize a column,
     save-settle (~1s), then Reset column widths + Save → widths return to defaults **without
     reload**") and the spec's "Reset widths clears stored widths without reload" scenario — as
     implemented, a user cannot actually reach an enabled Reset button in that exact continuous flow;
     they must reload first. Fix by threading the resize PATCH's resolved `Panel` (or just the new
     `columnWidths`) back into the Redux-stored panel — e.g. dispatch a lightweight action/reducer
     update from `TableRenderer`'s resize handler (mirroring how `updatePanelBinding`'s `fulfilled`
     reducer already keeps the stored panel in sync), or otherwise give `useTableDisplayState` a
     non-stale source of truth for "are there currently stored widths."

Everything else in Phase 3 passed with live evidence:
- Happy path end-to-end: create Table panel bound to a 30-field pipeline-output DataType
  (`HEL254WideType`) → density Condensed + hide 1 column + reorder 1 column → Save → grid re-renders
  immediately (24px row height, correct column set/order) without reload → reopen modal shows
  persisted values → full page reload preserves both density and columnOrder (verified via
  `getBoundingClientRect`/DOM inspection, not just visually).
- Reset column widths (once genuinely enabled, post-reload) → Save → grid returns to the DataGrid
  default 160px column width without reload.
- Cancel correctly reverts an in-progress density change (confirmed via the discard-changes prompt
  and reopening the pane afterward — density still showed the last-saved value, not the discarded one).
- Unbound Table panel (cleared data type on a live panel): Columns control correctly disappears;
  density dropdown remains visible (per spec, density isn't binding-gated).
- Pre-existing Table panel (`HEL-254 30x200 Table`, updated 7/12/2026, before this migration): renders
  with normal density (35px rows) and natural column order — no NULL-column regression.
- **Mobile (390×844)**: config applies in the read-only `MobilePanelStack` — verified condensed
  density (24px rows) and the same hidden/reordered columns render identically to desktop, with no
  console errors. Edit-pane touch targets all measured ≥44px via `getBoundingClientRect`: density
  `Select` trigger 44px, column-visibility label 44px, column row 54px, up/down buttons 44×44px, Reset
  button 44px — all backed by the extended `PanelDetailModal.css.test.ts` CSS-lock test. No horizontal
  overflow (`document.documentElement.scrollWidth === innerWidth === 390`) in either the dashboard
  stack or the open edit-pane dialog.
- Breakpoints 1440/1100/768 all render without layout breakage (screenshots captured); mobile shell
  (BottomNav) correctly activates at/under 768px.
- Console: 0 errors across the entire session (a pre-existing, unrelated `selectPipelineOutputDataTypes`
  memoization warning appeared throughout — not introduced by this diff, not touched by
  `files-modified.md`, not blocking).

### Overall: FAIL

### Change Requests
1. Fix the stale `hasStoredWidths`/Reset-button state: after a column-resize PATCH resolves, sync the
   result back into the Redux-stored panel (or otherwise stop `useTableDisplayState` from reading a
   value that a same-session resize can never update) so "Reset column widths" is enabled exactly when
   widths are actually stored, without requiring a page reload first. See
   `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:112` and
   `frontend/src/features/panels/ui/editors/useTableDisplayState.ts:82`.
2. Replace the literal `\x00` join separator in
   `frontend/src/features/panels/ui/editors/useTableDisplayState.ts:98` with a safe, printable
   construction (e.g. `JSON.stringify(fieldKeys)`) so the file is not treated as binary by `git`/PR
   review tooling, and so an adversarial/unlikely field key containing a NUL byte can't corrupt the
   re-seed key.

### Non-blocking Suggestions
- `BindingEditor.tsx` is now 400 lines (CONTRIBUTING.md's "propose a split" threshold), up from 370
  pre-change. Not a hard violation (file-size warnings are informational per CONTRIBUTING.md and
  `check:scala-quality`/equivalent doesn't gate frontend files), and the executor already extracted
  the bulk of the new logic into `useTableDisplayState`/`TableDisplayFields` — but worth a proactive
  split callout if this file grows further.
- The natural (unordered) field order shown in the Columns list / initial column order comes from
  `fieldOptions(selectedType)`, which for `HEL254WideType` is not alphabetical/numeric (e.g. col_27,
  col_16, col_6, col_3, ...). This is pre-existing (`fieldOptions`) and outside this ticket's scope,
  just worth noting for anyone confused by non-obvious "natural order" during a future review.
