## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: 50e330adecbaae82c25957b0c607ab920cb2762a. The base was resolved live with `resolve-review-base.sh` and gave b3a7efc9639386784c888347770800189662a380. origin/main is bc8ccac45 (HEL-1482, HEL-1316 on top), and `git merge-tree --write-tree origin/main HEAD` is clean. HEL-1307 has not merged.

Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1306/evidence/skeptic-final-2/`. This is the main checkout's run dir, which round 1 also used as the durable location.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/chart-reference-lines/HEL-1306`.

**CR1 (line-label halo): fixed.**
- Code: `referenceMarksOption.ts:103-107`. Every markLine label now carries `textBorderColor: tokens.surfaceStrong` and `textBorderWidth: LABEL_HALO_WIDTH`. Band labels use the same constant at line 135.
- Test: "line labels carry a legibility halo". The executor's mutation output (`final1-mutation-line-halo.txt`) is unambiguous: with the halo removed, the test fails at `toMatchObject({textBorderColor, textBorderWidth: 3})` and prints the halo-less label.
- Live, with my own fixture. The bar has data 12..40, an unlabelled neutral line at 25 crossed by the Fri bar, a warning "SLO 95" line and a labelled success band. I captured light/dark at 1440/375 in an isolated headless Chromium. I did not use the shared MCP browser; see the note at the end.
  - The display list (`probe-1.json`) shows every line label with `stroke` set to the halo: light `#ffffff`, dark `#262320`, `lineWidth 3`, `z 5`. This holds on bar, horizontal bar ("Goal"), line ("30", "Target") and scatter ("20").
  - 4x crops `crop-25-light-1440.png` and `crop-25-dark-1440.png`: "25" now reads cleanly over the Fri bar in both themes. In round 1 it read as "5".
  - At 375 (`dash-light-375.png`, `dash-dark-375.png`), "25" over the Fri bar is legible. So is "Target" over the line chart's Fri marker.

**CR2 (compact band-label exception): fixed.**
- `specs/chart-reference-lines/spec.md`: the band requirement now states that band labels are not drawn in a compact chart (the mobile panel stack, or a measured height of 179px or less). The band itself and line labels are still drawn. A new "Compact chart" scenario covers this.
- design.md D5 now names `effectiveCompact`, both triggers and `CHART_COMPACT_HEIGHT_PX`.
- The running app matches: at 375 the plots are 100px tall, `bandLabelsShown` is empty, the bands are drawn, and line labels are present. At 1440, "Healthy" and "Watch" are drawn at z 5.

**Editor change (UTF-16 `maxLength` removed).**
- `ReferenceMarksField.tsx` no longer sets `maxLength`. Validation is `isValidReferenceLabel` (code points), which matches `ChartReferenceMarks.scala` `codePointCount` and the schemas' `maxLength`.
- Live, in all four cases (`editor-probe.json`):
  - `maxlength` attribute: null.
  - 60 emoji (120 UTF-16 units): accepted, Save enabled.
  - 61 emoji: shows "Label must be 60 characters or fewer.", Save disabled.
  - 80 ASCII characters: same error, Save disabled.
  - After clearing the label: Save enabled again.
- Screenshot: `editor-label-over-dark-1440.png`. Nothing was saved.

**Full cold re-review against the ACs, rulings and constraints.**
- **AC1 (labelled line on bar and line charts): met.** Live: bar, line, horizontal bar (vertical "Goal" on the value axis) and scatter all draw the line. An unlabelled line shows its formatted value. The axis is widened with zero kept (bar `dataMin 0 / dataMax 95`). The pie draws nothing and keeps its stored `referenceLines`; its option has only the pie series.
- **AC2 (persisted, schema-validated, editable): met.**
  - `ChartReferenceMarks.scala` is read in full. It enforces caps 5/3, finite numbers, `from < to`, labels of 1-60 code points that are not blank, the tone enum and unknown item keys. It validates only keys a write changes, and is independent of `chartType`, per ruling 2.
  - The requirement block of the output-routes-api delta differs from live origin/main canonical text only by adding `referenceLines`, `referenceBands` to the chart clause.
  - The editor is checked live (above).
- **AC3 (bundle size noted in the PR): ready, not yet in a PR.** `evidence/bundle-delta.md` exists. The orchestrator must carry it into the PR body.
- **Rulings 1-7:** each is traced as in round 1 and is unchanged by 50e330ade. Ruling 5's tones resolve to theme hex in both themes. Live line colours:
  - light: neutral `#645e56`, warning `#85551a`, success `#166d43`, error `#af3325`;
  - dark: `#aaa49c`, `#f5b944`, `#4cc38a`, `#f17b67`.
- **C1:** only hex reaches ECharts. `parseableOr` guards `textMuted`, `success`, `warning` and `error`.
- **C2:** the new test is mutation-red (above); the earlier seam reds were verified in round 1.
- **C3:** fixtures are recorded and deleted by exact id (below).
- **C4:** the behaviour claims above come from the live display list and option, not from the code alone.

**Gates, re-run by me at 50e330ade.**
- Full jest: 524 suites / 5662 tests passed, exit 0 (`jest-full.txt`, 2 workers, nice 19).
- Targeted jest (referenceMarks, ChartPanel, ChartOutputPanel, OutputEditorSheet, buildOutputConfig, chartAppearance, buildChartOption): 31 suites / 465 tests passed.
- `typecheck` exit 0, and eslint `--max-warnings=0` on the changed files exit 0.
- Root `format:check` reports all files clean. The openspec md files are prettier-ignored.
- sbt testFull was not re-run. 50e330ade touches no backend file (`git show --stat`), and the cycle-2 log (`cycle2-gate-sbt.txt` and `eval-2/sbt-testFull.log`) shows 6762 succeeded, 0 failed.

**Console.** The only errors were the pre-login `401`s from the auth probe and ECharts 0-size warnings during the 375 resize. None comes from this change.

**Fixtures and cleanup (C3).**
- Throwaway user `e2b06311-1cf3-4b9d-bdda-1fe6dd17d9e2`. Ids are recorded in `fixture-ids.txt`.
- Each was deleted by exact id (`fixture-ids.txt.cleanup.txt`): 5 panels 204, dashboard 204, 5 outputs 200, pipeline 204, data source 204.
- I stopped the servers by exact PID (3710761, 3710614, 3710572, 3710964, 3710949; their cwd was confirmed under this worktree first), and ports 6738/9645 are free.
- I moved my 7 `.playwright-mcp` files into `skeptic-final-2/playwright-mcp/`. My scripts are saved alongside as `shoot.cjs`, `editor.cjs` and `cleanup.cjs`.

### Verdict: CONFIRM

### Non-blocking notes
- **Process gap: the evaluator never assessed 50e330ade.** `evaluation-2.md` reviewed 2829f6ecd. I re-ran the frontend gates myself at 50e330ade (above), so this verdict does not depend on that gap. The orchestrator should still not cite evaluation-2 as covering HEAD.
- **Close lines collide at compact height.** ECharts does not de-overlap markLine labels. At 375, a line at 30 and one at 38 on a 100px plot put "30" against the "Target" line. Both stay legible thanks to the halo, and this is a data edge case, not a regression. It could be a follow-up (`labelLayout` or hiding the second label).
- **The overlay matched the current run again in my fixture.** The cause is a dataset-write auto-run: a debounce run lands after the PUT, so the baseline equals the current run. `/history` confirmed the baseline points equal the current ones. This is server-side history behaviour this change does not touch.
- **Inline error colour.** The inline error uses the existing muted `output-editor-sheet__type-hint` class, so it does not read as an error colour. It is consistent with its sibling, but a candidate for the polish sweep.
- **Shared-browser hazard (environment).** The shared Playwright MCP browser was navigated to another lane's app (localhost:6915) partway through my session, and one capture came out blank. I discarded it and moved all visual evidence to an isolated headless Chromium. No gate defect: I accepted no mtime-ordering evidence.
