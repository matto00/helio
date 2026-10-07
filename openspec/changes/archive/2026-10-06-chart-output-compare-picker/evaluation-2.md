## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `d257a56dbfab06c7575f1c6f84f6e8f867f32237` (cycle-2 commit on top of `6a20d9fd6`). The diff base was resolved live as `9415a44eca125f5bee25bdd4878911d39b6ecc37` (origin/main).

### Phase 1: Spec Review — PASS

- **Cycle-1 CR1 (scatter dropped every later blocker): resolved.**
  - The post-hoc override in `OutputKindFields.tsx` is gone.
  - `OutputEditorSheet.tsx:316-319` (`compareBlockerInput`) now sets only `aggregation: null` for scatter, then calls `chartCompareBlocker`. The `series`/`unmapped`/`horizontal`/`normalized` blockers still apply, and the bar-option blockers never depend on chartType. This matches the design-gate guidance and the spec delta.
  - Verified in the running app: a scatter Output with `aggregation` and `bar.orientation: "horizontal"` at 7 days shows the "Horizontal bars…" note, and the same Output without horizontal bars shows no note.
- ACs, C1 (show-with-inline-note: never hidden, fixed help text plus an Output-level note, no new "previous" copy) and the owner ruling remain honored. Tasks and spec delta are unchanged and still accurate. No scope creep.

### Phase 2: Code Review — PASS

Gates, run fresh by me in WORKTREE_PATH at d257a56db under `nice -n 19`:
- `npm run lint`: 0
- `npm run format:check`: 0
- `npm run typecheck`: 0
- `npm --prefix frontend run build`: 0
- `npm test`: 0 (455 suites, 4775 tests)
- e2e `hel1350-chart-compare-picker.spec.ts`, `--workers=2`: 2 passed (light and dark)
- No backend changes, so no sbt run.

**Cycle-1 CR2 (untested scatter path): resolved, with red-first evidence I reproduced.** I used a throwaway detached worktree with hardlinked node_modules, removed afterwards.
- **Red against cycle-1 code:** I ran the cycle-2 test file against `6a20d9fd6`. 3 failed / 26 passed: "scatter with a leftover aggregation still shows the later {horizontal, series, unmapped} note".
- **Mutation at HEAD:** I replaced `compareBlockerInput`'s scatter clause with `return cfg`. 4 failed / 25 passed: the 3 above plus "scatter with a leftover aggregation and a clean mapping shows no note". Every new scatter test is killable.

Extraction review:
- `ChartCompareField.tsx` (52 lines) and `compareOptions.ts` (36 lines) are moves, not rewrites. Copy, IDs, classes and options are byte-identical to cycle 1, and the metric picker still uses the shared `compareOptions`.
- `OutputKindFields.tsx` is down from 410 to 345 lines.
- No mechanical CONTRIBUTING or DESIGN violations: no CSS, existing hint classes only, shared `Select`.

### Phase 3: UI Review — PASS

- Servers started via `start-servers.sh` 6782/9689 (`PASS servers`) and stopped by recorded PID (npm-dev 124498, sbt 124136). Their children exited, and nothing is listening on either port.
- I used my own headless context from a scratch spec inside the worktree, removed afterwards.
- The rendered DOM is unchanged by the extraction: `span.__data-label`, `div.ui-select`, `p.__field-hint#output-chart-compare-help`, `p.__type-hint#output-chart-compare-note`. `aria-describedby` is `output-chart-compare-help output-chart-compare-note`.
- Both themes:
  - The aggregated note shows on a bar Output.
  - On a scatter Output with aggregation plus horizontal bars, the horizontal note shows.
  - On a scatter Output with aggregation and a clean mapping, there is no note, and the "Aggregation isn't available for scatter" hint is visible.
  - Switching the chart type from scatter to bar in the editor brings the aggregated note back, so the note follows unsaved edits.
- No document overflow at 1100, 768 or 375.
- Console and HTTP errors are all accounted for, and none comes from this change: pre-login `/api/auth/me` 401s, and `/api/pipelines/:id/schedule` 404 (no schedule set, existing behavior).

Evidence (persisted):
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350-c2/shots/{agg,scatter-horiz,scatter-clean}-{light,dark}.png
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350-c2/logs/red-c2.log (red against cycle-1 code)
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350-c2/logs/mut-c2.log (HEAD mutation)
- /home/matt/Development/helio/.concertino/runs/HEL-1350/evidence/.eval-hel1350-c2/logs/{jest2,e2e-c2,eval2-ui}.log and eval2.spec.ts.txt

Dev-DB rows: users 41f64454-1ea1-405a-a25e-14120e17d851, 7a023476-601b-43b2-bef0-ec42d792c581 (e2e), 62bb80ac-9dd9-402e-a62a-c1f4b04229cd and 29367732-04f9-43b5-bafe-721db02960e8 (review). All were deleted by exact id, along with their 2 `pipeline_run_rate_window` rows. Sources and pipelines were deleted via the API (204). Residual count is 0. matt@helio.dev was not touched.

### Overall: PASS

### Non-blocking Suggestions
- `OutputKindFields.tsx:28,32` imports `METRIC_COMPARE_OPTIONS` only to re-export it, and nothing in the repo imports it from there (`git grep`). The export surface it preserves was also unused on base. Drop the import and re-export, or import from `./compareOptions` directly if a consumer appears.
- `OutputEditorSheet.compare.test.tsx` "shows no note for a clean raw-rows line config or a pie chartType alone" still renders only the pie case. The line case now has its own test, so rename this one to "…a pie chartType alone".
- The e2e still leaves the users it registers in the dev DB; they need manual by-id cleanup, as done above.
