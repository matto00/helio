## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: revised `design.md` (D1/D5/D6/D9 + Risks), `tasks.md`, both spec deltas, `proposal.md`, `ticket.md`, and
`skeptic-design-1.md`. Worktree HEAD is b3a7efc9639386784c888347770800189662a380 (= origin/main after a fresh fetch).
The change dir is still untracked. HEL-1307 has not merged to origin/main. Owner rulings 1-7 were not reopened.

### What I verified (with evidence)

**Round-1 CR1 (dataMin/dataMax): ADDRESSED and probe-confirmed.** I re-ran an SSR probe against the worktree's
`frontend/node_modules/echarts` 6.1.0. The carrier is exactly as D5 specifies: `type: "line"`, `data: []`,
`silent`, `tooltip.show: false`, `emphasis.disabled`, with silent markLine/markArea. It is appended after a "vs"
overlay series, and the axis gets `dataMin`/`dataMax`. I ran it twice and got identical output (sha256 of the output
`a6ceadb4…17cb7`; script `probe2.cjs` sha256 `3951a12f…06427`).
```
bar baseline                             yAxis [0,40]   bar0 103.5   lineLabels 0 legend ["amount"]
bar+overlay+carrier in-range 20          yAxis [0,40]   bar0 103.5   lineLabels 1 legend ["amount","vs prev"]
bar+overlay+carrier above 95 band 0-50   yAxis [0,100]  bar0 103.5   lineLabels 1 bandLabels 1
bar neg data, mark -50                   yAxis [-60,40]
horizontal bar carrier 95                xAxis [0,100]  bar thickness 58.6 (= baseline 58.6)
histogram gap0 carrier 95 / baseline     yAxis [0,100] / [0,40]  bar0 width 150.0 / 150.0
scatter carrier 95                       yAxis [0,100]  lineLabels 1 bandLabels 1
stacked bar carrier / baseline           yAxis [0,100] / [0,80]
no legend.data, carrier                  legend ["amount"]  (unnamed carrier adds no entry)
```
- A mark inside the data range leaves the extent unchanged.
- A mark above the data widens the extent with zero kept.
- Bar and histogram width is unchanged.
- Marks render on an empty-data line carrier.
- No legend entry appears.

**Round-1 CR2(a)-(c) (carrier type, overlay, tooltip): ADDRESSED.**
- `buildChartOption.ts` order on main is: `applyChartTypeOptions` → heatmap theme → `applyChartOverlay` → pie labels
  → `applyAxisTriggerTooltip` → `applyHoverEmphasis` → legend/compact.
- D5's placement (after emphasis, before compact) means the overlay's `length !== 1` check
  (`chartOverlayOption.ts:45`) and the tooltip's `length <= 1` check (`chartAppearance.ts:240`) both see today's
  series. The compact block reads only `overlayApplied`/legend.
- Appending at the end keeps every data seriesIndex stable. I grepped for any other consumer that counts series and
  found none.
- The fallback trigger list now names all five checks.

**Round-1 CR2(d) (hover emphasis must not blur the marks): NOT ACHIEVED by the specified mechanism.**
- D5 relies on `emphasis: {disabled: true}` on the carrier. Task 5.3 tests "carrier excluded from emphasis", which
  is a check on the option shape.
- ECharts source shows why that is not enough. In `lib/util/states.js` `blurSeries`, hovering a series with
  `focus: "series"` blurs every OTHER series in the same coordinate system. It then calls
  `view.toggleBlurSeries(blurredSeries, true)`. `MarkerView.toggleBlurSeries` (`component/marker/MarkerView.js:80-92`)
  puts each blurred series' marker elements into the blur state. The carrier's own `emphasis.disabled` is never
  consulted in that path.
- Browser probe: canvas renderer, real `mousemove` dispatched on a bar of a bar + line("vs") + D5-carrier chart.
  I served it from the scratchpad over a local `http.server`, because Playwright blocks `file:`. I ran it twice with
  identical results:
  ```
  D5 carrier          before: polygon op=0.12, ec-line op=1   after hover: polygon:blur op=0.012, ec-line:blur op=0.1
  + markLine.blur {lineStyle.opacity:1,label.opacity:1}, markArea.blur {itemStyle.opacity:0.12,label.opacity:1}
                      before: same                            after hover: polygon:blur op=0.12,  ec-line:blur op=1
  ```
  The control ("vs" series) went to `blur` in both runs, which proves the hover actually fired.
- So, as designed, hovering any bar fades the target line to 10% and the band to 1.2% opacity. That violates the
  spec's "Reference marks are always visible" and leaves round-1 CR2(d) unmet.
- A marker-level `blur` style override keeps both at full strength. The D5 fallback (marks on series[0]) does not
  help: hovering the overlay or another series would still blur series[0]'s markers.
- An SSR `dispatchAction('highlight')` probe could not detect blur at all (its control did not blur either). This
  needs the browser-level check, and an option-shape unit test cannot catch it.

**Round-1 CR3 (seam test): ADDRESSED, with one unsatisfiable clause.**
- The fixture has moved to `shared-test-fixtures/` (the directory exists, with 7 sibling fixtures).
- `editorState` → `buildOutputConfig`/`configPatch` `toEqual` follows the `layoutCreateSeam.test.ts` pattern (the
  file exists).
- `schemaRejects` and `serverOnly` are now separate groups.
- The message fragments are red on main. `OutputConfigValidation.scala:61` returns the generic `Unknown config key…`
  for every new-key case. For the kind-mismatch case, the `(not a metric config key)` fragment (`:78`) appears only
  once `referenceLines` is in `KnownKeys(Chart)`, so that case is red on main too.
- The unsatisfiable clause: D9 says "every `schemaRejects`/`serverOnly` item is dropped by `sanitizeReferenceMarks`".
  That cannot hold literally for three cases:
  - "6 lines" and "4 bands": D7 says the sanitizer applies caps, i.e. it keeps the first 5 or 3 items rather than
    dropping them.
  - "Non-array": there is no item to drop.
  - "Metric kind + `referenceLines`": the item itself is valid, and the sanitizer is kind-blind.
- This wording came from my own round-1 CR3(d). See CR 2.

**Round-1 CR4 (label rule): ADDRESSED.** One rule is used across D1, D8 and the output-routes-api delta:
- Raw length is 1-60, with at least one non-whitespace character.
- The server stores the label as sent.
- The schema adds `pattern "\\S"` (task 2.1).
- The editor trims before emitting, omits an empty label, and blocks a non-finite value.

Minor: D3's prose still lists only `minLength`/`maxLength`. D1 and task 2.1 carry the pattern.

**Round-1 CR5 (canonical known-key requirement): ADDRESSED.** The Risks bullet and task 5.6 plan a MODIFIED delta at
the pre-PR re-sync, copied from post-1307 text if 1307 has merged, otherwise from main with a PR-body note. HEL-1307
is still unmerged on origin/main, so the conditional is real.

**Round-1 CR6 (distinguishable from the "vs" overlay): ADDRESSED.**
- The reference line is solid 1.5px. The line overlay is dashed 2px (`chartOverlayOption.ts:71`), and the bar
  overlay is a bar series (`:75`).
- The spec scenario requires them to be distinct, and task 5.5 screenshots that case.

**Round-1 CR7 (guard mechanism): ADDRESSED.** The fixture `limits` is the shared truth. The Scala spec and the Jest
test each assert against it. The Jest test walks the three schemas and asserts exactly 3 are found.

**D6:** this is now a statement and task 3.5 is test-only. That matches round-1 finding 5.

### Verdict: REFUTE

Category: spec-divergence. The design states a mechanism (`emphasis.disabled` on the carrier) that a reproduced
browser probe shows does not stop hover-blur of the marks. The spec's "always visible" requirement would then be
violated on every multi-series or overlay chart, and the planned unit test would pass anyway. Both fixes below are
narrow artifact edits.

### Change Requests

1. **D5 + task 5.3/5.5: stop the marks fading when another series is hovered.**
   - **Mechanism.** Add marker-level blur styles that equal the normal styles:
     - `markLine.blur: {lineStyle: {opacity: 1}, label: {opacity: 1}}`
     - `markArea.blur: {itemStyle: {opacity: <band opacity>}, label: {opacity: 1}}`
     
     The probe above shows this holds the line at op=1 and the band at 0.12 while the "vs" series blurs.
   - **Fix the false claims.** Correct D5's carrier bullet and the "carrier excluded from emphasis" claim:
     `emphasis.disabled` stops the carrier's own emphasis, but not the blur another series' `focus: "series"`
     applies to it (`states.js` blurSeries → `MarkerView.toggleBlurSeries`). Also drop "emphasis" from the series[0]
     fallback rationale, since series[0]'s markers are blurred the same way.
   - **Tests.** In 5.3, assert that the blur styles are present. In 5.4 or 5.5, add a running-app check that blur is
     not engaged: hover a bar on a chart with the "vs" overlay and a reference line, then read the markLine element's
     style opacity (or take a before/after screenshot). This is the only level at which this defect is observable (C4).

2. **D9: make the sanitizer clause satisfiable.** Replace "every `schemaRejects`/`serverOnly` item is dropped by
   `sanitizeReferenceMarks`" with case-specific assertions:
   - Item-level cases (string value, `red` tone, 61-char label, extra item key, `from >= to`, whitespace-only label)
     are dropped.
   - Over-cap cases are truncated to `limits.maxLines`/`maxBands`.
   - A non-array reads as none.
   - The kind-mismatch case is excluded, because it is a server kind check and not a malformed item.
   
   Optionally move "whitespace-only label" to `schemaRejects`, since the schema now rejects it via `pattern "\\S"`.

### Non-blocking notes

- D3 prose: add `pattern "\\S"` to the label constraint list so it matches D1 and task 2.1.
- Probe scripts and outputs are in the session scratchpad (`probe2.cjs`, `blur.html`). The results above are quoted
  verbatim, with their checksums. No load-bearing evidence depends on mtimes.
- No `files-modified.md` or evaluation exists yet (design gate), so there is no gate-defect finding.
