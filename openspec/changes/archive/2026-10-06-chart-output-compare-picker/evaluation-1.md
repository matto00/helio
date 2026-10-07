## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `6a20d9fd69d10b7b7c56189ae3216273be21887a` against live-resolved base `9415a44eca125f5bee25bdd4878911d39b6ecc37` (origin/main).

### Phase 1: Spec Review — FAIL

- AC1 "picker offered for chart Outputs + help text listing the cases": PASS. Every chart Output (line/bar/pie/scatter) gets the picker. The help text lists aggregated, >200 rows, filter, pie, scatter, multi-series, 100% stacked, and horizontal bars. Verified in RTL and in the running app.
- AC2 "no 'previous run' copy": PASS. The chart options are None/1 day/7 days/30 days. A stored `previous_run` shows the existing metric "Previous" label verbatim (design D3). The help text and note contain no "previous" (RTL-asserted).
- AC3 RTL + e2e: PASS. I re-ran the e2e locally (both themes, 2 passed). The PATCH body carries `compare: "7d"`, and the dashboard tooltip shows "vs 7d" with no document reload.
- Owner ruling / C1 (show-with-inline-note, never hidden, Output-level note only): honored, with one exception (see issue 1).
- Tasks all `[x]`. They match the diff. No scope creep: frontend only, no `ci.yml`/`playwright.config.ts`/`.gitignore`. The spec delta matches.
- **Issue 1 (spec-divergence):** `OutputKindFields.tsx:87-88` diverges from the design-gate guidance in design.md "Planner Notes". That guidance says to suppress the `aggregated` note for scatter, and that bar blockers still never read chartType. The implementation instead does `chartType === "scatter" && compareBlocker === "aggregated" ? null : compareBlocker`. `chartCompareBlocker` returns only the FIRST blocker, so when a scatter Output also has `aggregation` set, every later blocker is dropped too: `series`, `unmapped`, `horizontal`, `normalized`. This case is reachable in the editor: a bar Output with an aggregation and horizontal bars, switched to Scatter. `buildConfig()` still writes `aggregation`, and `chartOptions.bar` is still saved. Nothing gives a note, but on a bar panel the overlay cannot render. The spec delta also says the note is "never [derived] from the Output's `chartType`". Here, chartType silently removes the bar-option and series notes.

### Phase 2: Code Review — FAIL

Gates (fresh, run by me in WORKTREE_PATH, `nice -n 19`):
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm test`: exit 0 (455 suites / 4770 tests)
- `npm --prefix frontend run build`: exit 0
- No backend changes, so no sbt run.
- `e2e/hel1350-chart-compare-picker.spec.ts`, `--workers=2`, `nice -n 19`: 2 passed. The log is persisted (ref below).

Code review:
- Mechanical CONTRIBUTING/DESIGN rules: no violations found. There are no CSS changes. The change uses the shared `Select` and the existing `output-editor-sheet__field-hint`/`__type-hint` classes (tokens only), and adds no inline styles or FQN-style imports. The new `as never` casts in `OutputEditorSheet.compare.test.tsx:224-228` mirror the existing metric-tail test (base already had 3); acceptable in a test.
- DRY/modularity: good. One shared `compare` state. `compareOptions` is generalised with a default base, so metric behavior is unchanged. The predicate is co-located with the overlay rules, and `selectChartOverlay`/`applyChartOverlay` are untouched.
- **Issue 2 (tests meaningful):** the scatter branch at `OutputKindFields.tsx:87-88` has no test. Neither file has a test of a scatter Output with `aggregation` set. Deleting the `chartType === "scatter"` clause, or the defect in Issue 1, leaves all 4770 tests green. This is a new code path the design-gate skeptic explicitly asked for, and no test would catch a regression in it.
- Security/error handling: none at a boundary. The server's HEL-1273 validation is reused. A failed PATCH still shows "Failed to save output." (checked live, see Phase 3).

### Phase 3: UI Review — PASS

I started the servers on 6782/9689 with `start-servers.sh` (`PASS servers`). I used my own headless Playwright context from a scratch spec inside the worktree, not the shared MCP browser, then removed the spec. I stopped my servers by recorded PID: sbt 71791, npm-dev 72177. Their children also exited, and nothing is left listening.

- Happy path: the e2e passed in both themes. The editor PATCH carries `compare:"7d"`, and the dashboard shows the "vs 7d" dashed baseline. Confirmed visually in the overlay panel screenshot.
- Output-level note (the executor did not screenshot it):
  - Aggregated note shows in both themes.
  - Series note shows.
  - No note for a clean line Output at 7 days.
  - No note for a pie Output holding a stored `previous_run`. The select shows "Previous", which is clearable.
  - `aria-describedby` is `output-chart-compare-help output-chart-compare-note` when the note is shown.
- Keyboard: focus, Enter, and ArrowUp, Enter select None, and the note disappears.
- Unhappy path: a forced PATCH 500 shows "Failed to save output.".
- Breakpoints 1440/1100/768/375: `scrollWidth - clientWidth = 0` at every width. The help text and note wrap inside the sheet (at 375 the help text is 261px wide inside the sheet).
- Console: every error is accounted for, and none comes from this change. They are: pre-login `/api/auth/me` 401s; `/api/pipelines/:id/schedule` 404 (no schedule; existing behavior); my forced PATCH 500; and a localStorage pageerror on `about:blank` from my own `addInitScript`.
- Light and dark both render with the existing muted hint tokens. Whether the note's size and placement inside the Display card look right is a design judgment for the skeptic.

Evidence (persisted):
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350/shots/note-aggregated-light.png
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350/shots/note-aggregated-dark.png
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350/shots/note-aggregated-dark-375.png
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350/shots/note-series-dark.png
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350/shots/editor-agg-full-light.png
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350/shots/editor-agg-full-dark.png
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350/shots/prev-pie-light.png
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/openspec/changes/chart-output-compare-picker/screenshots/chart-overlay-panel-{light,dark}.png (regenerated by my own e2e run)
- Logs: /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350/logs/{e2e,eval-ui,eval-ui2,eval-ui3,jest}.log, plus eval.spec.ts.txt (my review script). eval-ui.log is the first run; it failed because my script pressed `Home`, which the shared Select does not handle. That is a script bug, not a product defect.

Dev-DB rows: the e2e and my review created 7 users:
- f731d8b4-d375-4008-8e7d-14371400e614
- e9d70947-b3b0-4853-bd1e-5a4d443b29c0
- 238225ae-c80f-4c6d-8e78-033a5c178d45
- e822d60d-5b88-460b-88d7-a22ce204586d
- 85290963-1d29-4a5d-9f62-eee3518396e0
- b9cd3909-3ef7-4689-999f-fb3e183923ab
- 8305479b-f0aa-4e5a-aea9-9f620da8f56a

I deleted all of them by exact id, along with their 2 `pipeline_run_rate_window` rows by those user ids and 2 sources left behind by a 429 (fe0c8c45-bc66-4f8a-8a1b-b9014f56da6c, 5461aa8a-c91e-4659-9e91-709bc584c271). The residual count is 0. matt@helio.dev was not touched.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx:87-88` (or `OutputEditorSheet.tsx:537`): for a scatter Output, drop only the `aggregated` reason and still evaluate the rest. For example, at the call site, pass `chartCompareBlocker(chartType === "scatter" ? { ...cfg, aggregation: null } : cfg)` and delete the post-hoc `blocker` override. A scatter Output with `aggregation` set plus `fieldMapping.series`, a missing x/y mapping, or `chartOptions.bar.orientation: "horizontal"`/`stacking: "normalized"` must still show that later note.
2. `OutputEditorSheet.compare.test.tsx`: add RTL cases for the scatter path. (a) A scatter Output with `aggregation` set and an otherwise clean mapping at 7 days shows no note. (b) A scatter Output with `aggregation` set AND `chartOptions.bar.orientation: "horizontal"` (or a `series` split) shows the horizontal (or series) note. Show (b) red against the current code before the fix.

### Non-blocking Suggestions
- `OutputEditorSheet.compare.test.tsx` "shows no note for a clean raw-rows config, a pie chartType alone, or compare None" only exercises the pie case. Either rename it or add the clean-line case (the None case is covered by the next test).
- `OutputKindFields.tsx` grew from about 340 to 410 lines, past CONTRIBUTING's ~400-line threshold. Per CONTRIBUTING, propose a split (e.g. extracting a `ChartCompareField`) in the PR description.
- The e2e writes its screenshots into the change dir (gitignored `*.png`), so any re-run overwrites earlier evidence. This is acceptable; just be aware of it.
- The e2e does not delete the users it registers; they need manual by-id cleanup, as done above.
