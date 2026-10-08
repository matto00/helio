# HEL-1181: Pie chart panels can render as one-slice-per-row under resize/theme toggle (needle slices)

## Description

origin_kind: followup / origin_ticket: HEL-588.

While delivering HEL-588 (dashboard cross-filtering), the executor and evaluator found a pre-existing rendering defect:
a pie chart panel bound to many raw, ungrouped rows can render "needle slices" (one wafer-thin slice per row) under a
combination of 3+ Output panels including a chart, a viewport resize, or a theme toggle.

Root cause as filed: `usePanelData.ts` hardcodes `chartAggregate: null` (a post-HEL-909 migration artifact) so a chart
Output's own `aggregation` config is never applied client-side; resize/theme merely triggers a redraw that exposes it.

Likely shape (implementer decides): apply a chart Output's own `aggregation` config (groupBy + agg) to raw rows before
building the ECharts option, or otherwise ensure a pie with many raw rows groups sensibly by default.

## Acceptance Criteria (as filed)

- A pie chart panel bound to an Output with many raw, ungrouped rows renders a sensible number of slices, not one per row.
- A red-first test: a pie chart with a configured `aggregation` groups its data before charting.
- No behavior change for a pie chart already configured with a meaningful `fieldMapping`/small row count.

## Premise validation and restated scope (2026-10-08)

Evidence: `.concertino/runs/HEL-1181/evidence/premise-validation.md` (main checkout).

- The filed root cause is already fixed on main (e93bebc32): HEL-1351 (#820) groups aggregated chart Outputs client-side
  in `ChartOutputPanel.tsx`; `usePanelData.ts` no longer carries `chartAggregate`.
- No resize/theme render race: a live probe on main (both themes, resizes 1400..500, 8 rapid theme toggles, combined
  resize+toggle, per-frame sampling of the ECharts option) read the aggregated pie at 4/4 slices every sample.
- An Output with NO `aggregation` config still renders one slice per row by construction; whether that should change is
  a product question, out of scope here (filed separately by the driver for the owner).

Decision (ticket-drift escalation answered `proceed-with-restated-scope` — driver, overnight delegation, NOT an owner
ruling): the deliverable is AC2's missing pie-specific regression coverage.

## Restated Acceptance Criteria

1. A red-first regression test drives a pie chart Output with a configured `aggregation` through the dashboard card path
   (Output config → grouping → final ECharts option) and asserts many raw rows with repeated categories render one slice
   per group with the aggregated value — and keeps doing so when the card re-renders with the other theme.
2. Red-first proof: recorded mutation transcripts showing the new test fails when pie grouping is disabled, and passes
   on main.
3. No production behavior change: an unaggregated pie, and an aggregated pie with few rows, render exactly as today
   (pinned by a control case that documents current behavior without endorsing it).
4. Out of scope (do not fix here): the unaggregated-pie default (product question) and the resize → remount → refetch
   rate-limit storm (separate bug).
