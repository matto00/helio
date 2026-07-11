## Context

`MetricRenderer` (`frontend/src/features/panels/ui/renderers/MetricRenderer.tsx`) receives
`data: MappedPanelData | null` — a flat `Record<string, string>` built by `usePanelData`
(`frontend/src/features/panels/hooks/usePanelData.ts`) from the panel's `fieldMapping`. For metric
panels the mapping slots are `value`, `label`, `unit` (`panelSlots.ts` `PANEL_SLOTS.metric`), each
resolved as `firstRow[field]` — i.e. all three are column references, not literal text.

Today the component only reads `data.value` and `data.label`; `data.unit` is never read. The label
line falls back to the literal string `"No data"` whenever `data?.label` is falsy — including the
common case where `value` is present and simply no column is mapped to the `label` slot.
`PanelContent.tsx` already renders a separate panel-level "no data" placeholder before rows ever
load (`noData` prop, line 68); `MetricRenderer`'s own fallback is a *second*, narrower, and
currently miscalibrated no-data indicator for the label sub-line specifically.

## Goals / Non-Goals

**Goals:**
- Render `data.unit` next to `data.value` when present.
- Only show a "No data" indicator when `data?.value` is genuinely absent (undefined/null/empty
  string), never merely because `label` is unmapped or unresolved.
- Document (comment) that `label`/`unit` are column refs, not literal text, so future readers
  don't assume otherwise.

**Non-Goals:**
- Changing `usePanelData`'s resolution mechanism for `label`/`unit` (column-ref vs literal) —
  deferred to the config-depth ticket.
- Changing `PanelContent.tsx`'s panel-level `noData`/`isLoading` placeholders.
- Adding a `MetricTypeConfig`-sourced literal unit/label path (that config is currently collected
  in the creation modal but dropped in `seedCreateConfig`/`panelPayloads.ts` — a separate,
  pre-existing gap out of scope here).

## Decisions

- **Render unit inline with value, not as its own line.** Matches the ticket's example
  (`84 /100`) and keeps the metric's 2/3-line layout (value(+unit), label, trend) unchanged per
  `panel-type-rendering` spec. Implemented as a nested `<span className="panel-content__metric-unit">`
  inside the value span, only rendered when `data?.unit` is truthy.
- **Label fallback keyed on value presence, not label presence.** Compute
  `hasValue = !!data?.value` once; when `!hasValue`, render "No data" as before (whole metric is
  empty); when `hasValue` and no label, render nothing for the label line (omit the span content
  rather than an empty string, to avoid a stray empty DOM node with padding/line-height).
- **No new CSS variables.** `panel-content__metric-unit` reuses existing tokens
  (`--text-sm`/`--weight-medium`, muted-below-value color) already established for
  `panel-content__metric-trend`/`-label` in `PanelContent.css`, consistent with DESIGN.md's
  token-only rule.

## Risks / Trade-offs

- [Risk] Hiding the label line entirely when unmapped could look visually sparse compared to
  today's (buggy) always-present label line → Mitigation: this matches the acceptance criteria
  exactly ("no false No data") and the label line reappears once a label is mapped.
- [Risk] `data.unit` could theoretically resolve to a column value that isn't meant as a unit
  suffix (garbage-in-garbage-out from mis-mapping) → Mitigation: out of scope; same trust model
  as `value`/`label` today.

## Planner Notes

- Self-approved: keeping `unit` as a column-ref (unchanged resolution) rather than introducing a
  literal-text special case in `usePanelData`, since the ticket's own "Change" section scopes the
  label/unit semantics clarification to a comment, and defers the literal-label behavior change to
  the sibling config-depth ticket.
