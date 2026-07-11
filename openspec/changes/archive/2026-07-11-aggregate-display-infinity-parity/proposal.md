## Why

HEL-292's final gates flagged two non-blocking polish items in the client-side viz aggregation
path: an unrounded metric aggregate can overflow the panel's value slot at narrow widths, and
`aggregate.ts` diverges from the backend's `AggregateStep` on how it treats the literal string
`"Infinity"`.

## What Changes

- Format the metric panel's rendered value: cap decimal precision (max 2 fraction digits, no
  thousands grouping) for any numeric-looking `data.value` string in `MetricRenderer`, so long/
  repeating decimals from an `avg` aggregate no longer overflow the value slot. Non-numeric text
  and non-finite results (e.g. `"Infinity"`) pass through unformatted.
- Document (code comment only, no behavior change) why `aggregate.ts`'s `coerceNumber` treats the
  literal string `"Infinity"` as non-coercible while Scala's `s.toDoubleOption` accepts it — the
  existing `panel-viz-aggregation` spec already requires "coercible to a **finite** number," so
  aligning behavior would itself be a spec change, and the ticket flags this as very unlikely to
  matter on real data.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `panel-viz-aggregation`: add a requirement that the metric panel's rendered aggregate value is
  formatted (decimal precision capped) rather than displayed as a raw unrounded number.

## Impact

- `frontend/src/features/panels/ui/renderers/MetricRenderer.tsx` — add display-formatting helper.
- `frontend/src/utils/aggregate.ts` — code comment only (Infinity divergence rationale).
- `openspec/specs/panel-viz-aggregation/spec.md` — new requirement (delta spec) for value-slot
  display formatting.

## Non-goals

- No change to `computeAggregate`/`groupAndAggregate` numeric semantics.
- No change to chart-panel groupBy value formatting (chart axis/tooltip formatting is out of
  scope; only the metric value slot is affected).
- No alignment of `"Infinity"` string coercion between the TS and Scala aggregate paths.
