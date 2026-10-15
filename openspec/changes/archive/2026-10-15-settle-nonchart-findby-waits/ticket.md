# HEL-1612: Non-chart findBy waits in panel tests still race the 1s deadline against meta/rows/history promises

## Description

Origin: HEL-1599 (PR matto00/helio#1035, 1ebf23fd0), lane-reported; full table in
openspec/changes/archive/2026-10-15-settle-lazy-chart-mounts/measurements.md.

HEL-1599 converted every lazy-chart `findBy*` wait to the shared `settleChartMount` helper
(frontend/src/test/settleChartMount.ts). The `findByText`/`findByRole` waits it left alone render outside the lazy
boundary, such as the truncation note and the table, metric and markdown waits. They still race RTL's fixed 1s deadline
against the output meta, rows and history promises, so they can flake under a CI main-thread stall, the mechanism
HEL-1596 established.

Do: for each listed wait, settle the awaited mock promises inside `act` (extend the helper or add a sibling), then query
synchronously. Prove each file with HEL-1596's injected-stall method: red before, green after. Never raise timeouts or
add retries.

## Acceptance Criteria

- AC1: Every wait listed in the HEL-1599 measurements.md "Left" table's non-lazy-chart row
  (`PanelContent.chartTruncation` note waits, `PublicDashboardViewerPage.truncation` note wait,
  `PanelCard.crossFilter` `findByRole("table")`/`findByText` waits, `PanelFullscreenOverlay.test` `findByRole("table")`,
  `PanelContent.test` metric/markdown/table waits) settles its awaited mock promises inside `act` (via an extended or
  sibling helper under `frontend/src/test/`) and then queries synchronously.
- AC2: Each changed file is proven red before / green after with HEL-1596's injected-stall method (scratch-only stall,
  recorded fired count), with literal commands and results in this change's `measurements.md`.
- AC3: No raised timeouts, no retries, no product-code change.
- AC4: HEL-1600's network guard stays active; any new mock is at the narrowest service function.
- AC5: Full frontend jest suite green on the final head.

## Context (driver brief, overnight run)

Test-only, non-UI. Local caps: jest at most 3 workers, `nice -n 19`, at most 3-4 parallel processes. Concurrent lanes
HEL-1610 (backend chat-gate spec) and HEL-1598 (specs); parked 1575/1576/1578/1579/1572/1583 — touch none of their files.
