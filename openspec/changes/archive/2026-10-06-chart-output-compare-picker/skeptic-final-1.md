## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `d257a56dbfab06c7575f1c6f84f6e8f867f32237`. Base resolved live via `resolve-review-base.sh` (exit 0): `9415a44eca125f5bee25bdd4878911d39b6ecc37`. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/chart-output-compare-picker/HEL-1350`.

### What I verified (with evidence)

**AC tracing (ticket.md, as amended by owner ruling `show-with-inline-note` and constraint C1)**
- **Picker on every chart Output, never hidden.** `OutputKindFields.tsx` renders `<ChartCompareField>` unconditionally at the end of `ChartKindFields`. RTL `it.each(["line","bar","pie","scatter"])` asserts the combobox. I saw it live on line, bar (aggregated) and bar (horizontal) Outputs in both themes.
- **Fixed help text listing every case.** `ChartCompareField.tsx` `CHART_COMPARE_HELP` names pie, scatter, multi-series, horizontal, 100% stacked, aggregated, more than 200 rows and filter. It is linked via `aria-describedby`; the live DOM gave `aria-describedby="output-chart-compare-help output-chart-compare-note"`.
- **Output-level note only from the Output's own config.** `chartCompareBlocker` (`chartOverlay.ts`) never reads `config.chartType`. The only chartType dependence is `compareBlockerInput` clearing `aggregation` for a scatter Output. That is correct: the server's grouping decision keys on the Output's chartType, not the panel's. The note renders only when compare is not None.
- **Unmapped blocker is honest.** `selectChartOverlay` reads the Output config's `fieldMapping.xAxis/yAxis` (`ChartOutputPanel.tsx:61` passes the Output `config`), so the note's predicate matches the runtime gate.
- **No new "previous" copy.** `CHART_COMPARE_OPTIONS` filters out `previous_run`. A stored `previous_run` is displayed with the pre-existing metric label "Previous". That shows a stored value; it adds no new copy. The help and note strings contain no "previous". The e2e asserts no "Previous" option and no /previous/i on the panel card.
- **Server validation reused.** The diff has no backend changes.
- **RTL + e2e.** `OutputEditorSheet.compare.test.tsx`, `chartOverlay.test.ts`, and `e2e/hel1350-chart-compare-picker.spec.ts`. The e2e covers editor picker → PATCH body `compare:"7d"` → client-side navigation (sentinel + document-request no-reload proof) → "vs 7d" via tooltip on the canvas, in both themes.
- **Round-trip safety.** `compare` state initialises from `readMetricConfig(config).compare`, which reads `config.compare` for any kind (`outputConfigTypes.ts:271`). So an API-set value round-trips; RTL "untouched stored compare round-trips unchanged" covers this. A None choice writes an explicit `null`.

**Gates (run fresh by me, `nice -n 19`)**
- `npx jest --maxWorkers=2 --testPathPatterns='outputEditor|chartOverlay|ChartOutputPanel'`: 8 suites, 139 tests passed.
- `npm run typecheck`: exit 0.
- `npm run lint` (`eslint . --max-warnings=0`): no output, clean.
- `DEV_PORT=6782 npx playwright test e2e/hel1350-chart-compare-picker.spec.ts --workers=2`: **2 passed (30.3s)**, light and dark.
- I did not re-run the full Jest suite or the build myself. The evaluator's pasted results (455 suites / 4775 tests, build 0) are specific and unambiguous, and my targeted run covers every changed module.
- The red-first proof for the scatter tests is recorded by the evaluator (red against 6a20d9fd6, mutation at HEAD). I reviewed the test bodies: each asserts on the note element's text and would fail if the blocker logic changed.

**UI / design judgment (running app, own headless context, servers via `start-servers.sh` 6782/9689, `assert-phase.sh servers` → `PASS servers`)**
- **Placement and structure.** The chart Compare section reuses `output-editor-sheet__data-section` / `__data-label` and the shared `Select`. It is visually identical to the metric editor's Compare section: same label weight, full-width select and spacing (compare `metric-*.png` with `agg-note-*.png`). It sits at the end of the chart configuration card, after Display.
- **Tokens.** No new CSS. The help text uses `__field-hint` (`--text-xs`, `--app-text-muted`; computed 12px; rgb(100,94,86) light / rgb(170,164,156) dark). The note uses `__type-hint` (`--text-sm`, muted; 14px), the same class as the existing sibling "Aggregation isn't available for scatter" hint in `OutputKindFields.tsx:106`. The note reads with a little more weight than the generic help, which fits an Output-specific fact.
- **Light/dark parity.** Both themes render with correct contrast and no hardcoded colours. On the dashboard panel, the "vs 7d" overlay is a dashed muted series with a legend entry in both themes, distinct from the primary series.
- **Console.** Only the pre-login `/api/auth/me` 401s and the existing `/schedule` 404s (no schedule set). Nothing comes from this change.

Evidence (persisted at capture):
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.skeptic-shots/agg-note-light.png, agg-note-dark.png (aggregated note)
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.skeptic-shots/horiz-prevrun-light.png, horiz-prevrun-dark.png (stored previous_run kept and displayed; horizontal note)
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.skeptic-shots/metric-light.png, metric-dark.png (sibling metric Compare, for consistency)
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/openspec/changes/chart-output-compare-picker/screenshots/{editor-compare-picker,chart-overlay-panel}-{light,dark}.png (regenerated by my fresh e2e run)

No claim in this report rests on mtime or directory ordering.

**Housekeeping**
- Dev-DB users I created (2 by the e2e run, 2 by my scratch spec): 4a4ad6fa-c77a-4e94-b02e-72bbf1932b20, f1a9c2ae-78a2-4776-9631-51a7f986e5c7, 6ba23b28-f2e3-4455-afa4-ad4b32d06bde, 2db4fe05-2d74-4e3f-a608-b94a84cd195a. All 4 deleted by exact id, along with their 2 `pipeline_run_rate_window` rows. Post-check count is 0.
- Sources and pipelines were deleted via the API in each spec's cleanup. matt@helio.dev was not touched.
- Servers were stopped by recorded PID (npm 140740, vite 140762, sbt 140189/140239, java 140483), and both ports are free.
- The scratch spec and shots dir were removed.

### Verdict: CONFIRM

### Non-blocking notes
- `OutputKindFields.tsx` imports `METRIC_COMPARE_OPTIONS` only to re-export it, and nothing consumes that re-export. Drop it.
- The RTL test "shows no note for a clean raw-rows line config or a pie chartType alone" renders only the pie case. Rename it.
- `compare` state is still initialised from `metricConfig.compare` (`OutputEditorSheet.tsx:251`). That is behaviourally correct because the reader is kind-agnostic, but the name misleads; reading `config.compare` directly would be clearer.
- The 200-row figure in the help copy duplicates `usePanelSortFilter`'s page size. The design accepts this drift risk.
