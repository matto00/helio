## Skeptic Report — design gate (round 3, skeptic-design-3.md)

I reviewed HEAD `a29a7e5ce23108a682fd87aea7d79edd6b922dc9`. The change dir is untracked, so I reviewed the artifacts as they are on disk.
Owner rulings Q1-Q4 (all A) are binding and I did not re-open them.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/heatmap-histogram-chart-types/HEL-1311`.

**Round 2, CR-A (heatmap colour must be parseable): resolved.**

D4 now uses `inRange: { color: [tokens.accent], opacity: [0.25, 1] }`, with `ChartThemeTokens.accent` read from `--app-accent`. I checked each link in that chain against the code and a real browser:

- **CSS source.** `theme.css` defines `--app-accent` as a plain hex value in both theme blocks:
  - line 188, inside `:root[data-theme="dark"]` (block starts at line 146): `#f97316`
  - line 262, inside `:root[data-theme="light"]` (block starts at line 230): `#ea580c`

  These are the only two definitions.
- **Runtime source.** `appearance.ts:621` (`buildAccentTokens`) writes `"--app-accent": hex` inline on `<html>`. It does this only after `parseHexColor` accepts the value against `/^#([0-9a-f]{6})$/i`. Any other value returns `{}`, so the stylesheet hex stays in place. A non-hex accent cannot reach the property.
- **Browser read.** In Playwright HeadlessChrome/151, `getComputedStyle(documentElement).getPropertyValue("--app-accent")` returned:
  - `"#f97316"` for the dark stylesheet
  - `"#ea580c"` for the light stylesheet
  - `"#eab308"` after an inline `setProperty` with the Yellow preset

  All three are plain hex. The browser does not leave them as an unresolved expression, unlike `--app-accent-strong`'s `color-mix()`.
- **zrender parse.** Run against `frontend/node_modules/zrender/lib/tool/color.js`, `parse` accepted `#f97316`, `#ea580c`, `" #eab308"` (leading space) and `#EAB308`. It returned rgba arrays for all four. `parse` strips spaces itself, and `resolveChartTheme` also `.trim()`s.
- **ECharts honours the opacity channel on heatmap cells (6.1.0).**
  - `visual/helper.js:87-88` (`setItemVisualFromData`) writes the `opacity` visual to `style.opacity`.
  - `chart/heatmap/HeatmapView.js:181/191-197` builds each Rect from `getItemVisual(idx,'style')`.
  - A single-entry `color` array maps to that one colour across the whole range.
- **Fallback and tests.** D4 keeps a parse guard with a Jest/SSR hex fallback. Task 4.6 asserts that every `inRange` colour parses with zrender `parse`. Task 4.9 requires visible accent-coloured cells in both themes, including Yellow on light. The low end (0.25 opacity floor, raised if not visible) is stated, which answers round 2's "state the low end" request.

**Round 2 non-blocking notes: all addressed.**

- **Unmapped xAxis.** D4 checks `fieldMapping.xAxis`, `series` and `yAxis` explicitly, never `resolveDataColumns`' column-0 fallback. A histogram with no xAxis renders empty. Task 4.6 covers unmapped xAxis/series/yAxis and histogram with no xAxis.
- **binCount plumbing.** A new histogram-options parameter sits next to the scatter one. I confirmed that `buildChartOption.ts:121` passes only `chartOptions?.scatter` today.
- **Tooltip.** The tooltip `valueFormatter` is checked on the running app.
- **chart-type-selector Purpose.** Task 4.10 updates it.

**Code citations re-checked at HEAD. All accurate:**

- `buildChartOption.ts:121` (scatter-only options)
- `buildChartOption.ts:173-175` (yAxis spread from default/appearance)
- `buildChartOption.ts:~304` (compact post-pass spreads `built.yAxis`)
- `RequestValidation.scala:89` (literal list in the error string)
- `OutputConfigValidation.scala:113` (scatter check)
- `OutputSummaryReducer.scala:116`
- `useOutputKindState.ts:81` (read-only `chartFieldMapping` state)
- `chartOverlay.ts:47/69`
- `domain/panels` exists for the new `ChartTypes` object.

**Enumeration completeness.** I re-grepped `"scatter"` across `frontend/src`, `backend/src/main` and `helio-mcp/src`, excluding tests and snapshots:

- Every frontend hit is in D1's list or is scatter-specific data, display or click code that D1 explicitly keeps.
- On the backend, `DashboardServiceValidation.scala:44` is the only hit not in D1, and it is comment-only (the HEL-904 removal note). The live sites are `RequestValidation`, `OutputConfigValidation`, `AssistantProposalToolSchemas:78` and `OutputSummaryReducer`, and all are in D1.
- In MCP, `proposal.ts` is in D1.

**Seam tests can go red.**

- The two genuinely red-first tests are named:
  - a backend route test expecting 201 (returns 400 before the change)
  - `buildOutputConfig` emitting `aggregation: null` (only scatter does that before the change)
- The schema-walking guards are labelled as guards, assert exactly 6 schemas were found, and record the mutation that turns them red. This is unchanged from round 2, where it was verified.

**DESIGN.md.**

- No new `theme.css` token is added (D4 says this explicitly).
- Light and dark at desktop and 375px are covered by task 4.9.
- The editor's controls use the shared `Select`/number-input idiom, and the 375px touch-target rule is in the spec.

### Verdict: CONFIRM

The one blocking item from round 2 (CR-A) is fixed with a mechanism I verified end to end: the CSS source, the inline write, the browser's computed value, zrender `parse`, and ECharts' visual encoding. All prior change requests stay resolved, and the code claims hold at HEAD. I found nothing new that blocks implementation.

### Non-blocking notes

- **Garbled spec sentence.** In "Output editor configures heatmap and histogram" (heatmap-histogram-charts spec), the bin-count control is spliced into the no-numeric-column clause: "...disabled with a hint to cast a column to a number and a bin-count control that is Automatic...". Read literally, the bin-count control only appears when there is no numeric column. D7 and task 3.7 make the intent clear (the bin-count control is always shown for histogram). Split the sentence when archiving the spec.
- **Scatter-specific error text.** `OutputConfigValidation.scala:115`'s rejection message names "a scatter chart". When D1 generalises the check to `NonAggregating`, the message should name the actual chartType. The spec only requires that it names `aggregation`, so this is polish.
- **Bundle impact of the parse guard.** The `--app-accent` guard in `resolveChartTheme` should not pull echarts into the main chunk. Import `zrender/lib/tool/color` directly, or use a hex/rgb regex equivalent, and confirm in the bundle before/after note (task 4.9).
- **Hover emphasis on heatmap cells.** The existing hover emphasis strokes in `accentStrong`, which sits on accent-filled cells. Check during 4.9 that a hovered cell stays visibly distinct, especially at full opacity.
