## Standing Constraints

- [C1] A theme assertion must switch the theme through the real ThemeProvider (`useTheme().toggleTheme`) and prove the switch reached the chart option before asserting anything else across it; a PanelCard `theme` prop change is not a theme switch.
- [C2] Mutation/red-first transcripts are persisted via `scripts/concertino/persist-evidence.sh`, not only left in gitignored `e2e-evidence/`.

## 1. Tests

- [x] 1.1 Add `frontend/src/features/panels/ui/PanelCard.aggregatePieChart.test.tsx` per design D1–D3: aggregated pie Output (80 records, 4 repeated categories) renders 4 `{name,value}` slices with independently computed sums; then toggle the theme via a `useTheme().toggleTheme` helper inside `act` (wait for the rAF recompute), assert `data-theme` flipped and a theme-dependent option value changed, re-assert the 4 slices, toggle back and re-assert (design D3) — verify `npm test -- --testPathPatterns=PanelCard.aggregatePieChart` passes
- [x] 1.2 Add the D4 control case (no `aggregation` → one slice per row, commented as pinning current behavior) — verify it passes
- [x] 1.3 Red-first per D5: apply mutation M1 (`buildChartOption.ts` pie dropped from `useAggregate`) and M2 (`ChartOutputPanel.tsx` `chartAggregate` forced null), run the test file under each, confirm the aggregated-pie cases fail and the control passes; save transcripts under `e2e-evidence/HEL-1181/` and persist each with `persist-evidence.sh`; revert both — verify `git diff` vs base shows only the new test file
- [x] 1.4 Run frontend lint, typecheck, format:check and the panels test directory — verify all green
