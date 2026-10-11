## Context

See proposal.md (Why) and `specs/output-conditional-formatting/spec.md` (behaviour). Owner rulings 1-6 are recorded in
`ticket.md`. Current state, verified in this worktree:
- `OutputConfigValidation.KnownKeys` (backend) is the one per-kind key list; `KeysDoc`, the assistant tool schemas and
  `RefinementEditShape` derive from it. Shape validators for `compare`/`historyPayloads` live as domain objects
  (`domain/history/OutputCompare`, `PayloadOptIn`) chained in `validateConfig` on the MERGED config, and separately in
  `PipelineCreatePreflight.validateOutputConfig` (which does not call `validateConfig`).
- Three request schemas hand-copy the per-kind key lists (`schemas/outputs/create-output-request`,
  `update-output-request`, `schemas/pipelines/create-pipeline-transactional-output-request`); `config` has no
  `additionalProperties: false`; the drift check does not inspect config sub-keys. helio-mcp hand-copies the list in
  `helio-mcp/src/tools/outputs.ts` `OUTPUT_CONFIG_KEYS_DOC`, pinned by `server.test.ts`.
- Public dashboards: `PublicPanelOutputMetaResolver` returns the raw Output config, so no backend public change.
- Rendering: `OutputPanelContent` reads per-kind config; `MetricOutputPanel` computes the metric's raw `data.value`
  string (pre-format) and renders `MetricRenderer`; `CollectionRenderer` renders one `MetricRenderer` per row;
  `TableRenderer` renders `DataGrid` with `ColumnDef.render` for cells and an existing `rowClassName` pass-through
  (used by `HistoryRows` for a changed-row tint). `ColumnDef` has no cell-class hook.
- Tokens: `--app-success|warning|error` and `-surface` washes exist in both themes; `docs/contrast-audit.md` §2
  records each intent on its own wash at >= 4.5:1 over every surface in both themes.

## Goals / Non-Goals

**Goals:** one pure, raw-value rule evaluator shared by all three renderers; one backend validator used by every write
path; zero rendering change for Outputs without rules; a clean seam for HEL-1308 (duration format).

**Non-Goals:** the Output history rows view (`HistoryRows`) does not apply rules (it inspects a past payload; noted as a
possible follow-up). Chart/timeline/markdown rules. Panel-level (appearance) overrides of rules.

## Decisions

**D1. One flat key, one list, kind-dependent fields.** `conditionalFormats` is a flat sibling (shallow-merge reasoning
in `outputConfigTypes.ts`'s `TableOutputConfig` comment); a clear writes `[]`. Table rules carry `column`/`target`;
metric/collection rules must not. Alternative: per-column map for tables (like `columnFormats`) — rejected because
owner ruling 1 makes order across all rules meaningful and row rules span columns.

**D2. Backend validator `domain/outputs/ConditionalFormats.scala` (pure).** `validateConfig(kind, merged): Either
[String, Unit]`, chained in `OutputConfigValidation.validateConfig` after `PayloadOptIn` and in
`PipelineCreatePreflight.validateOutputConfig`. It validates the merged config (like `compare`), so a re-sent stored
list is re-checked; this is safe because the key is new (no legacy stored values). It runs only under
`OutputConfigWritePolicy.ValidateWrite` (gated exactly like the key check), never for `RestorePriorStored`, per the
spec's rollback/undo exemption. Messages:
`conditionalFormats[<i>]: <reason>`. `KnownKeys` gains the key for Metric, Table, Collection; `KeysDoc` gets one
appended sentence describing the shape (so assistant/refinement prompts learn it with no other edit).

**D3. Frontend evaluator `frontend/src/features/panels/ui/renderers/conditionalFormatting.ts` (pure).** Exports
`ConditionalFormatRule`, `ConditionalTone`, `matchRule(rule, raw)`, `resolveTone(rules, raw)` → the first matching rule
or `null`, and `resolveRowRule`/`resolveCellRule(rules, row, column)`. Inputs are raw values (`unknown` → string via
the same coercion `formatCell` uses for numbers/strings); never formatted text. Tolerant reader
`readConditionalFormats(value, kind)` lives in `outputConfigTypes.ts` beside the other readers, drops invalid rules
(never throws), and is used by `readMetricConfig`/`readCollectionConfig`/`readTableConfig`. HEL-1308 seam: a duration
format changes display only; rules keep comparing raw seconds, so the two features compose without touching each other.

**D4. Metric/collection rendering.** `MetricRenderer` gains `conditionalFormats?: ConditionalFormatRule[] | null` and
resolves the tone from `data.value` (already the raw string). The tone class `panel-content__metric-figure--tone-<tone>` (colour
`var(--app-<tone>)`) goes on a NEW inner span wrapping only the glyph, the formatted value text and the sr-only text;
the unit span stays a sibling outside it and its CSS is untouched, so it keeps inheriting the panel colour
(`var(--panel-text-override, var(--app-text))`, contrast-picked per custom background) exactly as today (skeptic r1+r2).
With no rules the inner span is not rendered (DOM identical). `OutputPreviewPane`'s metric preview passes the editor's
unsaved rules; its table/collection previews are unchanged. `ComparisonLine` and the legacy trend are untouched (ruling 6). `CollectionRenderer` forwards
the prop to each item; `OutputPanelContent`/`MetricOutputPanel` pass `cfg.conditionalFormats`.

**D5. Glyph + accessible name (ruling 4).** New `ToneGlyph` (panels renderers dir) renders lucide-react `CircleCheck`
(success), `TriangleAlert` (warning), `CircleX` (error) with `aria-hidden="true"`, sized via the `ICON_SIZE` constant (`shared/ui/iconSize.ts`), colour `currentColor`. These shapes differ from the delta's ▲▼▬ text glyphs. The styled element carries
`title={labelOrToneWord}` and a `.sr-only` span `labelOrToneWord`; tone words: Good / Warning / Critical.

_Implementation note (glyph size, skeptic design-4 note 2):_ `ToneGlyph` takes an `ICON_SIZE` key. The metric and collection
figure uses `ICON_SIZE.lg` (20px): beside the 30px (`--text-3xl`) figure the glyph reads as part of the value, and on the compact
card (`--text-xl`, 20px text) it equals the text height without crowding the 3x2 card (screenshots in the run evidence dir). Table
cells use `ICON_SIZE.sm` (14px) against 13px `--text-sm` cell text, so a row keeps its height. `md` (16px) was too small next to the
figure and too large in a cell.

**D6. Table cells and rows.** `DataGrid.ColumnDef` gains an optional, additive `cellClassName?: (row) => string |
undefined` applied to that column's `<td>` (no consumer changes; `DataGridConsumerRegression` must stay green).
`TableRenderer` takes `conditionalFormats`, builds per-column `cellClassName` (`ui-data-grid__cell--tone-<tone>`: text
`var(--app-<tone>)`, background `var(--app-<tone>-surface)`) and wraps each styled cell's rendered content with the
glyph + sr-only text. Row rules compose into the existing `rowClassName` (caller's class + `ui-data-grid__row--tone-
<tone>`). Resolution keys by row OBJECT so it survives sort/filter (same as HEL-1277). Exactly one wash per cell (skeptic r1):
the row class paints the wash on its `<td>`s ONLY, never on the `<tr>`; a cell-rule class REPLACES the row wash on that
cell (higher-specificity rule, same property); unpinned cells use the plain translucent `var(--app-<tone>-surface)`;
pinned (sticky, opaque) cells use `linear-gradient(var(--app-<tone>-surface), var(--app-<tone>-surface)),
var(--panel-surface-override, var(--app-surface))` so the wash is visible and not doubled. Row-rule glyph + sr text go
at the start of the row's first VISIBLE data cell (so a hidden rule column, via `columnOrder`, still has a non-colour
signal), independent of any cell rule there; the row rule's `title` tooltip sits on that glyph wrapper. The cell glyph wrapper is inline (no block/flex) so the td's
ellipsis truncation keeps working. All rule-resolution and cell-wrapping logic lives in a new helper
(`tableConditionalFormats.ts`), not inline: `TableRenderer.tsx` (885 lines) and `DataGrid.tsx` (1287) are over budget.

**D7. Editor.** New `ConditionalFormatsField.tsx` (+ `useOutputConditionalFormats.ts`) in `outputEditor/`, rendered
from `OutputKindConfigCard`/`OutputKindFields` for metric, collection and table. Built from `FormField` (the visible label of every control, so the label survives at 375px), `Select`,
`TextField`, `IconButton` (move up/down, remove; required `aria-label`) and `InlineError` (the rule's error, its `id`
wired to `aria-describedby` on only the control(s) the error concerns; shown once the rule is touched, with a muted
"Finish or remove rule N to save" hint before then; editor-facing copy rather than the server wording), an "Add rule" button (disabled at 20 rules); operator select shows a
second value input only for `between`; numeric ops use a numeric input; table rows add column (from
`columnOptions(capabilities)`) and target selects. Inline errors mirror the server rules so an invalid rule cannot be
saved. An empty label is omitted (never `""`). An `eq`/`neq` value typed in the editor is saved as a JSON
number when it is numeric by the spec's definition, else as a trimmed string; the seam fixture records both. State flows through `useOutputKindState.params()` → `buildOutputConfig` (BOTH the plain builder and the
aggregate-tail variant) and is seeded by `configPatch.ts`. Builder emits `conditionalFormats` only when the editor has
rules or the stored config had the key (then `[]` to clear), keeping existing builder snapshots unchanged.

**D8. Seam fixture.** `shared-test-fixtures/conditional-formats-config.json` (precedent `join-step-config.json`): `valid`
cases per kind (exact config the editor writes) and `invalid` cases with expected index/reason fragments. Backend
`ConditionalFormatsSeamSpec` asserts valid accepted (unit + real Output create/PATCH route, read back identical) and
invalid rejected 400; frontend seam test drives the real editor to produce each valid case's PATCH body and asserts
equality, and asserts the tolerant reader returns valid cases losslessly.

## Risks / Trade-offs

- [Two validators drift (Scala + TS editor checks)] → the seam fixture's `invalid` cases run against the backend AND
  the frontend editor's validation helper (which must flag each); the tolerant reader must drop each.
- [Row wash hidden under pinned sticky cells] → D6 CSS paints on cells; browser check with a pinned column.
- [`--app-warning` text on `--app-surface` in light] → audited 5.67:1 (contrast-audit §1); on wash >= 4.5 (§2).
- [Tone text on a panel with a custom background colour is not contrast-picked] → same exposure the existing delta
  trend colours (`--app-success`/`--app-error`, PanelContent.css) already have; accepted for parity, not widened by
  this change; listed as a follow-up candidate rather than solved here.
- [Builder snapshot churn] → conditional emission (D7).
- [Percent metrics: authors may type 80 instead of 0.8] → editor help text states rules compare the raw value.

## Migration Plan

No migration, no endpoint. Rollback = revert; stored `conditionalFormats` would then be a tolerated unknown key.

## Planner Notes

- Self-approved: key name `conditionalFormats`; 20-rule cap; 60-char label; 200-char text value; tone words
  Good/Warning/Critical; lucide icons; history rows view excluded; no write-time column-existence check (matches
  `columnFormats`/`fieldMapping` precedent).
- Driver claim "HEL-1313 `OutputConfigValidation`" verified; "public read path" verified as raw config (no allow-list).
