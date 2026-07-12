## Context

`BindingEditor.tsx` (`frontend/src/features/panels/ui/editors/BindingEditor.tsx`) is the shared
Data-section editor for metric/chart/table panels. For metric it currently renders, from
`PANEL_SLOTS.metric` (`value`/`label`/`unit`, `frontend/src/features/panels/state/panelSlots.ts`), a
field-mapping row per slot, followed by a separate "Aggregation" section (Field + Function) added in
HEL-292. Both the field-mapping `value` row and the aggregation's `value` picker write to the same
conceptual slot through two different config keys (`config.fieldMapping.value` vs
`config.aggregation`), and `usePanelData.ts`'s resolution memo lets `aggregation` silently win when
both are set (aggregation override runs after the fieldMapping loop). Literal `label`/`unit`
overrides (`config.label`/`config.unit`, HEL-293) are wired only into `MetricCreatorFields.tsx` at
creation time — `buildBindingPatch` (`panelPayloads.ts`) never includes them, so there's no way to
edit them from `BindingEditor`/`PanelDetailModal` after creation.

This ticket is the pattern-setter for HEL-244 (Text), HEL-245 (Markdown), and HEL-247 (Collections),
all scoped as "same pattern as Metric." The pattern that matters for them is not metric's specific
fields — it's the *shape* of "pick a value: either bind it to a DataType field, or type it literally."

## Goals / Non-Goals

**Goals:**

- One Value control for metric that can't produce a fieldMapping/aggregation disagreement.
- Label/Unit editable post-creation, using the same field-or-literal shape as HEL-293 already
  established at creation time.
- A reusable `BoundOrLiteralField` component + documented pattern that HEL-244/245/247 copy without
  re-deriving the interaction model.
- Zero regression to HEL-292 (aggregation math), HEL-293 (literal precedence), HEL-295 (unit
  rendering / no-false-"No data"), HEL-297 (display rounding) — none of `MetricRenderer.tsx` or
  `usePanelData.ts`'s resolution memo changes; only which config keys the UI writes changes.

**Non-Goals:**

- Chart/Table field mapping and aggregation UI are unchanged (still the pre-existing
  `PANEL_SLOTS`-driven rows + generic Aggregation section in `BindingEditor`).
- No new backend/schema work — `MetricPanelConfig`/`Patch` (`MetricPanel.scala`) already carry
  `label`/`unit`; `schemas/panel.schema.json` already documents them.
- HEL-244/245/247 are not implemented here — only the shared component and the documented pattern.

## Decisions

### Decision 1 — Metric gets a dedicated `MetricValueEditor`, not a `PANEL_SLOTS` change

`PANEL_SLOTS.metric` stays as-is (chart/table still read `PANEL_SLOTS[panel.type]` generically).
`BindingEditor` special-cases metric: instead of looping `slots` + rendering the generic
"Aggregation" block for `panel.type === "metric"`, it renders a new `MetricValueEditor` that owns one
field select + one "Reduce" select (`None (first row)` / Count / Sum / Average / Min / Max).
`None` → `onChange` reports `{ fieldMapping: { value: field } }`-shape state, clearing any prior
`aggregation`. Any reduce function → reports `{ aggregation: { value: field, agg } }`, clearing
`fieldMapping.value`. This mirrors the existing state-lifting shape `BindingEditor` already uses
(`fieldMapping`/`aggField`/`aggFn` local state) — `MetricValueEditor` is presentational; `BindingEditor`
keeps owning the save/dirty/reset plumbing so `PanelEditorHandle` doesn't change shape.
**Alternative considered:** generalize `PANEL_SLOTS` to carry a `reducible: boolean` flag and make the
generic loop handle it — rejected because chart's groupBy aggregation has a materially different
shape (3 fields, not 1) and forcing one generic control to cover both adds more conditional branching
than a small metric-specific component.

### Decision 2 — `BoundOrLiteralField` shared component for Label/Unit

New component (location: `frontend/src/features/panels/ui/editors/BoundOrLiteralField.tsx` — panels
feature, not `shared/ui/`, since it composes `Select`/`TextField` with panel-specific "field vs
literal" semantics no other feature needs yet). Props: `label`, field options, current mode
(`"field" | "literal"`), the bound value, the literal value, `onModeChange`, `onFieldChange`,
`onLiteralChange`. Renders a small segmented toggle (reusing the Button ghost/secondary recipes in
DESIGN.md §5, not a new control) + either a `Select` or a `TextField`. Mode defaults from data: if
`config.label`/`config.unit` is set, start in "literal"; else "field". Used twice in
`MetricValueEditor`'s Label/Unit rows. **This is the piece HEL-244/245/247 copy directly** — Text's
`content` and Markdown's `content` are single string slots with the exact same "bind to a DataType
field, or type it literally" choice Metric's label/unit already has.

### Decision 3 — Threading `label`/`unit` through the update path

Extend `buildBindingPatch` (`panelPayloads.ts`) to accept optional `label`/`unit` following the exact
`aggregation` convention already there: `undefined` omits the key (unchanged), `null` clears, a string
sets. Extend `updatePanelBinding`'s thunk (`panelThunks.ts`) and service function (`panelService.ts`)
signatures with the same two optional params. No wire-shape change — `MetricPanelConfig.Patch`
already accepts `label`/`unit` (see `MetricPanel.scala:58-67`).

### Decision 4 — Reusable pattern documented for HEL-244/245/247

New capability spec `panel-config-field-or-literal-pattern` documents, at the requirement level, two
generalizable shapes:

1. **Field-or-literal slot**: any panel config slot that can be *either* a DataType field binding
   *or* literal text SHALL expose a `BoundOrLiteralField`-shaped control (mode toggle + one input).
2. **Value + optional reduce**: any panel config slot whose value is a DataType field, some of which
   also need cross-row reduction (aggregation), SHALL expose one field selector plus one reduce
   selector defaulting to "no reduction," writing to `fieldMapping` when unreduced and to a typed
   `aggregation` spec when reduced — never both at once.

**Prerequisite HEL-244/245 must complete first, before reusing pattern 1**: Text/Markdown's
`TextPanelConfig`/`MarkdownPanelConfig` (`panel.ts:108-114`) have no `dataTypeId`/`fieldMapping` today
— `content` is unconditionally literal, and neither type is part of the "bound trio"
(`isBoundCapablePanel`, `panelNarrowing.ts`). This ticket ships the **control** pattern
(`BoundOrLiteralField`), not evidence that the **binding** prerequisite already exists for those
types. HEL-244/245 must first extend their panel configs with DataType-binding infrastructure
(their own `dataTypeId`/`fieldMapping`, mirroring the bound trio) before their `content` slot can be
wired to `BoundOrLiteralField`; once that binding exists, they apply pattern 1 to `content` directly.
HEL-247 (Collections), having per-item multi-row data, is the pattern-1/pattern-2 combination scaled
to a list, with the same binding-infrastructure prerequisite likely applying per-item.

## Risks / Trade-offs

- [Existing panels with both `fieldMapping.value` and `aggregation` set (a state the old UI allowed)]
  → `MetricValueEditor`'s initial mode reads `aggregation` first (matching `usePanelData`'s existing
  override-wins resolution), so opening the editor doesn't change rendered behavior; saving any
  change through the new UI naturally clears the redundant key going forward.
- [`BoundOrLiteralField`'s mode-detection heuristic (literal-if-`config.label`-set) could disagree
  with a panel that has both a literal and a field mapping for the same slot] → matches HEL-293's
  documented precedence (literal wins), so defaulting to "literal" mode when both exist is consistent
  with what's actually rendered.

## Planner Notes

- Scope confirmed as frontend-only after reading `MetricPanel.scala` — no backend/schema task needed.
- `BoundOrLiteralField` placed under `panels/ui/editors/`, not `shared/ui/`, since no other feature
  needs the field-vs-literal composition yet; promote to `shared/ui/` when HEL-244/245/247 land if a
  second feature needs it verbatim (DESIGN.md §6 "reuse, don't reinvent" is about existing shared
  primitives — introducing a new one here is a self-approved judgment call, not a spec deviation).
