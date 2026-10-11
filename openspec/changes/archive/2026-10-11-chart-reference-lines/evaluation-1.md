## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 56fc3a02c3e8b4d4e7c4ee79f176df8eb005653b (base b3a7efc9639386784c888347770800189662a380, resolved live via resolve-review-base.sh).
Evaluator evidence: /home/matt/Development/helio/.concertino/runs/HEL-1306/evidence/eval-1/

### Phase 1: Spec Review — PASS (one spec-scenario failure is recorded under Phase 3)

- AC1 (labelled horizontal line on bar and line charts): met. Seen in the running app on bar, line, horizontal bar, multi-series line, scatter and histogram, in both themes.
- AC2 (persisted, schema-validated, editable): met. Two top-level keys, `ChartReferenceMarks.validate` is wired into `OutputConfigValidation.validate` (so single-call create is covered too), the three schemas are updated, helio-mcp doc text is updated, and the editor section is in place. Live probe on my own fixture: 6 lines -> 400 "referenceLines allows at most 5 lines"; from==to -> 400 "referenceBands[0]: from must be less than to"; string value -> 400; re-sending the stored value unchanged -> 200.
- AC3 (bundle impact): measured in evidence/bundle-delta.md (+7.01 kB gzip in the lazy echartsCore chunk, +1.88 kB gzip in main). It has to be copied into the PR body at delivery.
- Owner rulings 1-7: all honoured. The keys are top-level. Pie, heatmap and normalized stacked bars draw nothing and keep stored marks, and the editor hides the section on pie/heatmap. Values are static only. Marks go on the value axis (vertical on a horizontal bar). Tones are hex tokens. The label is capped at 60 characters. Caps are 5 lines and 3 bands.
- Tasks: all ticked and match the diff. `openspec validate chart-reference-lines`: valid.
- CONSTRAINTS: C1 honoured (`parseableOr` on the success/warning/error/textMuted tokens; dark fallbacks match theme.css:166/197/198/214). C2: red/mutation evidence is present (backend-seam-red.txt, frontend-seam-*-red, guard-mutation-1..3, mutation-d5-*). C3: every executor fixture id was deleted (dev DB, read-only, by exact id: data-source 0/30, pipeline 0/30, output 0/58, dashboard 0/14, panel 0/42 remain). C4: the D5 tests measure on a real ECharts SSR instance, and the e2e reads the live model.

### Phase 2: Code Review — PASS (one mechanical citation defect, listed as CR 2)

Gates, all re-run by me in WORKTREE_PATH at 56fc3a02c (logs in eval-1/):
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0.
- `npm test`: 524 suites / 5645 tests passed, exit 0.
- `npm --prefix frontend run build`: exit 0.
- `cd backend && sbt testFull` (nice 19, -J-Xmx3g): 6757 succeeded, 0 failed, 4 canceled, exit 0. Both `OutputReferenceMarksSeamSpec` and `ChartReferenceMarksSpec` ran.

Findings:
- `frontend/src/utils/referenceMarks.ts:4` cites `referenceMarksGuard.test.ts`, which does not exist. The file is `referenceMarks.guard.test.ts`. This is a dangling cross-file pointer (CONTRIBUTING comment standard; HEL-1481 just swept this class). See CR 2.
- Design is otherwise sound. One pure validator is shared by every write path. One echarts-free sanitizer serves both renderer and editor. The carrier series is kept out of the overlay, tooltip and emphasis passes by its position in the pass order. Draft-to-config conversion is pure and unit-tested. The editor follows the existing `HistogramBinCountField` invalid/Save-blocking pattern and uses shared TextField/Select/IconButton plus the `ui-modal-btn` recipe (44px expander on coarse pointers). Touch inputs get a 44px min-height under the media gate.
- Tests are meaningful: the guard is labelled and mutation-proven, the seam is red-first, and the D5 claims are measured on a real ECharts instance.

### Phase 3: UI Review — FAIL

Ran the canonical start-servers.sh (backend 9645, frontend 6738). My own fixture: one throwaway user, plus a source, pipeline, 6 chart Outputs (bar with line and band; line with compare and a neutral line; horizontal bar; multi-series line; scatter; histogram), a dashboard and 6 panels. Checked light and dark at 1440 and 375.

Passing checks:
- The value axis widens to include an above-data mark, and the zero baseline is kept.
- The line label falls back to the formatted value when no label is set.
- A horizontal bar draws a vertical line on the x axis.
- Tones re-resolve per theme (warning #85551a in light, #f5b944 in dark).
- The neutral solid 1.5px line is visually distinct from the dashed "vs" overlay (executor's overlay-line-*.png).
- Hovering a data series does not fade the marks. Live display list on the multi-series line: hovered-away series at opacity 0.1, reference line 1, label 1. On the bar: line 1, band 0.12, both labels 1.
- Toggling both data series off in the legend leaves the mark drawn, and the legend data is ["east","west"] with no carrier entry.
- No console errors from this feature. The only messages were pre-login 401s on /api/auth/me, one 502 on the run-events SSE through the Vite proxy (unrelated), and ECharts 0-size warnings during the viewport resize.

**Defect: band labels are drawn underneath the data series and are illegible.** Spec `chart-reference-lines` requires "the band's label (if set) inside its top edge", with the scenario "... labelled 'OK'".
- In the running app the "Healthy" band label on the bar chart is hidden behind the bars. Only "alth" shows between two bars, at 1440 and 375, in light and dark.
- The executor's own marked-bar-light-1440.png and marked-bar-dark-1440.png show no "Healthy" text at all.
- Root cause, from the live zrender display list on the bar chart: the label tspan "Healthy" has z=1, while every bar rect has z=2. The markArea label inherits the carrier's markArea z (1), so it paints beneath the data. The line label "SLO 95" has z=5 and is fine.
- Evidence: /home/matt/Development/helio/.concertino/runs/HEL-1306/evidence/eval-1/bar-band-label-occluded-light-1440.png (persisted ref: /home/matt/Development/helio/.concertino/runs/HEL-1306/evidence/.concertino/runs/HEL-1306/evidence/eval-1/bar-band-label-occluded-light-1440.png), plus dash-light-1440.png, dash-dark-1440.png and dash-dark-375.png in the same eval-1 directory.
- Executor question 1 (the 375 compact overlap) is the same defect, made worse by a ~60px plot. I rule it a defect, not acceptable.

Executor's other flagged items:
- 2. The 375 bar-width ratio > 0.95: accepted. 1440 asserts strict equality, and the D5 unit test asserts strict equality on a real ECharts instance. At 375 the difference comes from axis-label width ("100" vs "40" under containLabel), not from the carrier, which would halve the width.
- 3. Explicit null for both keys on chart create: accepted. It matches the existing `annotation: null` convention, the server accepts null, and PATCH still sends neither key when the marks are untouched (configPatch diff).
- 4. Fixture cleanup: verified, see Phase 1 C3. The 30 executor users plus my 1 eval user (5096376a-2926-4d74-8ac0-f6e6f197c400) remain because there is no user-delete API (existing e2e precedent). All my other fixtures were deleted by exact id and confirmed at 0 rows in the DB (ids in eval-1/eval-fixture-ids.txt).

### Overall: FAIL

### Change Requests
1. `frontend/src/features/panels/ui/referenceMarksOption.ts` (the `areaData` label at about lines 108-121, and/or the carrier/markArea z): make a band's label render above the data series and stay legible. Two acceptable options:
   - Give the label (or the markArea) a z above the series' z=2 without also painting the 0.12 fill over the bars. If raising the whole markArea is the only route, prove the tint on the bars is acceptable.
   - Move the label to a position the data cannot cover.
   In compact mode (`effectiveCompact`, the 375 stack), either show the label legibly without colliding with the bars or axis labels, or hide band labels in compact mode and say so in design.md D5 ("Compact mode keeps lines and labels" currently claims otherwise). Prove it per C4 with:
   - an e2e or display-list assertion that the band label element's z is greater than the bar rects' z (or that it is hidden when compact), and a mutation showing that assertion goes red on the current code;
   - running-app screenshots of a bar chart whose bars cross the band label position, light and dark at 1440 and 375.
2. `frontend/src/utils/referenceMarks.ts:4`: change `referenceMarksGuard.test.ts` to `referenceMarks.guard.test.ts`.

### Non-blocking Suggestions
- Label length: the server (`String.length`) and the frontend (`.length`) count UTF-16 code units, but JSON Schema `maxLength` (Ajv) counts code points. A label of 31 astral characters (e.g. emoji) passes the schema and is rejected by the server. Either count code points in both validators or note it in the schema description.
- The e2e hover check (`readMarkOpacities`) excludes text, so a regression in the label `blur` opacity would not be caught there. Consider asserting label opacity too.
- Pre-existing and out of scope: `applyHoverEmphasis` feeds `accentStrong` (a `color-mix()` string) to ECharts as the hovered line's stroke (the live display list shows `color-mix(in srgb, #f97316 76%, black)` on hover). This is the C1 hazard class, present on main at chartAppearance.ts:267-268. Candidate spin-off ticket.
