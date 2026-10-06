## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c6ccfe618b981423459e05334635752e8ee43ae7`. The review base was resolved live with `resolve-review-base.sh`: `3962e6eb2c09a009259c8f75f2cf1aa4c1fe3526`. The diff is 74 files, +3535/−79.
Evidence lives under `/home/matt/Development/helio/.concertino/runs/HEL-1277/evidence/` (abbreviated `EV/` below).

### Phase 1: Spec Review — PASS

- **AC1 (scrubbing shows each point's summary, and its rows when a payload exists).** Met. I checked this on the running app in both themes: the newest point was summary-only, the next point showed payload rows with the diff, and the oldest point showed rows with no comparison.
- **AC2 (the overlay series is labelled).** Met. The legend and axis tooltip read "vs previous" for `previous_run` and "vs Oct 6, 01:38 PM" for a custom compare. This held on the authenticated dashboard, in the History view, and on the share-token public viewer.
- **AC3 (light and dark checks).** Done in both themes. See Phase 3.
- **Driver constraints:**
  - A missing payload never renders as removed rows. A summary-only selected point gives no highlight and no count. A missing comparison payload gives no highlight and no count. A payload that is still loading or failed to load gives no highlight and no count.
  - No copy says "previous run". Grep of the new UI code: 0 hits. The e2e test asserts it. Observed UI copy matched.
  - The public route stays summary-only. Public points carry only `{capturedAt,rowCount,summary}`. The new `series` on resolved points is the same stored `summary.series` that public points already carry. In the browser, the public viewer requested only `/panels`, `/output-meta`, `/rows` and `/history`, never a payload route. Anonymous `GET /api/outputs/:id/history/:point/rows` returned 401, and the public-tree payload path also returned 401.
  - No migration. `playwright.config.ts`, `ci.yml` and `.gitignore` are untouched.
- **Constraints C1–C4 are honoured:**
  - C1: History is opened per Output from the Outputs-tab card. `RunHistoryModal` only switches to the shared trigger-label helper.
  - C2: The diff is a whole-row multiset diff. It highlights rows plus a "no longer present" count, has no cell-level highlight, and only runs when both payloads are present.
  - C3: The comparison is the next-older retained point, labelled by its capture time.
  - C4: The dashboard overlay is summary-only and hidden under a filter (unit-tested). The changed-rows highlight appears only in the History view.
- **Tasks:** 1.1–5.3 are ticked and match the code. 5.4 (the PR body) is for a later phase.
- **Scope:** The changes outside the ticket's Touches list (`PublicDashboardViewerPage`, `usePublicPanelData`, `DataGrid`, schemas, helio-mcp) are each justified in design.md (D9, D7, D10, D11). I found no unrelated scope creep.
- **Contract:** Both JSON Schemas add `series` as required, keeping `additionalProperties:false`. The schema-seam route specs validate it. The MCP mirror is updated.

Issues: none blocking. One behaviour deviates from design D6; it is listed under Phase 2 / CR3 because it is a small UI defect.

### Phase 2: Code Review — FAIL

**Gates I ran myself in `WORKTREE_PATH`, at HEAD:**

| Gate | Result |
|---|---|
| `check:repo-integrity` | PASS |
| `lint` | PASS |
| `typecheck` | PASS |
| `check:e2e-types` | PASS |
| `format:check` | PASS |
| `check:schemas` | PASS |
| `check:spec-structure` | PASS |
| `check:openspec` + selftest | PASS |
| `check:dependabot` + selftest | PASS |
| `check:cloud-run-cpu` + selftest | PASS |
| `check:scala-quality` | PASS |
| `check:test-temp-dir-hygiene` + selftest | PASS |
| `check:no-credential-leak` + selftest | PASS |
| `check:tokens` + selftest | PASS |
| `check:helio-mcp-types` | **FAIL**, environmental (see below) |
| root jest (`--maxWorkers=2`) | PASS: 39 suites, 376 tests, including `outputsHandlers.test.ts` |
| frontend jest (`--maxWorkers=2`) | PASS: 447 suites, 4679 tests |
| `npm --prefix frontend run build` | PASS |
| `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` | PASS: 6042 tests, 432 suites, 0 failed, 0 aborted |
| `sbt --client shutdown` | Run as its own call |
| `e2e/hel1277-output-history-scrubber.spec.ts` | PASS: 4/4 (`DEV_PORT=6709`, `--workers=2`, `nice -n 19`) |

Notes on the gates:

- **`check:helio-mcp-types` failure is environmental, not caused by this diff.** The full log is at `EV/.eval-hel1277/hook-check-helio-mcp-types.log`.
  - The error is `src/index.ts(58,52): error TS2554: Expected 0-2 arguments, but got 3.`, and it is the only error.
  - `helio-mcp/node_modules/@modelcontextprotocol/sdk` is version 1.29.0, while `package.json` requires `^1.31.0`.
  - The SDK bump (a02f3720e, HEL-1348) is an ancestor of HEAD.
  - `index.ts` is not in the diff. The four helio-mcp files the diff does touch compile clean.
  - The executor's claim is confirmed. The `git commit -n` bypass must still be called out in the PR body. The fix is a `helio-mcp` reinstall, not a code change.
- **Backend suite:** the three new route tests ran (they are in the log). There was no FirstRunRoutesSpec timeout and no "Java heap space".
- **e2e log lost.** Playwright cleans `test-results/` at start, and my gate logs were in that directory, so the e2e stdout log is gone. The pass is still evidenced by exit 0 and `test-results/.last-run.json` = `{"status":"passed","failedTests":[]}`. The jest, sbt and hook results above were read before the wipe.
- **Executor screenshots were overwritten.** The spec writes its screenshots into the change dir unconditionally, so my re-run replaced the executor's four `screenshots/*.png` with fresh copies from the same commit. My backup copy was lost in the same wipe.

**Review:** The code is generally clean and modular:

- New files are small, and logic is in pure helpers (`diffRows`, `selectChartOverlay`, `selectPointOverlay`, `applyChartOverlay`, `triggerSourceLabel`) with meaningful tests.
- There are no untyped escape hatches, and no FQN or comment-standard problems.
- The diff keys rows by object identity, and this survives sorting (unit test and e2e).
- `rowsTruncated` fails closed when unknown.
- Public payloads are never fetched.

Issues:

1. **DESIGN.md §3 touch floor [mechanical]: the scrubber range input has a 16px hit target on touch devices.** `frontend/src/features/pipelines/ui/outputHistory/OutputHistoryModal.css:16-20` gives `.output-history__range` no touch-gated height.
   - Measured at 375×812 with a coarse pointer (`(pointer: coarse)` = true): bounding box 211×16, `elementFromPoint` hit height 16.5px against the 44px floor (`EV/.eval-hel1277/touch-375-coarse.json`).
   - The range input is the view's only keyboard/AT control, and on touch it is its primary scrub control.
   - Repo precedent: `PanelDetailModal.mobile.css:189` gives `input[type="range"]` `min-height: 44px` under the touch gate.
   - The Older/Newer IconButtons pass (44.5×44.5 hit area).
2. **DESIGN.md §3 control metrics, "No other control heights" [mechanical].** `frontend/src/features/pipelines/ui/OutputGalleryCard.css:44-58`: `.output-gallery-card__history` is a painted, labelled button with no control-height token. It renders 79×23 at 1440px (both themes) and at 375px. Its `tap-expand-44` hit expander is correct (hit height 44.5), but the painted height must be a sanctioned control height.
3. **Design D6 / spec divergence: a failed comparison-payload fetch is reported as "rows weren't stored".** `frontend/src/features/pipelines/ui/outputHistory/HistoryRows.tsx:87-91`: when `comparisonRows.status === "error"`, the code falls through to the `else` branch and shows the muted note "Row comparison unavailable — rows weren't stored for one of these runs."
   - I reproduced it on the running app by returning 500 for only the comparison point's `/rows` (both themes; text recorded in `EV/.eval-hel1277/ui-report-dark.json` `comparisonPayloadFail`).
   - The rows were stored, so the copy states a false cause.
   - D6 says "A failed payload fetch shows intent-error text in the rows section and disables the diff for that pair".
   - The diff is correctly disabled; only the copy and its intent are wrong.
   - No test covers a comparison-only failure. The existing test at `OutputHistoryModal.test.tsx:225` rejects every fetch, so it only exercises the selected point's error branch.
4. **Bar overlay fill is below the WCAG 1.4.11 3:1 non-text contrast floor in both themes.** `frontend/src/features/panels/ui/chartOverlayOption.ts:9,67` draws the overlay bar with fill `--app-text-muted` at `opacity: 0.45` and no border.
   - Measured from rendered pixels against the panel surface (`EV/.eval-hel1277/bar-overlay-contrast.txt`; screenshots `EV/.eval-hel1277/shots/dash1-bar-light.png` and `EV/.eval-hel1277/shots/dash-bar-dark.png`):
     - light: overlay rgb(184,180,176) on rgb(253,252,250) = **2.01:1**
     - dark: overlay rgb(91,87,82) on rgb(26,24,22) = **2.47:1**
   - The overlay bars carry the comparison data, so they are not decoration. For comparison, the primary bar measures 4.54 (light) and 3.80 (dark).
   - The dashed line overlay is fine: `--app-text-muted` at full opacity measures 6.25 (light) and 7.17 (dark).
   - The orchestrator carried this forward from the design skeptic. The measurement is objective, so I am raising it as a change request.

### Phase 3: UI Review — FAIL

Setup:

- Servers were started with `start-servers.sh` on 6709/9616 and `assert-phase.sh servers` reported PASS.
- All checks ran in my own headless Chromium contexts (`.eval-hel1277/ui-check.cjs`, `bar-light.cjs`, `touch.cjs`), in light and dark.
- I seeded with my own user and data (see residue.md).
- The light diff-state screenshot is the one from my e2e re-run (`EV/openspec/changes/output-history-scrubber-diff/screenshots/history-view-diff-light.png`). My own first light pass also showed the diff state, but the dev backend's HEL-1272 retention pass then thinned that seed's points (same 5-minute bucket), so my second light pass had a single point. The dark pass is `EV/.eval-hel1277/shots/history-diff-dark.png`.

Checks:

- **Happy path:** PASS, both themes.
  - The Outputs-tab card shows "History" with accessible name "History for {name}". Tab from the Open button lands on it, and Enter opens the modal.
  - The scrubber defaults to the newest point. `aria-valuetext` reads "Oct 6, 01:38 PM, 5 rows". ArrowLeft and ArrowRight scrub, and Older is disabled at the oldest point. Escape closes the modal.
  - In the diff state, exactly the west(250) and north rows are tinted and read "New or changed", and "1 row from … no longer present" is shown.
  - Changed-row text contrast is 10.85:1 in dark (on the `--app-accent-surface` wash). The light first pass matched the e2e screenshot.
  - The History chart (bar and line) draws the "vs <time>" overlay.
  - Dashboard chart panels show "vs previous" for line and "vs Oct 6, 01:38 PM" for a custom compare.
  - The public share-token viewer draws the overlay and lists it in the tooltip.
- **Unhappy paths:** history 500 shows the banner `InlineError`, zero points shows the `EmptyState`, and a selected-payload 500 shows "Couldn't load the stored rows for this run." The comparison-payload 500 has the wrong copy (CR3).
- **Loading states:** Spinner text is present for history and rows. The empty state uses the shared `EmptyState`.
- **Console:** no app errors. The only entries were a pre-login `/auth/me` 401, a pre-existing `/schedule` 404 for a pipeline with no schedule, my own intercepted 500s, and 429s from my probe exceeding the 120/min limit.
- **Breakpoints 1440/1100/768/375:** no document horizontal overflow, either in the History modal or on the dashboard. At 375 the table scrolls inside its frame.
- **Accessibility:** names and keyboard support are present. The scrubber touch target fails (CR1).
- **The two items the orchestrator asked about:**
  - **Bar-overlay width:** the overlay is a grouped side-by-side bar, so the primary bar halves to about 26px per category (`dash-bar-dark.png`). design.md's `z: 1` "below primary" has no visual effect for grouped bars. Whether grouped or overlapped bars are right is a visual-design call I leave to the skeptic; it is not a FAIL here.
  - **Overlay contrast:** the dashed line passes; the bar fill fails (CR4).
- **Column pinning disabled with `leadingColumns`: acceptable.**
  - The History table is read-only: there is no `ownerId`, so `canWrite` is false and nothing is persisted.
  - An inert leading "Change" column would break `DataGrid`'s invariant that pinned columns form a run starting at the first column.
  - Observed side effect: the pin control appears and disappears as you scrub. The oldest point and summary-only points showed 3 pin buttons; the diff point showed 0. A pin set on a non-diff point stops rendering on a diff point. This is cosmetic and non-blocking; see Suggestions.

### Overall: FAIL

### Change Requests

1. **Add the touch floor to the scrubber range.** In `frontend/src/features/pipelines/ui/outputHistory/OutputHistoryModal.css`, give `.output-history__range` `min-height: 44px` inside `@media (max-width: 768px), (pointer: coarse)`, matching `PanelDetailModal.mobile.css:189`. Add a CSS guard test if one is cheap. Re-measure that the hit height is ≥ 44 − sampling step at 375px with a coarse pointer.
2. **Give the History button a control-height token.** In `frontend/src/features/pipelines/ui/OutputGalleryCard.css:44-58`, set `height: var(--control-sm)` (28px) on `.output-gallery-card__history`, keeping `tap-expand-44`. Adjust the vertical padding if needed so the label stays centred.
3. **Fix the copy for a failed comparison-payload fetch.** In `frontend/src/features/pipelines/ui/outputHistory/HistoryRows.tsx:80-91`, add an explicit branch for `comparisonRows?.status === "error"`. It should render intent-error text (the `output-history__error` style, `role="alert"`), for example "Couldn't load the stored rows from <time> to compare.", and must not claim the rows weren't stored. Keep the diff disabled. In `OutputHistoryModal.test.tsx`, add a test where the selected payload loads but the comparison payload rejects. It should assert the error copy, no "rows weren't stored" text, no "New or changed", and no "no longer present".
4. **Bring the bar overlay to ≥3:1 against the panel surface in both themes.** In `frontend/src/features/panels/ui/chartOverlayOption.ts:63-68`, keep the fill subordinate but give the overlay bar a full-opacity boundary: `itemStyle: { color, opacity: OVERLAY_BAR_OPACITY, borderColor: themeTokens.textMuted, borderWidth: 1 }`. Note that ECharts `itemStyle.opacity` also fades the border, so use the colour's alpha instead of `opacity` (for example a `color-mix`/rgba fill plus an opaque `borderColor`), or raise the fill until it clears 3:1. Pin the behaviour in `buildChartOption.overlay.test.ts`, and re-measure the rendered pixels in both themes.

### Non-blocking Suggestions

- **Same-minute capture labels are ambiguous.** `formatCaptureTime` is minute-precision. Runs captured within the same minute (common for bursts or an auto-run right after a manual run, before thinning) produce "Oct 6, 01:38 PM" for the selected point and "vs Oct 6, 01:38 PM" for its comparison. Consider adding seconds when the two times share a minute.
- **Make pinning consistent across the History view.** Either disable pinning for the whole view (for example a `pinnable={false}` pass-through) or keep it consistent, so the pin control does not appear and disappear as the user scrubs.
- **Observation for the driver, not attributable to this diff** (the diff touches only the history read path): after the dev backend's retention pass ran, a newly created beta-tier pipeline briefly stored no payloads. This turned out to be my own cookie-jar collision (the "owner" was a free-tier user from another evaluator), not a product defect, so no action is needed.
- **Process hazard for the driver:** the session scratchpad `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-…/scratchpad` is shared by concurrently running agents. A HEL-1326 evaluator overwrote my `cj.txt` cookie jar at 13:44:55, so one of my seeding scripts created a source, pipeline, three outputs, a dashboard, two panels and a share token under user `07485b24-9d5c-48ae-9d66-91f39f9a7930` (hel1326-eval-c1-…). I deleted all of them by exact id about 2 minutes later; residue.md lists them. That evaluator's session may have seen them briefly. Brief agents to keep cookie jars and other mutable state inside their own worktree.
- **PR body:** call out the `-n` bypass and its environmental cause (stale `helio-mcp/node_modules`).
