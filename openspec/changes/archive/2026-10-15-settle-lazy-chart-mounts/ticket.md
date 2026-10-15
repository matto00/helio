# HEL-1599: Chart test suites race findBy's 1 s deadline against the lazy ChartPanel mount (PanelCard.inspect / aggregateChart)

## Description

Follow-up from HEL-1596 (PR matto00/helio#1028).

`PanelCard.inspect.test.tsx`, `PanelCard.aggregateChart.test.tsx` and other chart suites wait for the chart with `findByTestId("echarts")`. The chart only mounts after `ChartRenderer`'s lazy `ChartPanel` loads, which is the same pattern HEL-1596 found in `PanelCard.crossFilter.test.tsx`.

In HEL-1596, a ~1 s main-thread stall that lands before the chart mounts beats RTL's 1 s polling deadline. The stall was injected locally and reproduced the exact CI failure DOM. These suites are likely exposed the same way, but this is unverified: probe each one with the same injected stall before changing it. If a suite is exposed, apply the HEL-1596 pattern: await the causal promises inside `act`, then query synchronously. Never raise a timeout or add retries.

See `openspec/changes/archive/2026-10-14-fix-crossfilter-echarts-flake/measurements.md`.

origin_kind: followup
origin_ticket: HEL-1596

## Acceptance Criteria (ticket + driver brief)

1. Probe `PanelCard.inspect.test.tsx` and `PanelCard.aggregateChart.test.tsx` with HEL-1596's injected-stall method before changing them.
2. For each exposed suite, apply HEL-1596's `settleChartMount()` approach (await causal promises inside `act`, then query synchronously). If the helper is reused across files, factor it into a shared test helper.
3. Prove each converted test red before / green after with the injected stall.
4. Sweep the frontend tests for other `findBy*` waits on lazily mounted charts; convert the exposed ones and list every site converted and every site left, with reasons.
5. Never raise a timeout and never add retries.
