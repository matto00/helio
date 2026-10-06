## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `76c43eef231b08d0ead0cbe1312726cac8bae2b3`. The diff base was resolved live with `resolve-review-base.sh` (origin/main): `2c1884ac5b2cc2578320ace4a21e37b32df5c603`, the merge-base with origin/main `a5a2fa2ce`. HEL-1334 is test-only backend and does not touch this diff.

### Phase 1: Spec Review — FAIL

The code satisfies every AC and the plan. The FAIL is about the committed evidence and the doc.

- AC1 is met. Pie slice labels go through `resolveChartTextColor` (`buildChartOption.ts:183-191`). `UsageChart` goes through `resolveChartTextColor(theme, undefined, tokens.text)` (`UsageChart.tsx:53`).
- AC4 is met (red on main). See Phase 2.
- **AC2 and design D3 are only partly met.** D3 requires "a default (`"inherit"`) pie panel ... plus one with percent labels on". The executor's percent-label pie never rendered percent labels:
  - `scratch/seed.cjs` puts `chartOptions: { pie: { showPercentLabels: true } }` on the **panel** `config`.
  - Since HEL-904, `chartOptions` lives on the **Output** config. `OutputPanelConfig(outputId, controls)` drops it (`backend/.../OutputPanel.scala:115-129`), and the frontend reads `readChartConfig(output.config)` (`PanelContent.tsx:261`).
  - Both panels were bound to the same output, so both rendered identically.
  - The measurement locator `.react-grid-item` with `hasText: "HEL-1342 pie"` also matches the "HEL-1342 pie-percent" card, so `.first()` selected the same card for both rows.
  - Proof that needs no mtimes: `md5sum` gives byte-identical `before/after-{light,dark}-pie.png` and `-pie-percent.png` in all 4 pairs (e.g. `3f47cfb8…` for both after-dark files). The image is titled "HEL-1342 pie-percent", and the labels read "East", not "East: 19.23%". `measure-after-raw.txt` shows no `formatter` in the `pie` or `pie-percent` series label.
  - So the "pie-percent" rows in `measure-before.md` / `measure-after.md` repeat the default pie's measurement under a second name.
- **`docs/contrast-audit.md` §10.1 is inaccurate on one point.** It says "Pie panels use ... (a default pie and a percent-label pie, 5 slices each)", and the table rows are labelled "Pie slice labels (default, percent)". The percent-label pie was not measured.
  - All ratios and colours in §10.1 are correct. I recomputed them: `#333` on `#1a1816` = 1.401, on `#fdfcfa` = 12.32. `#54555a` = 2.38 / 7.25. After: 15.43 / 16.33. The surfaces `#1a1816` / `#fdfcfa` match the dominant pixel of my own screenshots.
  - The causes paragraph and the "outline dropped" claim are correct (my measurement shows `stroke: null`).
- My own measurement shows the percent-label path does work after the fix. On this worktree's servers I seeded a real percent-label output and rendered labels "East: 19.23%" etc. with fill `#211d19` (light) / `#f2efe9` (dark), `stroke: null`, also under hover emphasis. So the code is fine; the committed claim about the evidence is wrong.
- Tasks: all are `[x]`. Task 1.2 ("Seed ... a percent-label pie panel") is marked done but did not happen as described.
- No scope creep in the source changes. No API, schema or backend change.
- CONSTRAINTS: `[]` (none to check). Driver constraints: `ci.yml`, `playwright.config.ts` and `.gitignore` are untouched. `.npm-cache-local/` is untracked and not committed.

### Phase 2: Code Review — PASS

Gates were re-run by me in `WORKTREE_PATH`, with `npm_config_cache` set to the worktree's `.npm-cache-local`:

| Gate | Result |
| --- | --- |
| `npm run lint` | EXIT 0 |
| `npm run format:check` | EXIT 0 |
| `npm --prefix frontend run typecheck` | EXIT 0 |
| `npm test` (maxWorkers 3) | 439 suites / 4580 tests passed, plus 38 suites / 371 tests at root |
| `npm --prefix frontend run build` | EXIT 0 |

**Can the pie pass get `series` as a single object?** Not on any reachable path today. I traced every producer:

- On the pie branch, `defaultOption.series` is stripped (`:117`) and `appearanceToEChartsOption` sets no `series`.
- `buildDataOption` always returns array series (`chartDataOptions.ts:82,92,119,139,157,176`), as do `withPointerCursor` and `buildAggregateDataOption` (`:190,201`).
- `applyPie` returns `seriesArray(...)`, which is always an array, and only runs when `chartOptions.pie` exists.
- There is no separate drilldown option path. `chart-drilldown-inspect` (`chartClickSelection.ts`) filters rows and never builds an ECharts option. `buildChartOption` has a single caller (`useChartOption.ts:87`).
- With no data, `series` is `undefined`. `?.map` returns `undefined` with no crash, and `applyHoverEmphasis` then returns early.
- The pass does not use the existing single-object normaliser (`chartTypeOptions.seriesArray` / `chartAppearance.toSeriesArray`), unlike its two sibling post-passes. If a future producer emitted a single object, it would throw `.map is not a function` rather than silently skipping. This is non-blocking because it is unreachable today; see Suggestions.

**Is the UsageChart test non-vacuous?** Yes.

- Red on main: in a scratch worktree at HEAD (since removed) with `buildChartOption.ts` and `UsageChart.tsx` reset to `2c1884ac5`, 7 tests failed — 6 pie-label cases plus the UsageChart theme-switch case.
- My own mutations, beyond the executor's three:
  - Drop only the legend colour: 1 red.
  - Drop only x `nameTextStyle`: 1 red.
  - Restore the outline (`textBorderWidth: 2`): 6 red.
  - Gate the pie pass to the aggregate path only: 5 red.
  - Use `themeTokens.text` instead of the resolved colour (ignores an explicit colour): 1 red.
  - Replace `resolveChartTextColor(theme, undefined, tokens.text)` with `tokens.text`: green. This mutant is equivalent (an undefined appearance resolves to the token), not a gap.
- The test installs distinct `--app-text` values per theme and switches theme through `ThemeProvider`, so the "follows theme" assertion is genuine.

Other checks:

- CONTRIBUTING: no inline FQNs, no `any`. Casts follow the existing `as object` pattern in the same files. Comments cite the ticket in the established style.
- DESIGN (mechanical): no raw colour literals in source. Text comes from the `--app-text` token through `resolveChartTheme`.
- No dead code or TODOs.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` and passed `assert-phase.sh servers`. Both process cwds were checked to be inside this worktree:

| Server | PID | cwd |
| --- | --- | --- |
| java | 2954405 | `.../hel-1342/backend` |
| vite | 2955716 | `.../hel-1342/frontend` |

Parent PIDs 2955671 (npm) and 2953821 / 2953772 (sbt) were recorded. All were stopped by recorded PID; the ports are free afterwards.

Was the executor's measurement on this worktree's own servers? I cannot re-verify its recorded PIDs; those processes are gone. The after-state fills (`#f2efe9` / `#211d19` on pie labels) only exist in this branch's code, and the before-state was hot-reloaded to the after-state on the same server. That is consistent with a server serving this worktree.

My own run used a headless Chromium context, DPR 2 and a throwaway owner user. In both themes:

- **Default pie and percent-label pie:** label fill = `--app-text` with no stroke, also under hover (`highlight`). The legend and slice labels are the same colour. Labels stay outside the slices and no label overlaps a sector.
- **All 4 usage charts** (signups, DAU/WAU, TTFD, provenance): axis ticks and legends use `--app-text` with no stroke. These are the only 4 `UsageChart` call sites (`AdminUsagePage.tsx:109,130,152,236`).
- **Breakpoints** 1440 / 1100 / 768 / 375 on the usage page and the dashboard: horizontal overflow is 0 in every case.
- **Console:** no errors and no `pageerror`. There were 8 ECharts "Can't get DOM width or height" warnings during resizes; these are not caused by this diff.

### Overall: FAIL

### Change Requests

1. **Re-measure the percent-label pie for real and correct the evidence.**
   - In `scratch/seed.cjs` (if kept) or a fresh seed, put `chartOptions: { pie: { showPercentLabels: true } }` on the **output** config (`POST /api/pipelines/:id/outputs` `config`), not on the panel config. Bind the percent panel to that second output.
   - Give the two panels titles where neither is a substring of the other, or match the exact title, so the locator cannot pick the same card twice.
   - Re-capture the before (main code) and after `pie-percent` rows and screenshots. Confirm the labels render "Name: NN.NN%" and that the `pie` and `pie-percent` PNG checksums differ.
   - Update `measure-before.md`, `measure-after.md` and the raw/JSON files.
   - Alternatively, remove the `pie-percent` rows and state plainly that only the default pie was measured on the running app.
2. **Fix `docs/contrast-audit.md` §10.1 to match the corrected evidence.** Either keep "a default pie and a percent-label pie" only once request 1 provides a real percent-label measurement, or reword it to the default pie only. Mark `tasks.md` 1.2 accurately.

### Non-blocking Suggestions

- In `buildChartOption.ts:186`, normalise through the existing single-object-or-array helper, as the sibling passes `applyChartTypeOptions` / `applyHoverEmphasis` do. A future single-object `series` would then be handled instead of throwing. This would also avoid writing an explicit `series: undefined` key on a no-data pie.
- `openspec/changes/.../scratch/` commits about 5.5k lines of JSON plus scripts with hardcoded `/home/matt/...` paths and a throwaway password literal (the user is deleted). Consider committing only the summarized `measure-*.md` / `*-raw.txt`.
- §10.1 cites `{before,after}-*.png`, which `.gitignore` (`*.png`) excludes from the repo. They are persisted under `.concertino/runs/HEL-1342/evidence/`; that path could be cited. HEL-1263's §10 has the same precedent.
- Pre-existing and not caused by this diff: at 375px, the DAU/WAU chart's two-line legend sits on the top gridline (`UsageChart` grid `top: 32` is unchanged). Possible follow-up candidate.

### Evaluator evidence (persisted)

- `/home/matt/Development/helio/.concertino/runs/HEL-1342/evidence/.eval-hel1342-c1/eval-measure.json` and `eval-measure.log` — per-element fills/strokes for both pies (incl. hover) and the 4 usage charts, both themes, plus overflow.
- `/home/matt/Development/helio/.concertino/runs/HEL-1342/evidence/.eval-hel1342-c1/eval-redmain.log` — the 7 red tests against main source.
- Screenshots: `eval-{light,dark}-pie-{Alpha,Bravo}.png`, `eval-dark-pie-Bravo-hover.png`, `eval-{light,dark}-usage-full.png`, `eval-{light,dark}-usage-375.png`, all under the same directory.

### Dev DB rows created by the evaluator (all deleted by exact id)

| Row | Id | Delete result |
| --- | --- | --- |
| user `hel1342-eval-1791290596636@example.test` | `7032c9ad-12b5-4591-bfd6-df8af023d518` | promoted with `UPDATE users SET tier='owner' WHERE id='7032c9ad-…'` → UPDATE 1; deleted → DELETE 1; re-query 0 |
| dashboard | `0184ffc3-39ec-4cec-bee0-3f5c990b1068` | 204 |
| data source | `ac2b8dfd-4d24-4c16-8aed-5e65e38c969a` | 204 |
| pipeline | `d0f89960-7add-4413-91d6-15c08798bae6` | 204 |
| output (default) | `b63d3b0c-97d4-4a1c-b779-6649366ae104` | 200 |
| output (percent) | `17cffecb-17bf-445e-8509-024ccfc29599` | 200 |
| panel (default) | `ffd2e9bd-5845-47e3-8306-d93c80a2b07a` | 204 |
| panel (percent) | `c327ab5c-48ba-4a7c-be7f-9228cdba4832` | 204 |
| `pipeline_run_rate_window` rows for the user | by `user_id='7032c9ad-…'` | DELETE 1 |

A re-query by exact id shows 0 rows for every panel, the dashboard, both outputs, the pipeline and the source.
