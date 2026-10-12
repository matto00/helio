## Context

See proposal.md for why. Current state on main (d6aef6c46):

- `HistoryRows.tsx` renders `TableRenderer` with `outputId`, `paginationRows`, `leadingColumns` (the "Change" column),
  `rowClassName` (changed-row highlight) and `disablePinning`, and no `conditionalFormats`. `TableRenderer` already
  takes `conditionalFormats` and applies them via `withCellRules` / `withRowRules` (`tableConditionalFormats.tsx`),
  which compose with an incoming `rowClassName`. `OutputHistoryModal` already holds the full `Output` (with `config`).
- Rules are read tolerantly by `readConditionalFormats(value, kind)` (via `readTableConfig` / `readCollectionConfig`);
  evaluation (`matchRule`) compares the RAW value (HEL-1308), never display text.
- `.panel-content__metric-unit` colour is `color-mix(in srgb, currentColor 60%, transparent)`; currentColor is the
  panel text colour (or `--panel-text-override` on a custom-coloured panel), so the unit follows custom text colours.
- `OutputEditorFooter` ORs `saveDisabled` (rules invalid) and `saveBlocked` (chart bin-count / reference-mark drafts).
  Its only caller is `OutputEditorSheet.tsx`.
- `inputs.css` styles `.ui-input/.ui-textarea[aria-invalid="true"]` (and focused); `.ui-select__trigger` shares the base
  and focus recipes but has no invalid rule, though `Select.tsx` sets `aria-invalid` on the trigger.

## Goals / Non-Goals

**Goals:** items 5, 2, 4, 6 of HEL-1490 as stated in ticket.md's acceptance criteria.

**Non-Goals:** item 1 (custom-background tone contrast: owner escalation pending; folded in only if answered before
Execution completes); item 3 (TableRenderer/DataGrid split); any change to rule evaluation, rule shape, the editor, the
backend, or the history API. No column-format (`columnFormats`) application in history rows (it never had it).

## Decisions

**D1 — History rows reuse the dashboard table's rule path, not a parallel one.** `OutputHistoryModal` passes the
Output's rules to `HistoryRows`, which forwards them to `TableRenderer`'s existing `conditionalFormats` prop. Same
`withCellRules`/`withRowRules`, so tone classes, glyph, sr-only text and tooltip are identical by construction.
Alternative (a second evaluator in history) rejected: two code paths for one visual contract drift.

**D2 — Rules come from the Output's CURRENT config (owner ruling), read with the existing tolerant readers.**
`readTableConfig(output.config).conditionalFormats` for table Outputs. Rules are evaluated against the stored raw
values of the selected run. A historical run is coloured by today's rules; that is the owner's call, not an accident.

**D3 — Collection rules map onto the collection's value column; metric rules do not colour rows.** A collection item
evaluates rules against its row's `fieldMapping.value` cell, so in a rows table the faithful equivalent is a cell rule on
that column: each collection rule becomes `{...rule, column: fieldMapping.value, target: "cell"}` (a pure mapping
helper, unit-tested, memoized in `HistoryRows` so `TableRenderer` does not recompute per render). A metric's rule evaluates ONE headline value (first row's field, or an aggregate over all rows);
no individual stored row is that value, so colouring rows would assert something false. Metric history rows stay
unstyled; the decision is stated in the spec. A collection with no mapped `value` column applies no rules.
Other kinds (chart, markdown, timeline, ...) have no rules.

**D4 — Changed-row highlight and rules compose; both stay VISIBLE.** Today a changed row is marked by "New or
changed" text plus `.output-history__row--changed td { background: var(--app-accent-surface) }`
(OutputHistoryModal.css:119, specificity 0,1,1). The rule washes in `TableRenderer.css` (row tone 0,1,3 at :133/158/183;
cell tone 0,2,3) set the same `background` and would erase the tint on a ruled changed row, including the "Change"
cell (design-gate round 2). Intended outcome: the "Change" cell of a changed row ALWAYS keeps `--app-accent-surface`
(and its text), and the DATA cells show the rule wash (cell rule > row rule, exactly as on the dashboard). Mechanism:
give the Change column a `cellClassName` (e.g. `output-history__change-cell`) and a history-scoped rule whose
specificity beats both tone rules for that cell only, tokens only. A changed row with no rule keeps the accent tint on
every cell as today. Proof: a computed-style or specificity assertion (not only class presence) plus light/dark
screenshots of a row that is both changed and ruled.
Mechanics (unchanged): `HistoryRows` keeps passing its `rowClassName`; `withRowRules` already
joins the caller's class with the tone class. The "Change" column is a leading (render-only) column and is not passed
to `withCellRules`, so the row-rule mark lands on the first DATA column as on the dashboard. A test pins both classes on
one row.

**D5 — Metric unit AND label contrast via one per-theme mix token, still currentColor-relative.** `.panel-content__metric-label` (PanelContent.css:31) uses the identical `color-mix(currentColor 60%, transparent)` and measures the same 4.40:1 in light (design-gate round 1); it moves to the same token so the two secondary texts stay one shade and both pass. The trend text is unaffected (its up/down/flat class overrides the mix). Add a token (e.g.
`--panel-secondary-text-mix`, name final in Execution) in `theme.css` for both themes and use it in
`color-mix(in srgb, currentColor <token>, transparent)` for every `.panel-content__metric-unit` and `.panel-content__metric-label` colour rule. Keeping currentColor preserves custom panel text colours
(HEL-1307 spec: the unit keeps exactly its no-rules colour). The executor picks the smallest light-theme value that
measures >= 4.5:1 against the default panel surface (and the panel hover/raised surface if the card uses one), and
keeps dark at 60% if it already measures >= 4.5:1 (measured, not assumed; raise it too if not). Measurement is from the
running app's computed styles at 1440 and 375 (the unit's font-size changes per container query, but contrast does not).
Alternative `--app-text-muted` rejected: it would stop the unit following a custom panel text colour.

**D6 — One footer prop: `saveBlocked`.** (Refactor: its tests are guards proven failable by deliberate mutation per C1, not red-before-fix.) Fold `saveDisabled` into `saveBlocked` (the more general name; doc comment
lists every trigger). `OutputEditorSheet` passes `rulesInvalid || (kind === "chart" && (binCountInvalid ||
referenceMarksInvalid))`. Behaviour-preserving; tests cover each trigger still disabling Save.

**D7 — Select invalid state mirrors the input recipe exactly.** Add `.ui-select__trigger[aria-invalid="true"]` to the
two existing invalid selectors in `inputs.css` (border always, error halo while `:focus-visible`). Selector specificity
must beat `.ui-select__trigger:focus-visible`'s accent ring (it does: attribute + class + pseudo-class vs class +
pseudo-class) and any later `.ui-select__trigger` rule (line ~84) must not override `border-color` — verify by computed
style in the running app, both themes.

## Risks / Trade-offs

- [Rule colours in history disagree with what the dashboard showed at that run time] → owner ruling; spec states
  "current rules".
- [Collection mapping misses if `fieldMapping.value` is absent or names a column not in the stored payload] → no rule
  applies (matchRule on undefined matches nothing); covered by a test.
- [Raising the unit mix narrows the unit/value hierarchy] → choose the smallest passing value; screenshot both themes.
- [Metric rules not colouring history rows may surprise the owner] → state it plainly in the PR body; colouring the history summary's per-run headline is a possible follow-up, listed in the final report.
- [Select invalid border fights `.ui-select__trigger[aria-expanded]` / hover rules] → hover rule uses `:not(:disabled)`
  on border-color; decided up front (design-gate round 2): hover (0,3,0) beats the invalid rule (0,2,0) for `.ui-input` today, so an invalid Select loses the error border on hover exactly like the text input; keep that parity (no hover change) so all three controls stay identical (AC6).

## Migration Plan

Frontend-only, no data change. Rollback is a revert.
