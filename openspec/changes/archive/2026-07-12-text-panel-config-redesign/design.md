## Context

`TextPanel` (`backend/src/main/scala/com/helio/domain/panels/TextPanel.scala`) is unbound today:
`dataTypeId`/`fieldMapping` are hardcoded `None`, `buildQuery` returns `None`, `withBindingCleared` is a
no-op. `TextPanelConfig` carries only `content: String`. The `Panel` trait (`domain/Panel.scala`) is
already polymorphic over `dataTypeId`/`fieldMapping`/`buildQuery`/`withBindingCleared` — Metric/Chart/Table
implement the "bound" side, Text/Markdown/Image/Divider the "unbound" side. Adding Text to the bound side
is implementing the trait's existing contract, not inventing new architecture.

Two findings from reading the actual code changed this ticket's assumed scope (both shrink it):

1. **No Flyway migration needed.** `PanelRepository.PanelTable`'s `type_id`/`field_mapping` columns are
   already generic — shared by the whole `panels` table (`PanelRowMapper.scala`), not per-kind columns.
   Metric/Chart/Table populate them; Text/Markdown/Image/Divider just don't. Text starts populating the
   same two columns. (The ticket brief assumed V54 would likely be needed — confirmed against
   `backend/src/main/resources/db/migration/` and against `PanelRowMapper`; no new column, no migration.)
2. **The plumbing is already half-built.** `PANEL_SLOTS.text` already defines `{ key: "content", label:
   "Content" }`; `TextRenderer` already accepts a `data` prop and reads `data?.content ?? content`
   (bound-first, matching Metric's fieldMapping-wins-over-literal precedent) — unused until now; the
   panel-creation modal already lists `text` in `DATA_BOUND_TYPES` and passes a selected `dataTypeId`
   into `buildCreatePanelBody`, which currently discards it for `text`/`markdown`. This is a real vertical
   slice (backend config + schema + frontend editor), but not a new subsystem — it completes wiring that
   was already anticipated.

Given both findings, this is not "large enough to be its own ticket" — no escalation raised.

## Goals / Non-Goals

**Goals:**

- Text panel config carries `dataTypeId`/`fieldMapping` (single `content` slot), joining the bound-capable
  set; `usePanelData`/`TextRenderer` render dynamic content with zero Text-specific resolution code.
- A Content editor (Source/Static) in `PanelDetailModal` — which has no Text editor today at all.
- Zero regression: an existing Text panel with only literal `content` renders identically (Static mode).

**Non-Goals:**

- Markdown (HEL-245) — not touched here; a separate ticket applies the same infra to `MarkdownPanelConfig`.
- Aggregation/reduce for Text's content — DoD asks for one bound field, not a reduced value; no "Reduce"
  control (unlike Metric's Value control).
- Field-type filtering (string-only) in the field picker — Metric's existing field pickers apply no
  dataType-category filtering either; Text's field select follows the same precedent (any field, rendered
  via the existing `String(value)` coercion in `usePanelData`'s per-slot mapping loop).

## Decisions

### Decision 1 — `TextPanelConfig` mirrors `MetricPanelConfig`'s shape, keeps `content` as a sibling field

`TextPanelConfig(content: String, dataTypeId: DataTypeId = DataTypeId(""), fieldMapping: JsObject =
JsObject.empty)`. Same tolerant `decode`/`Patch` shape as Metric (`Patch.dataTypeId`/`fieldMapping` as
`Option[Option[X]]` absent-vs-null; `Patch.content` keeps its existing simpler "absent = unchanged,
`JsNull` → `""`" convention, unaffected). `withBindingCleared` clears only `dataTypeId`/`fieldMapping`,
**preserving `content`** — deliberately diverges from Metric's `withBindingCleared = copy(config =
MetricPanelConfig.Empty)` (which wipes label/unit too). Rationale: Text's `content` is the Static-mode
data itself, not a binding-context display override; wiping user-authored static text on a cross-user
binding-scrub (`PanelService.resolveBindingsForRead`) would be data loss and violate the "no regression to
literal-content panels" requirement.

**Bind-direction corollary (skeptic-flagged, round 1):** the same data-loss protection MUST hold when
*saving* the Content editor in Source mode, not only on `withBindingCleared`/unbind. `useBoundOrLiteralState`
(reused for the mode/field/literal state — Decision 2) returns `patchValue: null` whenever `mode ===
"field"` and the slot is dirty — this is *correct* for Metric's Label/Unit, where the literal is a
mutually-exclusive override Metric's own spec documents as intentionally cleared on switch-to-field. Text's
`content` is not that kind of slot: it is the entire Static-mode payload, and Decision 1 above requires it
survive a mode switch. Therefore `buildTextBindingPatch` (tasks.md §3.3) MUST NOT forward
`contentState.patchValue` into the `content` key the way `BindingEditor` forwards `labelState.patchValue`
for Metric — it must omit `content` from the outgoing patch entirely whenever the editor's mode is Source,
so `TextPanelConfig.Patch.decode`'s existing "absent = unchanged" convention preserves the prior literal
text untouched. Only a Static-mode save may set `content`.

### Decision 2 — New `TextContentEditor`, not a `BindingEditor` extension

`BindingEditor` is typed `MetricPanel | ChartPanel | TablePanel` and its generic `FieldMappingSlots`/
aggregation-loop shape doesn't fit "one field, mode-gated DataTypePicker visibility." A new
`TextContentEditor.tsx` (own `forwardRef<PanelEditorHandle>`, own `dataTypes`/`typeSearch` fetch — mirrors
`BindingEditor`'s inline fetch-and-filter rather than extracting a shared hook; extracting one is not
required by this ticket) composes: `useBoundOrLiteralState` (mode/field/literal state — "field" mode =
Source, writes `fieldMapping.content`; "literal" mode = Static, writes `config.content`), `DataTypePicker`
(rendered only when mode is Source — unlike Metric, where the DataType picker is always visible because
metric's primary Value binding already assumes one; gating on mode here keeps Static panels free of
DataType UI, per AC's "two modes are exposed cleanly"), and `BoundOrLiteralField` for the mode toggle +
switched input.

### Decision 3 — `BoundOrLiteralField` gains an additive `literalMultiline?: boolean` prop

Text's literal content is long-form (mirrors `MarkdownEditor`'s `Textarea rows={12}`), unlike Metric's
single-line label/unit. Extending the shared component (default `false`, existing Metric call sites
unchanged) keeps one component all of HEL-244/245/247 copy, per the `panel-config-field-or-literal-pattern`
capability's Decision 4 — instead of forking a near-duplicate component for the multiline case.

### Decision 4 — `isBoundCapablePanel` widens to include `TextPanel`

Widens `panelNarrowing.ts`'s predicate return type to `MetricPanel | ChartPanel | TablePanel | TextPanel`.
Every existing call site benefits automatically without Text-specific code: `panelsSlice.ts`'s
`markDataTypeRowsStale` reducer correctly invalidates a bound Text panel's cache when its DataType's
pipeline reruns, and `panelNarrowing.ts`'s own `getDataTypeId`/`getFieldMapping` read accessors (consumed
by `usePanelData.ts`, `PanelCard.tsx` polling, and `panelThunks.ts`) start returning real values for Text —
all correctness fixes that fall out of the widening, not separately implemented.

## Risks / Trade-offs

- [`content` patch's existing "no clear-to-null" convention differs from `dataTypeId`/`fieldMapping`'s
  absent-vs-null convention on the same `Patch` class] → intentional; documented inline in
  `TextPanelConfig.Patch` exactly as it is today, just extended rather than unified, to avoid changing
  already-shipped literal-content PATCH behavior.
- [A Text panel bound to a DataType whose field is numeric/date renders `String(value)`] → matches
  existing Metric/Chart precedent; no new coercion logic introduced.

## Planner Notes

- Confirmed via `PanelRowMapper.scala`/`PanelRepository.scala` that `type_id`/`field_mapping` are
  generic columns already present for every panel row — no Flyway migration in this change, despite the
  ticket brief's V54 assumption.
- `TextContentEditor` duplicates `BindingEditor`'s inline DataType-fetch-and-filter pattern rather than
  extracting a shared hook — self-approved judgment call (extraction not required for this ticket's
  scope; can be revisited if HEL-245/247 also need it).
