## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: fc69f7de9bf1d0c26d64ba42b37965d61a486619 (base a606a9833910e36ad544e6aff6e4b87049245559, resolved live via resolve-review-base.sh).

### Phase 1: Spec Review — FAIL

- AC "decide and fix each item or defer": items 1, 3 and 4 are implemented. Item 2 was escalated and deferred to HEL-1358 per the owner, as proposal/design record. PASS.
- D1–D7 match the diff: `chartAggregationSpec` is the one aggregation rule, used by the preview, the dashboard, the overlay selector and the blocker. `groupAndAggregate` is reused (C2 honoured: no second grouping implementation). The grouped-mode overlay keeps the completeness and filter rules (C1 honoured: `ChartOutputPanel` passes `rowsTruncated`/`filterActive` unchanged, and the grouped overlay is suppressed when the panel falls back to raw rows). Clicks and Inspect key on groupBy and use record rows. The aggregate series is named `<agg>(<yField>)`. The compact legend shows only when an overlay is applied. `resolvePanelChartType` drives both render and `chartInspectConfig`. PanelDetailModal's `appearance.chart` path is untouched.
- **Issue (task 4.6 / 4.5 evidence for item 3 is vacuous):** `e2e/hel1351-aggregated-chart-overlay.spec.ts` claims (header comment, lines 9–11) that "a default-size (compact) panel of the same Output keeps a legend naming the overlay ... proven by the saved screenshots". The "HEL-1351 Compact" panel is not compact at the spec's 1440x900 viewport. I reproduced the same layout (`auto-layout` w:6 h:3 next to w:6 h:5) and read the live ECharts option. The h:3 panel renders at 525x288 with the non-compact grid (`top 65 / bottom 80 / left 15% / right 10%`) and a non-scroll legend, which is identical to the h:5 panel. The 179px compact threshold is never reached. The committed `screenshots/aggregated-overlay-compact-legend-{light,dark}.png` show the ordinary desktop legend (no `scroll`, full-size items), so they would look the same if D6 were reverted. Item 3 therefore has no real live evidence from the executor, and the e2e cannot fail on an item-3 regression. Task 4.6 says "Running-app check of items 1/3/4", so it is ticked without what it claims.
- Scope: no creep. The ~20 test-fixture edits only remove the deleted `chartAggregate` field.
- Planning artifacts reflect the implemented behaviour.
- CONSTRAINTS C1/C2: honoured (see above).

### Phase 2: Code Review — PASS

Gates, run fresh by me in the worktree (logs in `.eval-hel1351/`, all workers capped at 3 and run under `nice -n 19`):
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `tsc --noEmit` (frontend): exit 0.
- Root jest: 39 suites / 376 tests passed. Frontend jest (`--maxWorkers=3`): **460 suites / 4840 tests passed, 0 failed**.
- `npm --prefix frontend run build`: exit 0.
- Executor's claim that two PipelineDetailPage jest failures are load-timing flakes: I did not reproduce any failure. PipelineDetailPage passed in the full suite and in 3 further isolated runs (178/178 each, `jest-pdp-{1,2,3}.log`). That is consistent with the claim and gives no evidence of a regression from this change. It does not prove the flake's cause.

Review notes (no blocking issues):
- Type safety: the new code adds no `any`. `resolvePanelChartType` casts a stored `chart.chartType` (`as ChartType`) without validating it, which is the same trust the prior `resolveChartType` had.
- Mechanical standards: no hardcoded colours, spacing or font literals were added in CSS/TSX. The new px constants in `buildChartOption.ts` are ECharts canvas geometry, named and commented, in line with the existing `COMPACT_GRID_INSET_PX`.
- Tests are meaningful: the unit and component cases cover a grouped match and an agg mismatch, truncated, filtered, scatter exclusion, the null group, overlay-click series naming, the compact legend with/without overlay and with explicit-hidden/stored position, the resolver precedence, and the modal save omitting `chart`.

### Phase 3: UI Review — PASS (live, both themes; independent of executor screenshots)

The servers on 6783/9690 were confirmed to be this worktree's own: `/proc/<pid>/cwd` resolves to this worktree, and the dev server serves the new `resolvePanelChartType.ts`. A lane-private Playwright probe (fresh test-runner browser, never the shared MCP browser) used real runs and backdated real history. It read the rendered ECharts option from the live chart instance rather than relying on pixels.
- Item 1 (aggregation), both themes: the aggregated bar panel plots `sum(amount)` = east 15, west 7 (raw rows east 10, east 5, west 7) plus `vs 7d` = 11, 9. Fullscreen shows the same option. Clicking the west bar opens Inspect with "Showing rows for region: west / sum(amount)" and exactly one row (west, 7).
- Item 3 (compact legend), both themes: at 768 and 390 the panel is genuinely compact (canvas height 100px). The legend has `show: true, type: "scroll"`, and the grid is `top 30 (8+22) / 8 / 8 / 8`. Screenshots show "sum(amount) / vs 7d" readable in the mobile stack.
- Item 4 (chart type), both themes: a panel with no stored type on a bar Output renders bar, for both the aggregated and the raw Output. A stored `chartType: "line"` override renders line, with a line overlay. After rendering, the stored appearance of the no-type panels is still `chart: null` (rendering never writes it).
- Breakpoints 1440/1100/768/390: no layout breakage observed.
- Console: the only errors were two 401s from the pre-login auth probe and one `localStorage` pageerror from my probe's init script on `about:blank` (harness artifacts, not app errors).
- Evidence (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-1351/evidence/.eval-hel1351/probe-run2.log`, `.../shots/dashboard-1440-{light,dark}.png`, `.../shots/bp-768-light.png`, `.../shots/bp-390-dark.png`, `.../shots/inspect-west-dark.png`, all screenshots under `.../shots-all/`, and the probe source `.../probe/hel1351.probe.ts`.
- Test data: the 4 dashboards, 4 pipelines and 4 sources were deleted by exact id. A DB recount of those ids returned 0. The 4 throwaway users remain (`04e8f377-2d90-4a3a-af33-86e1ed332701`, `1d7d9dc4-b8da-4598-983e-f1db1a8bed91`, `4aa96dab-bece-4a8d-a1e4-2b14f8dee5b2`, `fcf5c61a-2864-49ee-8647-c831adbc9861`; `@example.test`, none touching matt@helio.dev).

### Overall: FAIL

### Change Requests
1. `e2e/hel1351-aggregated-chart-overlay.spec.ts`: make the item-3 case actually compact and make it fail if D6 regresses. Either drive the compact assertion at a viewport where the chart is compact (e.g. `page.setViewportSize({ width: 390, height: 844 })` or 768, where the canvas measures 100px), or size the panel so its canvas is under `CHART_COMPACT_HEIGHT_PX` (179). Then assert something D6-specific rather than a screenshot alone. For example, read the live option (the ECharts instance is reachable from the canvas via the ReactECharts fiber's `getEchartsInstance()`) and assert `legend[0].show === true`, `legend[0].type === "scroll"` and the canvas height < 179. Regenerate `screenshots/aggregated-overlay-compact-legend-{light,dark}.png` from that genuinely compact state. Also correct the header comment (lines 9–11), which currently claims compact-legend proof the spec does not provide.

### Non-blocking Suggestions
- `PanelCard.tsx` is 840 lines (825 before), well past CONTRIBUTING's ~400-line "propose a split" threshold. Mention a split in the PR description.
- `PanelCard.tsx:468`: `chartInspectConfig.aggregation` is set whenever the Output is aggregated, even in the transient case where `ChartOutputPanel` falls back to raw rows (records null). Inspect then lists nothing for that click. This is harmless because records are null only before data loads, but deriving it from the same "grouped plot" condition would remove the asymmetry.
- The e2e registers users it never removes (repo-wide pattern). Not this ticket's to fix.
