## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `481999e231fea5c6ba2ca4768ba004ccb01297cf`. Base `2c49bdba8ffe0df5df65b2c951c0b9bb73173c2b`, resolved live with `resolve-review-base.sh`.

### Phase 1: Spec Review — FAIL

Issues:
- **The exit criterion is not met at default size (executor item 1).** HEL-918's exit criterion asks for "1,204 ▲ 12% vs 7d" with a sparkline "with zero configuration beyond choosing compare". The sparkline does not appear on a metric panel placed with its default size:
  - The backend gives a new metric Output panel `OutputPanelDefaultSize` Metric = `w=3, h=2` (`backend/src/main/scala/com/helio/services/panels/PanelPacker.scala:144`, applied by `PanelService.defaultSizesFor`).
  - At `rowHeight` 52 and margin 18, that card is 122px tall. This is inside the compact container query (`max-height: 179px`), which now sets `display: none` on `.panel-content__metric-sparkline` (`frontend/src/features/panels/ui/PanelContent.css:298-301`).
  - Measured live on this lane's servers (6707/9614) with a panel created by plain `POST /api/panels` (no layout call): at both 1440 and 1100 the grid item is 122px tall and the sparkline's computed `display` is `none`. The delta "▲ 12% vs 7d" and "1,204" do render.
  - At 768 and 375 (the mobile stack) the sparkline is visible.
  - The e2e only passes because it calls `/auto-layout` with `h: 5` (`e2e/hel1275-metric-delta-sparkline.spec.ts`, the "Tall enough that the sparkline is not hidden" block). That is extra configuration beyond choosing compare, so the Playwright proof does not prove the exit criterion as written.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1275/evidence/openspec/changes/metric-delta-sparkline-ui/screenshots/eval-1-default-size-dark.png` and `.../eval-1-default-size-light.png`.
- Every other AC is addressed:
  - RTL tests cover ▲/▼/flat, the available-from note and the delta hidden under a filter.
  - The light and dark visual check against the running app was done.
  - Tasks 1.1–4.6 are all checked and match the diff.
- **CONSTRAINTS:**
  - C1 is honoured: no changes to `ci.yml` or `playwright.config.ts`, and no migration.
  - C2 is honoured: `page.goto("about:blank")` runs before seeding, and the backdate is selected by the test's own `output_id`, with ids recorded and a row-count assertion.
  - C4 is honoured: grep finds no "previous run" in UI copy (only in comments), and the e2e asserts its absence.
  - C5 is honoured: compare is chosen through the editor UI.
  - C3 is honoured in my own runs.
- No scope creep beyond the OutputEditorSheet fix (item 2 below). That fix is justified because the C5 flow (open an aggregated metric, choose compare, save) would otherwise wipe the aggregation.

### Phase 2: Code Review — PASS (gates green; findings are in Phase 1)

Gates, run fresh by me in `WORKTREE_PATH` under `nice -n 19`:
- `npm run lint` exit 0
- `npm run format:check` exit 0
- `npm run typecheck` exit 0
- `npm --prefix frontend run build` exit 0 (only the existing chunk-size warning)
- `npm test` exit 0:
  - 434 suites / 4518 tests passed
  - plus a second project with 38 suites / 371 tests passed
- `nice -n 19 npx playwright test e2e/hel1275-metric-delta-sparkline.spec.ts --workers=2` (DEV_PORT=6707): 2/2 passed, light and dark.
- No backend files changed, so no `sbt` run.
- No FirstRunRoutesSpec timeout, no "Java heap space", and none of the HEL-1294/HEL-1298 flakes seen (those specs were not in scope of this run).

The executor raised three items; each judged below:
- **Item 2, the OutputEditorSheet `metricField` init (`OutputEditorSheet.tsx:233-237`): verified correct.**
  - On main (`2c49bdba:OutputEditorSheet.tsx:233`) `metricField` was `fieldMapping.value ?? ""`.
  - For an aggregated metric (`fieldMapping: {}`, `aggregation: {value, agg}`) this gave `""`, so `buildOutputConfig` (`buildOutputConfig.ts:103-106`, `metricField && isAggFn(...)`) emitted `aggregation: null`. In other words, open-and-save silently dropped the aggregation.
  - The new `fieldMapping.value ?? aggregation.value` fixes this.
  - `OutputEditorSheet.compare.test.tsx`, test "saving an aggregated metric keeps its aggregation", asserts `aggregation` equals `{value:"amount",agg:"sum"}` on an aggregated metric. That test would be red against main's init.
- **Item 3, the loaded-rows fallback showing "--" for aggregated metrics: confirmed it already existed on main.**
  - `2c49bdba:frontend/src/features/panels/ui/PanelContent.tsx:298-307` has the identical `Object.values(cfg.fieldMapping)[0]` logic.
  - The diff moves it verbatim into `MetricOutputPanel.tsx:52-62` (still fed `filteredRawRows`).
  - Not a regression. It is a candidate follow-up.
- Code quality:
  - The history cache mirrors `provenanceCache`, with a generation guard and one retry.
  - The identity guard is a faithful port of the server's selection rule and is unit-tested.
  - `PanelContent.tsx` shrank by moving the metric branch into `MetricOutputPanel.tsx`.
  - No `any`, no dead code, no inline FQNs.
- DESIGN.md mechanical rules:
  - Colours use tokens (`--app-accent` stroke, existing trend modifiers, `--app-text-muted`).
  - `font-size` uses `--text-micro`; spacing uses `--space-*`.
  - The literal `stroke-width: 1.5` is documented in-line (no token exists).
  - The `letter-spacing: 0.02em` literal matches its siblings at `PanelContent.css:241/261`.
  - The delta has `role="img"` with an `aria-label`. The sparkline has `role="img"` with an `aria-label`. The filtered marker is focusable, with `title` and `aria-describedby`.

### Phase 3: UI Review — FAIL

All live checks ran on this lane's servers with my own seeded user and data, each seeded item recorded by id. They were deleted afterwards by exact id: dashboard f7c99802…, pipeline 39cf02b2…, source 1f6c8ce4…. Backdated history row a75f2b05… (selected by output 86e17a68…).

- **Happy path:**
  - The authenticated card shows "1,204" and "▲ 12% vs 7d" (aria-label "up 12% versus 7 days earlier").
  - The provenance popover shows "COMPARED WITH 7 days ago · 1,075" (`.../eval-1-provenance-light.png`).
- **Public path:**
  - The panel fetches `GET /api/dashboards/:d/panels/:p/history?token=…` → 200.
  - It renders the delta and the sparkline (`.../eval-1-public-light.png`).
- **Breakpoints:** no horizontal overflow at 1440, 1100, 768 or 375 (`.../eval-1-768-light.png`, `.../eval-1-375-light.png`). At 1440 and 1100 the default-size card hides the sparkline; see the Phase 1 finding.
- **Console:** no errors or warnings during the tested flows.
- **Light and dark:** the delta colours read correctly in both themes (`rgb(22,109,67)` in light).
- **Larger card:** at `h=5` the executor's screenshots show a balanced layout (`.../metric-delta-sparkline-{light,dark}.png`, persisted).

Screenshots, all persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1275/evidence/openspec/changes/metric-delta-sparkline-ui/screenshots/`:
- eval-1-default-size-dark.png
- eval-1-default-size-light.png
- eval-1-provenance-light.png
- eval-1-public-light.png
- eval-1-768-light.png
- eval-1-375-light.png
- metric-delta-sparkline-light.png
- metric-delta-sparkline-dark.png

### Overall: FAIL

### Change Requests
1. **Make the sparkline visible on a default-size placed metric panel**, i.e. 3x2 grid, a 122px grid item at lg and md.
   - Change `frontend/src/features/panels/ui/PanelContent.css:298-301`: inside `@container panel-card (max-height: 179px)`, do not `display: none` the sparkline.
   - Instead render a reduced variant. For example: a smaller height via an existing `--space-*` token (e.g. `--space-4`) with `margin-top: 0`. Or lay the sparkline inline beside the trend in a row (e.g. a flex row in `MetricRenderer` wrapping the trend and the sparkline).
   - Requirement: "1,204", "▲ 12% vs 7d" and a visible sparkline all fit in a 122px card without clipping the footer.
   - If some even smaller container height genuinely cannot fit it, scope the hiding to that smaller threshold, not to the default metric size.
2. **Make the e2e prove the exit criterion at zero configuration.**
   - In `e2e/hel1275-metric-delta-sparkline.spec.ts`, delete the `/auto-layout` `h: 5` call so the panel keeps the default placement `POST /api/panels` gives it.
   - Keep the `toBeVisible()` assertion on the sparkline `img` (it must fail if the sparkline is `display: none`).
   - Re-take the light and dark screenshots at that default size.
   - Mutation check: with CR1's CSS reverted, this assertion must go red.

### Non-blocking Suggestions
- Test gap: `PanelContent.metricHistory.test.tsx`, "without an applied filter (empty control value builds no ops)", only passes `viewerFilterActive={false}`. It never exercises `buildViewerControlFilterOps` with an empty value. A small test at the PanelCard/overlay level, or on `buildViewerControlFilterOps(controls, {x: ""})`, would cover the spec scenario directly.
- The e2e cleans up the dashboard, pipeline and source, but leaves its registered user, which adds to dev-DB residue.
- The filtered marker's visible text is "Comparison hidden"; the spec's sentence is in the tooltip and description. That meets the spec; wording is the skeptic's call.
- On the public page the sparkline stroke resolves to a different `--app-accent` hue (amber) than on the authenticated dashboard. This is likely the dashboard-accent scope and token-correct; noted for the skeptic's visual check.
- Follow-up candidate: the loaded-rows fallback shows "--" for aggregated metrics when there is no history. This already existed on main (`2c49bdba` `PanelContent.tsx:298`).
