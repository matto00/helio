## Standing Constraints

- [C1] Owner rulings 2026-10-11 bind (Q1-Q4 = A, see proposal.md); HEL-1397 is not decided by this change.
- [C2] Red first: each Tests-group test is written and shown failing (pre-change code or mutation) before its implementation task; evidence in the run evidence dir.
- [C3] No --no-verify/HUSKY=0/hooksPath override; nice -n 19 heavy jobs; MemAvailable >= 15 GB before sbt testFull or full jest; stop every sbt server you start.
- [C4] No claude.ai session link and no Claude-Session trailer in commits or the PR body.
- [C5] Playwright/screenshot output only inside the worktree or .concertino/runs/HEL-1311/evidence, never the main checkout root.

## 1. Backend

### Backend
- [x] 1.1 Add `ChartTypes` (`All`, `NonAggregating`) in `domain/panels`; verify by the seam spec in 4.1 going green.
- [x] 1.2 Use it in `OutputConfigValidation` (chartType, non-aggregating rule, KeysDoc text); verify `OutputConfigValidationSpec`.
- [x] 1.3 Add `chartOptions.histogram.binCount` validation (tolerance rule, 2-100 integer or null); verify 4.2.
- [x] 1.4 Use `ChartTypes` in `RequestValidation` (incl. its error string), `AssistantProposalToolSchemas`, `OutputSummaryReducer`; verify existing specs pass.

## 2. Schemas and MCP

### Backend
- [x] 2.1 Add `heatmap`/`histogram` to all six `schemas/**` chart-type enums and update the three Output schemas' config descriptions (types, non-aggregating, binCount); verify schema-drift check green.
- [x] 2.2 helio-mcp: one exported chart-type const used by `proposal.ts` and the `outputs.ts` doc (describe slots + binCount); verify helio-mcp tests.

## 3. Frontend

### Frontend
- [x] 3.1 `CHART_TYPES`/`NON_AGGREGATING_CHART_TYPES` in `chartAppearance.ts`; replace every "never aggregates" scatter check (design D1); verify typecheck.
- [x] 3.2 `utils/histogramBins.ts` pure binning (design D3); verify 4.5.
- [x] 3.3 Register HeatmapChart + VisualMapComponent; heatmap/histogram branches in `chartDataOptions.ts`; accent-opacity visualMap; heatmap yAxis merge in `buildChartOption` (D4); verify 4.6.
- [x] 3.4 Skipped-values note through the ChartRenderer note slot (design D5); verify 4.6.
- [x] 3.5 Default cursor/no selection for the new types (D6); overlay blocker `chartType` checked first, parameterised note, help text + snapshots updated; verify 4.7.
- [x] 3.6 HistoryChart muted note for the new types; verify 4.7.
- [x] 3.7 Editor: chart-type options, chartFieldMapping setter, heatmap/histogram slot pickers, aggregation hint, histogram bin control, `readChartConfig` binCount sanitising; verify 4.8.
- [x] 3.8 Check `ChartAppearanceEditor` reachability and update only if reachable; record the finding in files-modified.md.

## 4. Tests

### Tests
- [x] 4.1 Backend: route test creates heatmap and histogram Outputs (201; red first). Guard: walk schemas/** chartType enums, exactly 6, each == `ChartTypes.All`; mutation evidence.
- [x] 4.2 Backend: aggregation rejected on heatmap/histogram (incl. bar->histogram patch); binCount 1/101/2.5/"10" -> 400, 2/100/null ok.
- [x] 4.3 Guards (labelled): frontend and helio-mcp walk schemas/** chartType enums, exactly 6, each equals `CHART_TYPES` / the MCP const; mutation evidence.
- [x] 4.4 Frontend: `buildOutputConfig` for each new type emits a schema-set chartType and `aggregation: null`.
- [x] 4.5 `binHistogram`: Sturges (100 -> 8), configured count, max in last bin, equal values, skipped count, no numerics.
- [x] 4.6 `buildChartOption`: heatmap category yAxis of rows + visualMap (calculable false; every inRange colour parses with zrender `parse`), sums, empty cells omitted, unmapped xAxis/series/yAxis -> empty; histogram binCount honoured, no xAxis -> empty.
- [x] 4.7 No overlay/selection for both types; hover cursor on the running app is not pointer (Playwright); compare note names the type; History note renders.
- [x] 4.8 Output editor: heatmap/histogram save payloads per spec; numeric-only pickers from capabilities, not-numeric stored choice, no-numeric hint; Automatic saves no binCount.
- [x] 4.9 Running app, light+dark, desktop+375px: heatmap cells visibly accent-coloured (also Yellow accent, light), histogram, editor, notes; screenshots in evidence dir; bundle size before/after.
- [x] 4.10 Update `openspec/specs/chart-type-selector/spec.md` Purpose to list heatmap and histogram; verify grep.
