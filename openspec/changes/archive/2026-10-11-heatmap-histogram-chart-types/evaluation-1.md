## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `8b032560f91c0eb5d60257d7fd3f9e38ff90f724`. The diff base was resolved live with `resolve-review-base.sh` as `a29a7e5ce` (origin/main); the branch is one commit ahead.
I re-ran every gate myself in `WORKTREE_PATH` (CLEAN_WORKTREE was not set) and did my own live-app probes.
Fresh evidence is in `.concertino/runs/HEL-1311/evidence/eval-1/`: `eval-probe-log.txt`, `eval2-probe-log.txt`, `eval3-panel-appearance-probe.txt` and the `eval-*.png` screenshots.

### Phase 1: Spec Review — FAIL

| Check | Result |
| --- | --- |
| AC1: a heatmap renders with a colour scale in both themes | PASS. Checked live in light and dark at 1440/1100/768/375. The visualMap `inRange` is `[rgba(accent,0.25), accent]`. Duplicate cells are summed (Mon/testA 2+4 = 6 = max). Columns and rows follow first-appearance order. |
| AC2: a histogram bins a numeric field with a configurable bin count | PASS for render and storage: auto bins, and binCount 12 saved and round-tripped through the editor. There is an editor defect, see CR-1. |
| AC3: the new types are in the editor, the JSON schemas and the MCP enums, with tests | PASS. Six schema enums, `ChartTypes.All`, `CHART_TYPES` and the MCP `CHART_TYPES` are all pinned by three labelled GUARD tests. Mutation red is recorded in `guard-backend.txt` and `guard-frontend-mcp.txt`. |
| No AC silently reinterpreted | PASS |
| Tasks all `[x]` and matching the code | PASS. The task 3.8 reachability finding is recorded in files-modified.md. |
| Scope creep | None |
| Regressions | None found. The full suites are green. On the live dashboard a line Output with `compare: previous_run` still draws "vs previous", and its History view still draws a chart. |
| API contracts and schemas updated | PASS. `check:schemas` is green (schema-drift: "schemas in sync with JsonProtocols", "AssistantProposalToolSchemas.scala in sync with schemas/"). |
| Planning artifacts reflect the final behaviour | **FAIL, see CR-3.** `design.md` D4/D6/D7 still describe the superseded designs. The deviations live only in files-modified.md. |
| `workflow-state.md` CONSTRAINTS C1–C5 honoured | PASS. C1: Q1–Q4 = A are implemented as ruled, and HEL-1397 is untouched. C2: red-first for the backend route spec, buildOutputConfig and histogramBins. The other frontend tests were shown red by mutation after implementation (see suggestions). C4: no session link or `Claude-Session` trailer in the commit. C5: Playwright output is only in the worktree or evidence dir. |

Driver checks:
- **Client/server seam for the new enum values.** Live in the code. The red-first backend route test `OutputHeatmapHistogramSpec` (201 for heatmap/histogram, 400 on aggregation and on bad binCount) passed in my `sbt testFull` run. The three guards pin backend, frontend and MCP to every `schemas/**` chartType enum. I also checked live that `PATCH /api/panels/:id` accepts `histogram` and `heatmap` (200, stored) and rejects `area` (400, listing all six types). That panel-appearance path has no automated test (CR-2).
- **Schema-drift check:** green (`npm run check:schemas`, exit 0).
- **"vs" overlay:** checked live with a fresh user and two real runs, so a `previous_run` baseline existed.
  - Heatmap and histogram with `compare: previous_run` draw no "vs" series and no legend entry.
  - The line chart still draws `vs previous`.
  - The editor shows the general help text naming heatmap and histogram, plus the specific notes "The vs overlay doesn't show for heatmap charts." and "… for histogram charts."
  - The line editor shows no note. All of the above holds in both themes.
- **History view:** heatmap and histogram show the muted note "A history chart isn't drawn for heatmap or histogram Outputs." with no canvas. The summary table and the rest of the modal are unchanged. The line Output still renders its history canvas. Both themes checked.

### Phase 2: Code Review — FAIL

I ran every gate fresh, in `WORKTREE_PATH`:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run check:schemas` | exit 0 |
| `npm test` (helio-mcp jest) | 45 suites / 441 tests passed |
| `npm test` (frontend jest) | 514 suites / 5356 tests / 19 snapshots passed |
| `npm --prefix frontend run build` | exit 0. Bundle: `echartsCore` 627.45 kB / 210.94 kB gzip, `index` 1,021.88 / 278.55, `ChartPanel` 11.38 / 4.32. This matches the executor's bundle-after table. |
| `cd backend && sbt testFull` (`-J-Xmx3g`, nice 19) | 6673 run, 0 failed, 4 canceled, 487 suites, 0 aborted. `OutputHeatmapHistogramSpec` (5 tests) and `ChartTypesSchemaGuardSpec` are included. |

Checklist:
- **Canonical code quality (CONTRIBUTING.md):** no inline FQNs and imports are at the top. Every file is under the ~400-line threshold except files that were already over it before this change: `panel.ts` 496 (was 489), `PanelContent.css` 471 (was 465), `AssistantProposalToolSchemas.scala` 542 (was 541). Each grew only by a few lines. The new e2e spec is 447 lines (soft budget only). No `any` was added.
- **DESIGN.md [mechanical] rules:**
  - The new CSS uses no literal colours.
  - `.chart-panel__truncation-note + .chart-panel__skipped-note { padding-top: 0 }` is fine.
  - The bin-count 44px floor uses the canonical touch gate `@media (max-width: 768px), (pointer: coarse)` with the grow-the-box mechanism for a text input, as the rule requires. 375px heights were measured at ≥ 43.5 in the e2e run.
  - The pickers use shared `Select` and `TextField`.
  - The heatmap colour comes from the existing `--app-accent` token, so no new token was needed.
  - The fallback hex in `FALLBACK_CHART_THEME` follows the existing pattern.
- **DRY / modular:** good. There is one chart-type set per side, and `binHistogram` is shared by the renderer and the note. Heatmap and histogram options are split into `heatmapHistogramOptions.ts`.
- **Type safety:** acceptable. The `as` casts sit on ECharts option plumbing, as elsewhere in the file.
- **Security:** the heatmap tooltip HTML-escapes row and column labels (`escapeHtml`). The backend validates `binCount` on write under the tolerance rule.
- **Error handling:** **one silent-failure defect, CR-1.**
- **Tests meaningful:** mostly yes, and the mutation evidence is convincing. There is a gap: the spec scenario "Panel appearance accepts a new chart type" has no test (CR-2).
- **Dead code:** none. The hook-level click guard was removed. I checked live that clicking a heatmap cell or histogram bar opens nothing and leaves the URL unchanged.
- **Over-engineering:** none.

Executor deviations from design.md, judged against the specs and owner rulings:

| Deviation | Verdict | Reason |
| --- | --- | --- |
| Two-stop colour ramp instead of an opacity channel | Accept | Same token, same 0.25 floor. It meets the spec requirement that colours come from theme tokens, and the legend bar now matches the cells. |
| Cursor reset through `onChartReady` | Accept | I verified it live: the computed canvas cursor is `default` over a heatmap cell and over a histogram bar. |
| `HistogramBinCountField` instead of `ChartDisplayFields` | Accept | Same behaviour, and the shared display fields are left untouched. |
| Compact visualMap sizing | Accept | It is the "compact-aware sizing" that design.md's Risks section calls for. It rendered without overflow at 375px in both themes (`horizontalOverflowPx: 0` at every width). |
| Skipped-note stacking rule | Accept | Matches D5. |
| `ChartTypes` in the reducer and assistant schema | Not a deviation | D1 prescribes it. |

All of these must still be reflected in design.md (CR-3).

### Phase 3: UI Review — PASS (objective checks)

Servers were started with `start-servers.sh` on 6743/9650, `assert-phase.sh servers` passed, and I stopped them afterwards by exact PID. A fresh throwaway user was used throughout.

| Check | Result |
| --- | --- |
| Happy path | The heatmap draws a category × category matrix with the visualMap labelled `1` to `6`. The histogram draws touching bars labelled "3 to 9" and so on, and shows "2 non-numeric values skipped." |
| Unhappy paths | Non-numeric cells are skipped and counted. A stored non-numeric field shows as "duration (not numeric)" in the picker. The invalid bin draft shows an error, but Save is not blocked (CR-1). |
| Accessibility | Pickers expose names: Columns field, Rows field, Value field, Field field, Bin count. The pickers and bins input are reachable by keyboard (e2e). |
| Breakpoints | 1440, 1100, 768 and 375, light and dark. No horizontal overflow at any width. |
| Console errors | Only `GET /api/pipelines/:id/schedule` 404 (no schedule set, pre-existing, not in this diff). Probe 1 also hit 429s and unhandled `Request failed with status code 429` page errors because my own probe exceeded the per-user rate limit. That is environmental and pre-existing, not this change. |

The dark-1100 read in probe 1 timed out because of that 429 burst. The same width passed in light, and every other dark width passed.

### Overall: FAIL

### Change Requests

1. **The bin-count editor silently saves a value other than the one shown.**
   - The defect: `frontend/src/features/pipelines/ui/outputEditor/HistogramBinCountField.tsx:48-51` only calls `onChange` for a valid draft. An invalid draft such as "1" therefore leaves the previous committed value in state, and nothing blocks Save.
   - Live reproduction (`eval2-probe-log.txt`):
     1. Save `12`. The stored value is `{"histogram":{"binCount":12}}`.
     2. Reopen, delete one digit so the draft is "1", and the field shows the role=alert error.
     3. Click **Save**. The sheet closes and the stored value is still `binCount: 12`, so the user's visible input is silently dropped.
     - The same happens from Automatic: typing "1" and clicking Save saves Automatic.
   - Required fix: make an invalid bin-count draft block Save. For example, lift the `invalid` state up through `onHistogramChange` and the kind state so `OutputEditorSheet` disables Save, or so `handleSave` (`OutputEditorSheet.tsx:184`) refuses and surfaces `InlineError`.
   - Add a test: invalid draft followed by Save makes no update request, or keeps Save disabled. Show it red against the current code.
2. **The spec scenario "Panel appearance accepts a new chart type" has no automated test.**
   - The scenario is in `specs/heatmap-histogram-charts/spec.md`. `RequestValidation.validateChartType` now reads `ChartTypes.AllSet`, but no backend test exercises the panel-appearance write path with a new value.
   - Add a route-level case next to the existing scatter case in `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala:2007-2013`, or in `PanelAppearanceMergeSpec.scala:54-61`. It should assert that `chart.chartType: "histogram"` (and `"heatmap"`) is stored, and that `"area"` is a 400 whose message lists all six types.
   - It already behaves correctly live (`eval3-panel-appearance-probe.txt`), so this is red-by-mutation evidence. Shrink `ChartTypes.All` and the case must fail.
3. **Bring `design.md` in line with what shipped.** Planning artifacts must reflect the final behaviour, and this change dir is what gets archived.
   - D4 (line 52): replace `inRange: { color: [tokens.accent], opacity: [0.25, 1] }` with the two-stop ramp `[withAlpha(accent, 0.25), accent]` and the end-label `text`, and state why (the legend bar ignores the opacity channel).
   - D6 (lines ~74-86): say the zrender `mousemove` reset is attached through `onChartReady` (`useHeatmapDefaultCursor`), not an effect. Also say that the hook-level selection guard in `useChartClickHandler` was dropped and `mapChartClickToSelection` is the single gate.
   - D7 (line 95): say the bin-count control lives in `outputEditor/HistogramBinCountField.tsx`, not `ChartDisplayFields`.
   - Mention the compact visualMap sizing (`HEATMAP_COMPACT_*`) in D4 or in Risks.

### Non-blocking Suggestions

- `backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala:126`: `scatterCheck` now covers heatmap and histogram too. Rename it to `nonAggregatingCheck`.
- `ChartSlotFields.tsx:874` builds `ariaLabel={`${label} field`}`, which produces the accessible name "Field field" for the histogram picker. Consider "Histogram field" or "Value column" style names.
- `guard-frontend-mcp.txt` mutation A, dropping `histogram` from the frontend `CHART_TYPES`, went red only by compile failure ("Tests: 0 total"). Its assertion was red only through mutations B and C. This is acceptable but weaker. Note it in the PR.
- C2 ordering: about a dozen frontend tests were authored after their implementation and shown red by mutation (`red-by-mutation-frontend.txt` says so). The substance is there; state it plainly in the PR body.
- `HistogramBinCountField` seeds `draft` from `binCount` only on mount. If the editor ever resets kind state without remounting, the draft will go stale.
- Residue: both the e2e spec and my probes register throwaway users that have no delete API. My probe users are `de22f5a8-2a21-4958-a933-67b7a41a3f67`, `47af2f49-39af-4005-9198-b25b20c47d6e`, `a14ec63a-5fec-4582-86bd-5fc0491fddb8`, `6bb222fe-ecdf-4a6d-9c85-5c4623eea15f`, and one `hel1311-eval3-*@example.test` user. All of their dashboards, pipelines and sources were deleted by exact id (204).
