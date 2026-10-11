## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `a29a7e5ce23108a682fd87aea7d79edd6b922dc9`. The change dir is untracked, and I reviewed the artifacts as
they are on disk. Owner rulings Q1-Q4 = A are binding and I did not re-open them.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/heatmap-histogram-chart-types/HEL-1311`.

**Status of the round-1 change requests**

- **CR1 (cursor): resolved, with a real mechanism.**
  - In zrender 6.1.0, `Handler.prototype.mousemove` (`node_modules/zrender/lib/Handler.js:95` then `:99`) calls
    `proxy.setCursor(hoveredTarget.cursor)` *before* `dispatchToElement(..., 'mousemove')`. Because of that order, a
    `getZr().on('mousemove')` handler that calls `setCursorStyle("default")` runs last and wins. D6's heatmap mechanism
    therefore works.
  - `BarView.js:709-710` honours a series `cursor` value, so `cursor: "default"` on the histogram bar series works.
  - `ChartPanel.tsx` renders `ReactECharts` directly, so the zr instance is reachable.
  - Task 4.7 now asserts the observed cursor through Playwright.
  - `calculable: false` is stated.
- **CR2 (numeric predicate): resolved.**
  - The capabilities-at-node response (`PipelineNodeReads.buildNodeCapabilities`) carries
    `capabilities.chart.eligibleColumns.yAxis`.
  - It is computed by `OutputBindingSpec.evaluate` with `SlotEligibility.Numeric` (integer/float, `OutputBindingSpec.scala:15-27`).
  - The frontend type `Capability.eligibleColumns` (`types/output.ts:179`) already models it.
  - The stored non-numeric choice and the empty state are now both specified.
- **CR3 (contract prose): resolved.** D8b, task 2.1 (the three `config.description` texts, including binCount) and task 1.4 (the
  `RequestValidation` error string) cover it. I confirmed the stale "`chartType` is bar|line|pie|scatter or null" text in all three schemas.
- **CR4 (vacuous seams): resolved.**
  - The schemas are now walked rather than read from a fixed list.
  - The guards assert exactly 6 schemas. I counted 6 enum-bearing `chartType` properties; `create-panel-request` only
    mentions `chartType` in prose.
  - The guards are labelled, and the mutation that turns them red is recorded.
  - The genuinely red-first tests are named (the route 201 and `buildOutputConfig`).
- **CR6 (yAxis merge): resolved.**
  - D4 cites `buildChartOption.ts:173` correctly: `yAxis` is built from `defaultOption`/`appearanceOption` only.
  - It also states the appearance `type: "value"` and `formatChartNumber` problem, which I confirmed at `chartAppearance.ts` ~173-182.
  - The compact post-pass (around line 300) only spreads `built.yAxis` and does not set an axis type. D4's caution there is accurate.
  - Task 4.6 now asserts on the option `buildChartOption` builds.
- **CR5 (colour-scale tokens): the wording is resolved, but the chosen value does not work in a real browser.** See CR-A.

**Other checks**

- **Enumeration sites.** I re-grepped the tree for `scatter`, excluding archives and tests. Every non-comment hard-coded set is in
  D1's list. The remaining files I checked are scatter-specific display or data code and do not enumerate chart types:
  `ChartDisplayFields`, `OutputKindConfigCard`, `chartClickSelection`, `crossFilterRows`, `PanelInspectView` and
  `chartTypeOptions`. `chartOptions` is free-form in all three Output schemas (`{"type":"object"}`), so a `histogram`
  key needs no schema change.
- **`applyChartOverlay` gating** and the `chartCompareBlocker`/`chartAggregationSpec` scatter checks
  (`chartOverlay.ts:47,69`) match the design.
- **ChartRenderer note slot.** `ChartRenderer.tsx:85-97` renders the HEL-1358 truncation note and already receives
  `rawRows`, `headers`, `fieldMapping`, `chartOptions` and `appearance`. That is enough to compute the skipped count as D5 says.
- **Spec arithmetic.** Sturges gives 8 for n=100. The rule for equal values versus a configured binCount is now stated.
- **Round-1 non-blocking notes.** Axis order, the compare help text with its snapshots, the parameterised note and the 375px
  check are all now addressed.

**CR-A evidence (reproduced two ways)**

1. **The browser returns the unresolved string.** In Playwright Chromium (HeadlessChrome/151) I applied `theme.css`'s
   definition `--app-accent-strong: color-mix(in srgb, var(--app-accent) 78%, white)`. Reading it back with
   `getComputedStyle(documentElement).getPropertyValue("--app-accent-strong")` returned the literal string
   `"color-mix(in srgb, #f97316 78%, white)"`. The custom property is unregistered (no `@property` exists in `frontend/src`).
   That literal is exactly what `resolveChartTheme()` (`chartAppearance.ts:75`) hands to the chart as `tokens.accentStrong`.
2. **zrender cannot parse it.** I ran `node -e` against `frontend/node_modules/zrender/lib/tool/color.js`:
   - `parse("color-mix(in srgb, #f97316 78%, white)")` returned `undefined`;
   - `parse("color(srgb 0.98 0.57 0.28)")` also returned `undefined`;
   - `parse("#fa9249")` returned `[250,146,73,1]`.
3. **The visualMap then paints black.** ECharts `VisualMapping.js:443-450` (`setVisualToOption`) falls back to
   `[0,0,0,1]` (black) for any colour it cannot parse.
4. **Consequence.** As designed, every heatmap cell and the legend gradient would render black at opacity 0.15-1 in both
   themes. In dark theme they are near-invisible. They do not follow the accent.
5. **Why the planned test misses it.** The existing hover emphasis gets away with the same string only because it is
   passed straight to the canvas `strokeStyle`, which Chrome parses. The visualMap path parses the colour itself. Jest uses
   `FALLBACK_CHART_THEME.accentStrong = "#fa9249"`, so task 4.6 would pass while the real chart is black.

### Verdict: REFUTE

Five of the six round-1 items are genuinely resolved, and the claims about current code hold. One load-bearing design
choice (D4's colour source) is broken in the real browser, and the planned tests cannot see that.

### Change Requests

1. **CR-A: D4's `inRange.color: [tokens.accentStrong]` renders black, so a parseable colour source is required.**
   - **Where:** design.md D4, task 3.3 and task 4.6; heatmap-histogram-charts spec "Colour scale in both themes".
   - **Problem:** `--app-accent-strong` reaches ECharts as an unresolved `color-mix(...)` string. zrender's `parse`
     rejects it, and VisualMapping falls back to `#000000` (evidence above).
   - **Fix:** D4 must name a colour source that zrender can parse. Options:
     - **`--app-accent`.** `theme/appearance.ts:621` sets it as a hex value via `setProperty`, and `theme.css` defines it as hex in both themes. It
       still follows the user's accent.
     - **A small resolver.** Resolve the colour through a probe element's computed `color` and convert `color(srgb …)` to `rgb()`.
   - **No new `theme.css` token** may be added without owner sign-off, as D4 already states.
   - **Tests:** task 4.6 must also assert that every `visualMap.inRange.color` entry is parseable by zrender's `parse`.
   - **Coverage:** the running-app check (4.9) must confirm the cells are visibly accent-coloured in both themes, not black. Sampling a
     canvas pixel or comparing against a screenshot would do. Jest's hex fallback cannot catch this class of bug.
   - **While here:** state the low end of the scale (opacity 0.15 or some other value) against the light card surface for a pale preset accent such as
     Yellow. DESIGN.md notes Yellow is the weakest preset.

### Non-blocking notes

- **Unmapped xAxis.** `resolveDataColumns` (`chartClickSelection.ts:33`) defaults an unmapped `xAxis` to column 0, and
  `buildDataOptionCore`'s `xCol === -1` early return never fires. The heatmap branch must check `fieldMapping.xAxis`
  explicitly to meet "any of the three slots unmapped → empty". Make sure task 4.6's "unmapped slot" case includes
  `xAxis`, not only `series`. The histogram's behaviour with no `xAxis` mapped is unspecified, and it would bin column 0.
  State it.
- **binCount plumbing.** `buildChartOption.ts:121` passes only `chartOptions?.scatter` into `buildDataOption`. The
  histogram binCount needs a parameter path there. This is implied by D3/D7 but unstated.
- **Heatmap tooltip.** The appearance tooltip sets `valueFormatter: formatChartNumber`. Check in the running app that a
  heatmap item tooltip shows the column, the row and the formatted value rather than raw axis indices.
- **Low values and accessibility.** With an opacity-only scale on one hue, low values sit close to the surface. The tooltip carries the
  value, which satisfies "colour is never the sole carrier". The legend's min/max labels should stay visible at 375px.
- **chart-type-selector Purpose line.** It still lists "(bar, line, pie, scatter)". Either update it or record why it is left.
