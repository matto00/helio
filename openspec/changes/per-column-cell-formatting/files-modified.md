# Files modified — HEL-469

- `frontend/src/features/panels/ui/renderers/columnFormatting.ts` — NEW. Formatter functions
  (`formatColumnValue`) mapping a `TableColumnFormatSpec` + raw value to display text
  (number/currency/date/text, never-throw fallback to `formatCell`), plus the shared resolver
  (`resolveColumnFormatter`, design D6b) consumed by both render and filter.
- `frontend/src/features/panels/ui/renderers/columnFormatting.test.ts` — NEW. Formatter unit
  tests, locale/timezone PINNED (design D4), including the never-throw fallback and the
  `rawRows`/`"[object Object]"` boundary (design D5).
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — wires per-column
  `ColumnDef.render`/`align` from `columnFormats` (formattedColumns), builds the shared
  formatters map passed into the filter predicate, corrects the now-stale
  `getSortValue` object-branch comment (task 3.2b). `sortColumns` itself is UNTOUCHED (task 3.1) —
  it still reads raw values via `columns`, not `formattedColumns`. Cycle-2 addition: a new
  TEST-ONLY `formatIntl?: FormatIntlOptions` prop (see its doc comment) threaded into
  `resolveColumnFormatter`; production (`PanelContent.tsx`) never sets it, so production behavior
  is unchanged — it exists solely so `TableRenderer.test.tsx` can pin locale/timezone via an
  explicit argument rather than mutating the `Intl` global (design D4/task 4.0's stated mechanism).
- `frontend/src/features/panels/ui/renderers/TableRenderer.test.tsx` — NEW `describe` block: render
  AC coverage, the mutation-failable sort guard (task 3.2, verified red by hand against the
  call-site mutation), the object-branch contract (task 3.2a), the mutation-failable filter guard
  (task 3.5a, verified red by hand against the pre-fix `formatCell`-only predicate), and the
  header+cell alignment pairing (task 3.3). Cycle-2 fix for evaluation-1.md change request 1:
  every assertion over a formatted column's rendered text now passes `formatIntl={PINNED_INTL}` to
  `TableRenderer`, pinning locale/timezone; re-verified green under `LANG=de-DE`.
- `frontend/src/features/panels/ui/renderers/tableFilterPredicate.ts` — `rowMatchesFilters`/
  `cellMatches` now take an optional per-column formatter map (`ColumnFormatters`), falling back to
  `formatCell` for an unformatted column; rewrote the `:5-9` match-source contract comment (design
  D6a) to describe per-column rendered text rather than bare `formatCell`.
- `frontend/src/shared/ui/DataGrid.tsx` — `ColumnDef.align?: "left" | "right"`; wired onto BOTH the
  `<th>` and `<td>` together (design D3a, owner-ruled).
- `frontend/src/features/panels/ui/PanelContent.tsx` — passes `cfg.columnFormats` through to
  `TableRenderer`.
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` — `TableColumnFormatType`,
  `TableColumnFormatSpec`, `TableColumnFormats`, `columnFormats` on `TableOutputConfig` (flat
  sibling of `columnSort`/`columnFilters`), tolerant `readColumnFormats`, wired into
  `readTableConfig`.
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.test.ts` — round-trip +
  malformed-shape coverage for `readColumnFormats` (task 1.3/1.5), mirroring the existing
  `columnSort`/`columnFilters` blocks.
- `frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts` — table-kind Save body now
  emits `columnFormats` (design D1a — the Output editor is the persistence surface, not an in-panel
  write).
- `frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.test.ts` — added the
  `tableColumnFormats` param to the fixture; NEW mutation-failable guard asserting the table Save
  body carries exactly `fieldMapping`/`columnOrder`/`columnFormats` (task 1.5), and a guard asserting
  a cleared `columnFormats` still emits `{}` rather than omitting the key (design D3b).
- `frontend/src/features/pipelines/ui/outputEditor/useOutputColumnFormats.ts` — NEW. Output-editor
  local state for per-column format-type selection; always emits the FULL `columnFormats` object
  (including `{}`) so clearing every column's format is a whole-key replace on Save, not an
  omission. **Cycle-3 fix**: the original version rebuilt every entry as `{ type }` ONLY,
  silently discarding a spec's other fields (`decimals`/`currency`/`datePattern`) on ANY
  unrelated Save — those fields exist by other paths (MCP server, API, agent-authored
  proposals write Output config directly). State now carries the FULL `TableColumnFormatSpec`
  per column and changes only the `type` field the control edits; never invents a default for an
  absent sub-option.
- `frontend/src/features/pipelines/ui/outputEditor/useOutputColumnFormats.test.ts` — NEW
  (cycle-3). Round-trip coverage plus two MUTATION-FAILABLE guards: one at the derivation site,
  proving an edit to one column never discards ANOTHER column's already-persisted sub-options
  (verified red by hand against a `{ type }`-only rebuild of the returned `columnFormats` map,
  restored), and a separate guard on `setFormat`'s own carry-forward line, proving an edit to a
  column's type preserves that SAME column's other sub-options (verified red by hand against
  `{ type }` replacing the carry-forward, restored) — the two mutations exercise different
  branches and neither guard is redundant with the other.
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx` — wires
  `useOutputColumnFormats` into `buildConfig()` and into `TableKindFields`.
- `frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx` — `TableKindFields` gains
  `columnFormats`/`onFormatChange` props, passed through to `TableDisplayFields`.
- `frontend/src/features/panels/ui/editors/TableDisplayFields.tsx` — per-column format `Select`
  control (keyboard operable, accessible name `Format <column>`, DESIGN.md §8) beside the existing
  visibility/order controls, wrapped in a bounded `.table-display-fields__column-format` div
  (cycle-2 fix — see CSS note below).
- `frontend/src/features/panels/ui/editors/TableDisplayFields.css` — **CSS change**: new
  `.table-display-fields__column-format` rule (`width: 140px; flex-shrink: 0;`). Cycle-2 fix for
  evaluation-1.md change request 2 — the `Select`'s `.ui-select { width: 100% }` was, unbounded
  inside the flex row, winning the space fight against the `flex: 1` visibility label/column-name,
  measured collapsing both to `getBoundingClientRect().width = 0`. Re-measured live in both themes
  after the fix (see PR body note below) — column-key width is now non-zero (59/60/29px, matching
  each name's length) and the format control holds its bounded 140px.
- `frontend/src/features/panels/ui/editors/TableDisplayFields.test.tsx` — added
  `columnFormats={{}}`/`onFormatChange={jest.fn()}` defaults to the existing `renderFields` helper
  (new required props).

## Scope note for review

Only the format TYPE is user-selectable in the config UI (`none`/`number`/`currency`/`date`/`text`);
`decimals`/`currency` code/`datePattern` use the formatter's sane defaults (grouping decimals,
`USD`, `medium`) rather than exposing a sub-control per option. The spec shape
(`TableColumnFormatSpec`) supports all of them — this is a deliberately smaller UI surface than the
type supports, not a limitation of the persisted shape. Flagging for reviewer judgment on whether
that's in scope for this ticket or a natural follow-up.

## PR body notes (task 8.3)

- Formats are Output-scoped, converging on load (never per-panel); persisted via the Output
  editor's Save path (design D1a), not an in-panel write — there is no in-panel format control.
- Sort reads raw values; guarded by a mutation-failable test at the `TableRenderer.tsx` call site
  (task 3.2), verified red by hand against the call-site mutation and restored.
- Filter composition IS implemented and guarded (tasks 3.5/3.5a/3.6) — HEL-451 merged as `a6bde0d3`
  superseding the earlier "filter composition out of scope" note.
- The row-data export clause was dropped — no row/CSV export exists (`exportDashboard` returns a
  `DashboardSnapshot` of structure for re-import).
- `rawRows` boundary (design D5/task 7.3): this ticket's behavior changes when HEL-1033 lands —
  object-valued columns currently arrive as `"[object Object]"` and a `number`/`date` spec falls
  back to that placeholder unchanged; once HEL-1033 fixes the upstream `String(v)`, the same columns
  will arrive as real objects and the fallback will render real JSON instead.
