## Why

HEL-1181 reported pie panels rendering "needle slices" (one slice per raw row) under resize/theme toggle, blaming an
aggregation config that was never applied client-side. HEL-1351 has since fixed that root cause, and a live probe on
main found no resize/theme race. What is still missing is the ticket's AC2: no test pins that a **pie** Output with a
configured `aggregation` reaches the chart grouped — the dashboard-card coverage HEL-1351 added is bar-only, and the
pie coverage (HEL-624) starts from an already-computed aggregate. A regression in either the grouping step or the pie
branch of option building would bring needle slices back silently.

## What Changes

- Add a red-first regression test: a pie chart Output with `aggregation` and many rows of repeated categories, rendered
  through the dashboard card, plots one slice per group with the aggregated value, in both themes across a re-render.
- Add a control case pinning today's unaggregated-pie behavior (one slice per row) so this change provably alters no
  production behavior.
- No production code change.

## Non-goals

- Changing what an unaggregated pie renders (auto-merge, warn, nudge) — a product question filed separately.
- The resize → remount → refetch `/api` rate-limit storm observed during the probe — filed separately.
- E2E/Playwright coverage: the live resize/theme probe is recorded evidence; the regression lives at the unit layer.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — test-only change; `skip_specs: true`)

## Impact

- `frontend/src/features/panels/ui/` — one new Jest test file. No source, API, schema, or migration change.
