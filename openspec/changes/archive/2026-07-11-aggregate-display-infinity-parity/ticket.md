# HEL-297: HEL-292 aggregation follow-ups: round metric aggregate display; `"Infinity"` parse parity

Priority: Low
URL: https://linear.app/helioapp/issue/HEL-297/hel-292-aggregation-follow-ups-round-metric-aggregate-display-infinity

## Description

Two non-blocking polish items flagged by the HEL-292 ("Panel-level aggregation for metric and chart panels — hybrid model") final gates. Both live in the client-side aggregation path (`frontend/src/utils/aggregate.ts` + metric rendering).

### 1. Round/format the metric aggregate for display (real UX impact)

`computeAggregate` returns an unrounded number, so an `avg` (or any non-integer aggregate) can produce a long decimal that visually overflows the metric value slot at narrower panel widths. Apply sensible display rounding/formatting in the metric renderer (respecting the panel's `unit` where present). Decide precision policy — a fixed decimal count vs. significant figures — before implementing.

### 2. `"Infinity"` parse parity with the backend (trivial)

`aggregate.ts` treats the literal string `"Infinity"` as non-finite and excludes it, whereas Scala's `toDoubleOption` (used by the pipeline `AggregateStep`) parses it as a real value. Very unlikely to matter on real data, but it's a documented behavioral divergence between the two aggregate implementations that are meant to match. Either align `aggregate.ts` to accept it, or add a comment documenting the intentional divergence.

## Acceptance criteria

- A metric `avg` over rows producing a repeating/long decimal renders within the panel value slot at all breakpoints.
- `"Infinity"` handling is either aligned across the TS/Scala aggregate paths or explicitly documented as intentionally divergent.
