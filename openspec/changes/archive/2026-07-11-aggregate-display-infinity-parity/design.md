## Context

`usePanelData` (`frontend/src/features/panels/hooks/usePanelData.ts`) collapses a metric panel's
resolved value into `MappedPanelData = Record<string, string>` — including the HEL-292 aggregate
override (`mapped.value = String(aggregate)`, line ~170). `MetricRenderer` then renders
`data?.value` verbatim. An `avg` over non-round numbers (e.g. `10/3`) produces a long decimal
string (`"3.3333333333333335"`) that can overflow the fixed-width metric value slot at narrow
panel widths.

Separately, `aggregate.ts`'s `coerceNumber` rejects the literal string `"Infinity"` (via
`Number.isFinite` after `Number(value)`), while the backend's `AggregateStep` uses Scala's
`s.toDoubleOption` (`String.toDoubleOption` → Java `Double.parseDouble` grammar), which parses
`"Infinity"`/`"-Infinity"`/`"+Infinity"` as real (non-finite) doubles. The two implementations are
documented (top of `aggregate.ts`) as intentionally mirroring each other "exactly."

## Goals / Non-Goals

**Goals:**
- Cap the metric value slot's rendered decimal precision so long decimals fit the slot at all
  container-query breakpoints.
- Resolve the `"Infinity"` divergence — by alignment or explicit documentation — per the ticket.

**Non-Goals:**
- Changing `computeAggregate`/`groupAndAggregate` numeric semantics (sum/avg/min/max/count).
- Formatting chart-panel groupBy aggregate values (axis/tooltip) — only the metric value slot is
  in scope; charts already have their own axis-tick formatting via ECharts.
- Currency/locale-aware formatting keyed off the free-text `unit` field (`unit` is an unstructured
  string like `"$"`/`"%"`/`"ms"` — there's no currency code to key `Intl.NumberFormat` `style:
  "currency"` off of).

## Decisions

### Decision 1 — Precision policy: fixed 2 fraction digits, no thousands grouping

Format via `Intl.NumberFormat(undefined, { maximumFractionDigits: 2, useGrouping: false })`,
applied in `MetricRenderer` to any `data.value` string that parses to a finite `Number`. Rationale:

- A **fixed decimal count** (vs. significant figures) is simpler to reason about and keeps
  behavior predictable across wildly different magnitudes (a `count` of `1500` and an `avg` of
  `3.33` both read naturally).
- **No thousands grouping** (`useGrouping: false`) deliberately, even though `toLocaleString()` is
  used elsewhere in the codebase (`PipelineListTable.tsx`, `StepCard.tsx`) for row counts — this
  ticket's stated problem is decimal-length overflow, not integer-digit-count readability. Adding
  grouping would be an unrequested cosmetic change and risks silently changing existing metric
  displays (e.g. a plain `fieldMapping`-resolved `"1500"` would newly render `"1,500"`).
- Applying the formatter to **any** numeric-looking `data.value`, not just the aggregate-derived
  one, is a consequence of `MappedPanelData` being `Record<string, string>` — the renderer cannot
  distinguish an aggregate-sourced value from a plain `fieldMapping`-resolved one, and there's no
  reason a raw metric value with many decimals should behave differently. Non-numeric strings
  (e.g. `"Active"`) and non-finite results (`"Infinity"`) fail the `Number.isFinite` check and pass
  through unformatted, so existing text-valued metrics are unaffected.
- Integers are unaffected: `Intl.NumberFormat` only adds fraction digits when the value has them
  (no `minimumFractionDigits` set), so `"42"` still renders `"42"` — existing
  `MetricRenderer.test.tsx` cases (`"84"`, `"42"`, `"100"`) keep passing unmodified.
- The `unit` slot is untouched — it continues to render as a separate sibling span
  (`data?.unit && <span>...`) after the formatted value, matching "respecting the panel's unit"
  from the ticket: formatting only ever touches the numeric value, never the unit suffix.

**Alternative considered**: significant-figures-based rounding (e.g. `toPrecision`). Rejected —
harder to reason about at a glance (`"1234.5"` → 5 sig figs → `"1234.5"` vs. `"0.012345"` → 5 sig
figs → `"0.012345"`, inconsistent visual length), and no stated need for it in the ticket.

### Decision 2 — `"Infinity"` divergence: document, do not align

The existing `panel-viz-aggregation` spec (`Requirement: Aggregation semantics match the pipeline
aggregate step`) already states TS aggregation operates over "values coercible to a **finite**
number." Making `coerceNumber` accept `"Infinity"` would itself be a spec-level behavior change
(and would let an `Infinity`/`-Infinity` aggregate flow into a chart's bar height or a metric's
value slot — a confusing result for a very unlikely real-data case). The ticket explicitly offers
either option and calls this scenario "very unlikely to matter on real data." Chosen: add a code
comment to `coerceNumber` documenting the intentional divergence and why (Scala's
`toDoubleOption`/Java `Double.parseDouble` grammar accepts `"Infinity"`/`"-Infinity"`/`"+Infinity"`
as non-finite doubles; TS's `Number.isFinite` guard deliberately excludes them to keep aggregate
results renderable). No behavior change, no spec delta needed for this half of the ticket.

## Risks / Trade-offs

- [Risk] Applying formatting to all metric values (not just aggregates) could theoretically change
  a raw data value's displayed precision for a pre-existing dashboard. → Mitigation: only numeric
  strings with a fractional Intl-rounded difference are affected; integers and non-numeric text
  are byte-for-byte unchanged, per Decision 1's integer/text-passthrough behavior.
- [Risk] A future contributor re-reads the "exactly mirrors" comment atop `aggregate.ts` and
  assumes full parity. → Mitigation: Decision 2's inline comment on `coerceNumber` explicitly flags
  the one documented exception, right at the code that diverges.

## Planner Notes

- Self-approved: precision policy (2 fraction digits, no grouping) and the "document, don't align"
  choice for `"Infinity"` — both are polish-ticket implementation details within the ticket's
  stated acceptance criteria, not architectural changes.
