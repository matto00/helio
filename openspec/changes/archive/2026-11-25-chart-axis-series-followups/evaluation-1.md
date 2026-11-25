## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `e75f34f0dacf9b1b624164dc04c73113b69e4014` (commits a4353a30f and e75f34f0d) against the live-resolved
base `60909ebd4c5e756dafe1bb49e109b4cb8ee568d9` (origin/main).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- Item 1 (tick floor): `timeAxisMinInterval` (`frontend/src/utils/chartTimeAxis.ts:69-77`), applied once in
  `buildChartOption.ts:218` after the appearance spread. It covers raw-row and aggregate time charts. Live check: the
  `minInterval` is 86400000, every live tick falls on a day boundary, and the rendered labels are
  `["Sep","2",...,"7"]` at 1440 and 375 px in both themes. No time-of-day label appears.
- Item 2 (owner ruling: sum plus a footnote): both multi-series builders use `sumBySeriesAndKey`. The footnote
  derives its count from the same helper with the same keys (raw x, or the plan's instants), so the count cannot
  disagree with what is plotted. It reuses the HEL-1508 `chart-panel__skipped-note` element.
- Item 3: derived rather than escalated, as the owner ruling allows. The design records the precedent (an
  unreadable x is excluded with a footnote). Non-numeric x is filtered and the footnote counts the excluded rows.
- Item 4: a markPoint on isolated values, placed by category index (or by instant on a time axis).
  `MarkPointComponent` is registered.
- Item 5: the GUARD row in `chartTimePlan.test.ts:224-239` is labelled and goes red under M2 (`mutations-1.txt`).
  The hel1508 e2e positive control (`e2e/hel1508-chart-time-axis-followups.spec.ts:301-316`) reads
  `"2026-09-01 value: 5"` off a real point in all 4 cases (my run).
- Item 6: not split (design D6), with a follow-up triage at Delivery. This is consistent with the owner ruling.
- Changed existing expectation (`buildChartOption.timeAxis.test.ts:55`, `[2,null,null]` -> `[4,null,null]`): I
  checked the fixture. `withBlank` contains two `(Mon, 2, B)` rows (the original `rows[1]` plus the appended one),
  so 4 is the summed value the owner ruled for. The test's own point, that the `Wed n/a` row stays `null`, is still
  asserted. This follows directly from the ruled behaviour change; the fixture was not edited to make the test pass.
- No backend, schema or migration change. The spec delta matches what was implemented.
- `workflow-state.md` CONSTRAINTS is `[]`; there is nothing extra to honour.

### Phase 2: Code Review — PASS
I ran every gate fresh in the worktree after `npm ci` (root and frontend), with nice -n 19 and 3 jest workers:
- `npm run lint` exit 0; `npm run format:check` exit 0; `npm run typecheck` exit 0; `npm run check:tokens` exit 0.
- `npm test` exit 0: root 76/76 suites, 683 tests; frontend 947/947 suites, 11043 tests.
- `npm --prefix frontend run build` exit 0. Only the existing chunk-size advisory is printed.
- e2e on the lane DB with 2 workers: `hel1517-chart-followups.spec.ts` 4/4 and `hel1508-chart-time-axis-followups.spec.ts`
  4/4, 8 passed. The 8 throwaway users were deleted by the registry teardown.

Executor claims checked independently:
- Red run (`red-run-1.txt`): genuine. 16 behaviour failures cover items 1-4: item 1 `minInterval` is undefined,
  item 2 values were last-wins, item 3 x was plotted at 0, item 4 had no markPoint, plus the RTL note tests. The
  two new pure-helper suites fail on missing exports, which is expected. Carrying the red run inside the
  implementation commit is allowed under C12. `.husky/pre-commit` runs under `set -e` and ends with `npm test`, so
  it does refuse a red tree.
- Mutation 3a (restoring only the `x -> 0` fallback) is an equivalent mutation. `toPoint`
  (`chartDataOptions.ts:144-151`) is only applied to `plotted`, which already requires a numeric x, so the fallback
  branch cannot be reached. Mutations 3a' and 3a-full, which restore the filter, go red. I agree with the executor.
- The other mutations in `mutations-1.txt` (1a, 1b, 2a-2e, 3b, 4a-4d, M2) each name a failing test that exercises
  the mutated branch.

Code quality:
- `chartSeriesNotes.ts` imports no echarts (it imports only `chartClickSelection`, which imports types and small
  utils), so the HEL-512 main-bundle boundary holds.
- Naming, comments and DRY are fine. The isolated-point logic reuses `pointY`.
- No `any`, no dead code, no TODO.

### Phase 3: UI Review — PASS
Servers were started with `start-servers.sh` on the lane DB (helio_hel1517, ports 6949/9856), checked with
`assert-phase.sh servers` (PASS), and stopped with `stop-servers.sh` afterwards. I did not use the shared MCP
browser. All checks ran in Playwright against the running app.

- Item 1, daily time axis: 1440 and 375 px, light and dark, two cards each (my scratch run plus the committed
  spec). The live axis labels are day labels only and the ticks fall on day boundaries.
- Item 2, summed footnote: visible. 375 px light:
  `/home/matt/Development/helio/.concertino/runs/HEL-1517/evidence/e2e-evidence/HEL-1517/sum-light-375.png`.
- Item 4, isolated marker in its line's colour:
  - The live zrender symbol at each marker's pixel has stroke `#5470c6`, the same as the line's own colour, in
    every theme and width.
  - Screenshots, which show ringed markers on the line's blue in both themes:
    - `/home/matt/Development/helio/.concertino/runs/HEL-1517/evidence/e2e-evidence/HEL-1517/marks-light-1440.png`
    - `/home/matt/Development/helio/.concertino/runs/HEL-1517/evidence/e2e-evidence/HEL-1517/marks-dark-1440.png`
    - `/home/matt/Development/helio/.concertino/runs/HEL-1517/evidence/e2e-evidence/HEL-1517/marks-dark-375.png`
  - The fill is `#fff` (ECharts' `emptyCircle`). In dark theme that is a light dot with a blue ring, still clearly
    visible.
- Two-note chart at 375 px (the executor's open item), recorded by me:
  - Data: a multi-series timestamp line with one null-date row and two rows sharing (09-01, A).
  - The footnote reads "1 row with no readable date not shown. 2 rows with the same time and series were added
    together."
  - At 375 px it wraps to two visible lines in both themes and is not clipped (`scrollHeight <= clientHeight`).
    `title` holds the full text. At 1440 it fits on one line.
  - Screenshots: `/home/matt/Development/helio/.concertino/scratch/HEL-1517/eval1-uicheck/shots/two-{light,dark}-{1440,375}.png`.
    They sit in the main checkout's scratch directory, outside the worktree.
- Console: no chart-related errors. The only errors were from the harness before login: a 401, a `localStorage`
  SecurityError from the init script on about:blank, and `ERR_CONNECTION_REFUSED` for a resource outside this
  change.
- Accessibility: there are no new interactive elements. The markPoint is `silent`, and the footnote is the
  existing `<p>` with its `title`.
- Breakpoints: I checked 1440 and 375 directly. 1100 and 768 were not exercised separately. The change adds no
  layout, only canvas content and text inside an existing element, so I judged the risk low (stated, not measured).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- tasks.md 1.4 says the isolated-point tests cover "single, multi, time", but no multi-series case exists in
  `buildChartOption.chartFollowups.test.ts`; every item-4 case is single-series. The code is per-series and generic,
  so this is a coverage gap rather than a defect. Either add one multi-series case with markers off (for example,
  series B present only at one category between A-only categories) or correct the task wording.
- Footnote wording ("x value", "time"): the plain-language principle in DESIGN.md §5 is a **[judgment]** rule, so I
  defer it to the skeptic. It reads clearly in the running app.
- On a dark card the marker's `#fff` fill reads as a light dot. That is consistent with ECharts' default
  emptyCircle elsewhere in the app, and is the skeptic's visual call.
