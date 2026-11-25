## Standing Constraints

## 1. Red tests (commit the red run as .txt before any implementation)

- [x] 1.1 Item 1: unit tests for `timeAxisMinInterval` and for the built option's time `xAxis.minInterval` (raw and aggregate); red run recorded
- [x] 1.2 Item 2: unit tests for summing on category and time multi-series, non-numeric y, and the summed-rows note text; red run recorded
- [x] 1.3 Item 3: unit tests for scatter non-numeric x exclusion and the no-numeric-x note; red run recorded
- [x] 1.4 Item 4: unit tests for isolated-point markPoints (single-series category, repeated category, time; markers on unchanged; multi-series checked live by the evaluator and final skeptic); red run recorded
- [x] 1.5 Item 5: GUARD case {xAxis, series} no yAxis in `chartTimePlan.test.ts`, shown red under the M2 mutation, labelled GUARD
- [x] 1.6 Commit red output as `.txt` under the change dir (or keep as evidence if the hook refuses; say so)

### Frontend

- [x] 2.1 D1: `timeAxisMinInterval` in `utils/chartTimeAxis.ts`, applied in `buildChartOption.ts`; verify echarts 6.1.0 honours it; 1.1 green
- [x] 2.2 D2: echarts-free summing helper and summed-rows note; both multi-series builders use it; 1.2 green
- [x] 2.3 D3: scatter x filter and no-numeric-x note; 1.3 green
- [x] 2.4 D4: isolated-point markPoint (category index coord) in `applyLine`; register `MarkPointComponent` in `echartsCore.ts`; 1.4 green
- [x] 2.5 D5: `ChartRenderer` joins notes into one line; RTL test with two notes green

### Tests

- [x] 3.1 GUARD (independent brute-force oracle, design D7): summed note N and summed values vs input rows; red under raw-x time keying and extra-rows-only counting
- [x] 3.2 Mutation runs for every D7 mutation (incl. `MarkPointComponent` removed -> hel1517 e2e red), each recorded red then reverted
- [x] 3.3a New `e2e/hel1517-chart-followups.spec.ts` (rendered isolated marker, live minInterval, summed footnote); green, 2 workers, lane DB
- [x] 3.3 e2e positive control in `e2e/hel1508-chart-time-axis-followups.spec.ts`; full spec file green, 2 workers, lane DB
- [x] 3.4 Full jest suite, lint, typecheck, format check green
- [x] 3.5 UI check: daily time axis at 375 px and desktop, light and dark, no time-of-day labels; summed footnote visible; isolated marker visible light+dark in its line's colour; a two-note chart at 375 px recorded
